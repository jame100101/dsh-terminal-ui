/** Process-tree sampling for repository-only TUI performance evaluation. */

import { execFile } from 'node:child_process'

/** Parse the JSON emitted by the Windows CIM process query. */
export function parseWindowsProcessJson(stdout) {
  const text = String(stdout).trim()
  if (text === '') return []
  const decoded = JSON.parse(text)
  const rows = Array.isArray(decoded) ? decoded : [decoded]
  return rows.flatMap((row) => {
    const pid = Number(row.ProcessId)
    if (!Number.isInteger(pid) || pid <= 0) return []
    const ppid = Number(row.ParentProcessId)
    const rssBytes = Number(row.WorkingSetSize)
    return [{
      pid,
      ppid: Number.isInteger(ppid) ? ppid : 0,
      name: typeof row.Name === 'string' ? row.Name.replace(/\.exe$/iu, '') : '',
      rssBytes: Number.isFinite(rssBytes) ? rssBytes : 0,
    }]
  })
}

/** Parse a parent-less `Get-Process` fallback when CIM access is restricted. */
export function parseWindowsProcessListJson(stdout) {
  const text = String(stdout).trim()
  if (text === '') return []
  const decoded = JSON.parse(text)
  const rows = Array.isArray(decoded) ? decoded : [decoded]
  return rows.flatMap((row) => {
    const pid = Number(row.Id)
    if (!Number.isInteger(pid) || pid <= 0) return []
    const rssBytes = Number(row.WorkingSet64)
    return [{
      pid,
      ppid: 0,
      name: typeof row.ProcessName === 'string' ? row.ProcessName : '',
      rssBytes: Number.isFinite(rssBytes) ? rssBytes : 0,
    }]
  })
}

/** Parse `ps` rows where RSS is KiB. */
export function parsePosixProcessTable(stdout) {
  const entries = []
  for (const line of String(stdout).split(/\r?\n/u)) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)/u.exec(line)
    if (match === null) continue
    entries.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      name: match[4] ?? '',
      rssBytes: Number(match[3]) * 1024,
    })
  }
  return entries
}

/** Walk a bounded descendant tree rooted at one launched process. */
export function walkProcessTree(rootPid, entries) {
  const grouped = new Map()
  for (const entry of entries) {
    const siblings = grouped.get(entry.ppid)
    if (siblings === undefined) grouped.set(entry.ppid, [entry])
    else siblings.push(entry)
  }
  const root = entries.find(entry => entry.pid === rootPid)
    ?? { pid: rootPid, ppid: 0, name: 'node', rssBytes: 0 }
  const processes = [root]
  const seen = new Set([rootPid])
  const queue = [{ pid: rootPid, depth: 0 }]
  while (queue.length > 0 && processes.length < 64) {
    const current = queue.shift()
    if (current === undefined || current.depth >= 6) continue
    for (const child of grouped.get(current.pid) ?? []) {
      if (seen.has(child.pid) || processes.length >= 64) continue
      seen.add(child.pid)
      processes.push(child)
      queue.push({ pid: child.pid, depth: current.depth + 1 })
    }
  }
  return {
    processes,
    rssBytes: processes.reduce((total, entry) => total + entry.rssBytes, 0),
  }
}

/** Merge process trees by pid so nested roots contribute RSS exactly once. */
export function mergeProcessTrees(trees) {
  const unique = new Map()
  for (const tree of trees) {
    for (const entry of tree.processes) unique.set(entry.pid, entry)
  }
  const processes = [...unique.values()]
  return {
    processes,
    rssBytes: processes.reduce((total, entry) => total + entry.rssBytes, 0),
  }
}

/** Least-squares value growth per minute for timestamped samples. */
export function linearSlopePerMinute(points) {
  if (points.length < 2) return 0
  const meanTime = points.reduce((total, point) => total + point.elapsedMs, 0) / points.length
  const meanValue = points.reduce((total, point) => total + point.value, 0) / points.length
  let covariance = 0
  let variance = 0
  for (const point of points) {
    const timeDelta = point.elapsedMs - meanTime
    covariance += timeDelta * (point.value - meanValue)
    variance += timeDelta * timeDelta
  }
  return variance === 0 ? 0 : covariance / variance * 60_000
}

/** Read one host process-table snapshot without running inside the TUI process. */
export function readProcessTable(platform = process.platform) {
  return new Promise((resolve, reject) => {
    if (platform === 'win32') {
      const command = [
        'Get-CimInstance Win32_Process',
        'Select-Object ProcessId,ParentProcessId,WorkingSetSize,Name',
        'ConvertTo-Json -Compress',
      ].join(' | ')
      execFile('powershell.exe', ['-NoProfile', '-Command', command], {
        encoding: 'utf8',
        timeout: 4_000,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
      }, (error, stdout) => {
        if (error === null) {
          resolve(parseWindowsProcessJson(stdout))
          return
        }
        const fallback = 'Get-Process | Select-Object Id,WorkingSet64,ProcessName | ConvertTo-Json -Compress'
        execFile('powershell.exe', ['-NoProfile', '-Command', fallback], {
          encoding: 'utf8',
          timeout: 4_000,
          windowsHide: true,
          maxBuffer: 16 * 1024 * 1024,
        }, (fallbackError, fallbackStdout) => {
          if (fallbackError !== null) reject(error)
          else resolve(parseWindowsProcessListJson(fallbackStdout))
        })
      })
      return
    }
    execFile('ps', ['-eo', 'pid=', '-o', 'ppid=', '-o', 'rss=', '-o', 'comm='], {
      encoding: 'utf8',
      timeout: 4_000,
      maxBuffer: 16 * 1024 * 1024,
    }, (error, stdout) => {
      if (error !== null) reject(error)
      else resolve(parsePosixProcessTable(stdout))
    })
  })
}
