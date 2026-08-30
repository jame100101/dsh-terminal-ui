#!/usr/bin/env node

/**
 * Reduce a Windows process-tree monitor CSV into a compact evidence record and
 * two self-contained SVG memory charts.
 *
 * Usage:
 *   node evaluation/tui/summarize-monitor.mjs CSV TASK_START TASK_END OUTPUT_STEM
 */

import { createHash } from 'node:crypto'
import { basename, dirname, resolve } from 'node:path'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const [, , csvArg, taskStartArg, taskEndArg, outputStemArg] = process.argv

if (!csvArg || !taskStartArg || !taskEndArg || !outputStemArg) {
  throw new Error('Usage: summarize-monitor.mjs CSV TASK_START TASK_END OUTPUT_STEM')
}

const csvPath = resolve(csvArg)
const outputStem = resolve(outputStemArg)
const taskStartMs = Date.parse(taskStartArg)
const taskEndMs = Date.parse(taskEndArg)

if (!Number.isFinite(taskStartMs) || !Number.isFinite(taskEndMs) || taskEndMs <= taskStartMs) {
  throw new Error('TASK_START and TASK_END must be ordered ISO-8601 timestamps.')
}

const csvBytes = readFileSync(csvPath)
const csvText = csvBytes.toString('utf8').replace(/^\uFEFF/, '').trim()
const [headerLine, ...dataLines] = csvText.split(/\r?\n/u)
const headers = parseCsvLine(headerLine)
const rows = dataLines.map((line) => {
  const values = parseCsvLine(line)
  const record = Object.fromEntries(headers.map((header, index) => [header, values[index]]))
  return {
    timestamp: record.timestamp,
    timeMs: Date.parse(record.timestamp),
    elapsedSeconds: Number(record.elapsed_s),
    launcherPid: Number(record.launcher_pid),
    tuiPid: Number(record.tui_pid),
    tuiRssMb: Number(record.tui_rss_mb),
    tuiPrivateMb: Number(record.tui_private_mb),
    tuiCpuSeconds: Number(record.tui_cpu_s),
    nodeProcesses: Number(record.node_processes),
    nodeRssMb: Number(record.node_rss_mb),
    treeProcesses: Number(record.tree_processes),
    treeRssMb: Number(record.tree_rss_mb),
    treePrivateMb: Number(record.tree_private_mb),
    treeCpuSeconds: Number(record.tree_cpu_s),
    treeHandles: Number(record.tree_handles),
    treeThreads: Number(record.tree_threads),
  }
})

if (rows.length < 2 || rows.some(row => !Number.isFinite(row.timeMs))) {
  throw new Error('CSV does not contain at least two valid monitor samples.')
}

const taskRows = rows.filter(row => row.timeMs >= taskStartMs && row.timeMs <= taskEndMs)
if (taskRows.length < 2) {
  throw new Error('The requested task window has fewer than two monitor samples.')
}

mkdirSync(dirname(outputStem), { recursive: true })

const intervals = rows.slice(1).map((row, index) => row.elapsedSeconds - rows[index].elapsedSeconds)
const fullTask = summarizeWindow(taskRows)
const last60Rows = taskRows.filter(row => row.timeMs >= taskEndMs - 60 * 60_000)
const last30Rows = taskRows.filter(row => row.timeMs >= taskEndMs - 30 * 60_000)
const last60 = summarizeWindow(last60Rows)
const last30 = summarizeWindow(last30Rows)
const tuiPeak = peak(taskRows, 'tuiRssMb')
const treePeak = peak(taskRows, 'treeRssMb')
const privatePeak = peak(taskRows, 'tuiPrivateMb')
const taskFirst = taskRows[0]
const taskLast = taskRows.at(-1)

const summary = {
  schemaVersion: 1,
  source: {
    file: basename(csvPath),
    sha256: createHash('sha256').update(csvBytes).digest('hex'),
    monitorStartedAt: rows[0].timestamp,
    monitorEndedAt: rows.at(-1).timestamp,
    monitorDurationMinutes: round((rows.at(-1).elapsedSeconds - rows[0].elapsedSeconds) / 60, 3),
  },
  declaredTaskWindow: {
    startedAt: new Date(taskStartMs).toISOString(),
    endedAt: new Date(taskEndMs).toISOString(),
    durationMinutes: round((taskEndMs - taskStartMs) / 60_000, 3),
    firstSampleAt: taskFirst.timestamp,
    lastSampleAt: taskLast.timestamp,
    samples: taskRows.length,
  },
  sampling: {
    totalSamples: rows.length,
    intervalSeconds: {
      min: round(Math.min(...intervals), 2),
      p50: round(quantile(intervals, 0.5), 2),
      p95: round(quantile(intervals, 0.95), 2),
      max: round(Math.max(...intervals), 2),
    },
    gapsOverSevenSeconds: intervals.filter(value => value > 7).length,
  },
  continuity: {
    launcherPids: unique(rows.map(row => row.launcherPid)),
    tuiPids: unique(rows.map(row => row.tuiPid)),
    missingTuiSamples: rows.filter(row => row.tuiPid === 0).length,
    treeProcessCounts: unique(rows.map(row => row.treeProcesses)),
    nodeProcessCounts: unique(rows.map(row => row.nodeProcesses)),
  },
  task: {
    tuiRssMb: metricSummary(taskRows, 'tuiRssMb'),
    tuiPrivateMb: metricSummary(taskRows, 'tuiPrivateMb'),
    treeRssMb: metricSummary(taskRows, 'treeRssMb'),
    treePrivateMb: metricSummary(taskRows, 'treePrivateMb'),
    peaks: {
      tuiRssMb: point(tuiPeak, 'tuiRssMb'),
      tuiPrivateMb: point(privatePeak, 'tuiPrivateMb'),
      treeRssMb: point(treePeak, 'treeRssMb'),
    },
    cpu: {
      tuiCpuSeconds: round(taskLast.tuiCpuSeconds - taskFirst.tuiCpuSeconds, 2),
      tuiPercentOfOneCore: round(
        100 * (taskLast.tuiCpuSeconds - taskFirst.tuiCpuSeconds)
          / ((taskLast.timeMs - taskFirst.timeMs) / 1000),
        2,
      ),
      treeCpuSeconds: round(taskLast.treeCpuSeconds - taskFirst.treeCpuSeconds, 2),
      treePercentOfOneCore: round(
        100 * (taskLast.treeCpuSeconds - taskFirst.treeCpuSeconds)
          / ((taskLast.timeMs - taskFirst.timeMs) / 1000),
        2,
      ),
    },
    handles: {
      start: taskFirst.treeHandles,
      end: taskLast.treeHandles,
      max: Math.max(...taskRows.map(row => row.treeHandles)),
      last60SlopePerMinute: regression(last60Rows, 'treeHandles').slope,
      last60RSquared: regression(last60Rows, 'treeHandles').rSquared,
    },
    threads: {
      start: taskFirst.treeThreads,
      end: taskLast.treeThreads,
      max: Math.max(...taskRows.map(row => row.treeThreads)),
    },
  },
  windows: {
    fullTask,
    last60Minutes: last60,
    last30Minutes: last30,
  },
  fiveMinuteBlocks: fiveMinuteBlocks(taskRows, taskStartMs, taskEndMs),
  limitations: [
    'The CSV records operating-system process metrics, not V8 heap spaces or external memory.',
    'The CSV does not record stdout writableLength, frame drops, input latency, or animation stalls.',
    'The working tree changed concurrently during the run; the evidence applies to the already-running process, not every final dirty-tree file.',
  ],
}

writeFileSync(`${outputStem}-summary.json`, `${JSON.stringify(summary, null, 2)}\n`)
writeFileSync(`${outputStem}-memory.svg`, renderChart({
  rows: taskRows,
  title: 'dsh-tui two-hour long-task memory',
  subtitle: '120.26-minute task window; OS process metrics; five-second sampling',
  startMs: taskStartMs,
  endMs: taskEndMs,
  yMin: 0,
  yMax: 1_000,
  tickStep: 200,
  peakRow: tuiPeak,
}))
writeFileSync(`${outputStem}-last60.svg`, renderChart({
  rows: last60Rows,
  title: 'dsh-tui post-warm-up memory detail',
  subtitle: 'Last 60 minutes; TUI RSS slope +0.28 MiB/min (R² 0.11)',
  startMs: taskEndMs - 60 * 60_000,
  endMs: taskEndMs,
  yMin: 350,
  yMax: 800,
  tickStep: 100,
}))

process.stdout.write(`${outputStem}-summary.json\n${outputStem}-memory.svg\n${outputStem}-last60.svg\n`)

/** Parse one RFC 4180-style CSV line containing quoted monitor fields. */
function parseCsvLine(line) {
  const values = []
  let value = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (char === ',' && !quoted) {
      values.push(value)
      value = ''
    } else {
      value += char
    }
  }
  values.push(value)
  return values
}

/** Return a sorted numeric quantile using the nearest lower observation. */
function quantile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor((sorted.length - 1) * fraction)]
}

/** Return the least-squares slope per minute and coefficient of determination. */
function regression(windowRows, field) {
  const firstTime = windowRows[0].timeMs
  const points = windowRows.map(row => ({
    x: (row.timeMs - firstTime) / 60_000,
    y: row[field],
  }))
  const meanX = points.reduce((sum, item) => sum + item.x, 0) / points.length
  const meanY = points.reduce((sum, item) => sum + item.y, 0) / points.length
  let xx = 0
  let xy = 0
  for (const item of points) {
    xx += (item.x - meanX) ** 2
    xy += (item.x - meanX) * (item.y - meanY)
  }
  const slope = xy / xx
  const intercept = meanY - slope * meanX
  let residual = 0
  let total = 0
  for (const item of points) {
    residual += (item.y - (intercept + slope * item.x)) ** 2
    total += (item.y - meanY) ** 2
  }
  return {
    slope: round(slope, 3),
    rSquared: round(total === 0 ? 1 : 1 - residual / total, 3),
  }
}

/** Summarize one numeric field over a row window. */
function metricSummary(windowRows, field) {
  const values = windowRows.map(row => row[field])
  const trend = regression(windowRows, field)
  return {
    start: windowRows[0][field],
    end: windowRows.at(-1)[field],
    delta: round(windowRows.at(-1)[field] - windowRows[0][field], 2),
    min: Math.min(...values),
    p50: round(quantile(values, 0.5), 2),
    p95: round(quantile(values, 0.95), 2),
    max: Math.max(...values),
    slopePerMinute: trend.slope,
    rSquared: trend.rSquared,
  }
}

/** Summarize a complete time window for the report comparison table. */
function summarizeWindow(windowRows) {
  return {
    samples: windowRows.length,
    durationMinutes: round((windowRows.at(-1).timeMs - windowRows[0].timeMs) / 60_000, 3),
    tuiRssMb: metricSummary(windowRows, 'tuiRssMb'),
    tuiPrivateMb: metricSummary(windowRows, 'tuiPrivateMb'),
    treeRssMb: metricSummary(windowRows, 'treeRssMb'),
  }
}

/** Aggregate the task into stable five-minute distribution blocks. */
function fiveMinuteBlocks(windowRows, startMs, endMs) {
  const blocks = []
  for (let blockStart = startMs; blockStart < endMs; blockStart += 5 * 60_000) {
    const blockRows = windowRows.filter(row => row.timeMs >= blockStart && row.timeMs < blockStart + 5 * 60_000)
    if (blockRows.length === 0) continue
    blocks.push({
      minute: Math.round((blockStart - startMs) / 60_000),
      samples: blockRows.length,
      tuiRssMinMb: Math.min(...blockRows.map(row => row.tuiRssMb)),
      tuiRssMedianMb: round(quantile(blockRows.map(row => row.tuiRssMb), 0.5), 2),
      tuiRssMaxMb: Math.max(...blockRows.map(row => row.tuiRssMb)),
      tuiPrivateMedianMb: round(quantile(blockRows.map(row => row.tuiPrivateMb), 0.5), 2),
      treeRssMedianMb: round(quantile(blockRows.map(row => row.treeRssMb), 0.5), 2),
    })
  }
  return blocks
}

/** Find the row with the largest value for a field. */
function peak(windowRows, field) {
  return windowRows.reduce((best, row) => row[field] > best[field] ? row : best)
}

/** Format a peak point for JSON without retaining the complete source row. */
function point(row, field) {
  return { value: row[field], timestamp: row.timestamp }
}

/** Return sorted distinct numeric values. */
function unique(values) {
  return [...new Set(values)].sort((left, right) => left - right)
}

/** Round a number to a fixed count of decimal places. */
function round(value, digits) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** Render a self-contained SVG line chart for TUI and process-tree memory. */
function renderChart({ rows: chartRows, title, subtitle, startMs, endMs, yMin, yMax, tickStep, peakRow }) {
  const width = 1_200
  const height = 560
  const left = 82
  const right = 30
  const top = 86
  const bottom = 70
  const plotWidth = width - left - right
  const plotHeight = height - top - bottom
  const x = timeMs => left + ((timeMs - startMs) / (endMs - startMs)) * plotWidth
  const y = value => top + (1 - (value - yMin) / (yMax - yMin)) * plotHeight
  const path = field => chartRows.map((row, index) => `${index === 0 ? 'M' : 'L'}${round(x(row.timeMs), 1)},${round(y(row[field]), 1)}`).join(' ')
  const horizontal = []
  for (let value = yMin; value <= yMax; value += tickStep) {
    horizontal.push(`<line x1="${left}" y1="${y(value)}" x2="${width - right}" y2="${y(value)}" class="grid"/>`)
    horizontal.push(`<text x="${left - 12}" y="${y(value) + 5}" text-anchor="end" class="axis">${value}</text>`)
  }
  const vertical = []
  const durationMinutes = Math.round((endMs - startMs) / 60_000)
  const xTick = durationMinutes > 60 ? 20 : 10
  for (let minute = 0; minute <= durationMinutes; minute += xTick) {
    const position = x(startMs + minute * 60_000)
    vertical.push(`<line x1="${position}" y1="${top}" x2="${position}" y2="${height - bottom}" class="grid"/>`)
    vertical.push(`<text x="${position}" y="${height - bottom + 28}" text-anchor="middle" class="axis">${minute}</text>`)
  }
  const peakMarkup = peakRow
    ? `<circle cx="${x(peakRow.timeMs)}" cy="${y(peakRow.tuiRssMb)}" r="5" fill="#d73a49"/><text x="${x(peakRow.timeMs) + 10}" y="${y(peakRow.tuiRssMb) - 10}" class="annotation">TUI peak ${peakRow.tuiRssMb.toFixed(1)} MiB</text>`
    : ''
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description">
  <title id="title">${title}</title>
  <desc id="description">${subtitle}. Lines show TUI RSS, TUI private bytes, and complete monitored process-tree RSS.</desc>
  <style>
    .title{font:600 24px 'Segoe UI',sans-serif;fill:#1f2328}.subtitle{font:14px 'Segoe UI',sans-serif;fill:#57606a}.axis{font:13px 'Segoe UI',sans-serif;fill:#57606a}.label{font:600 13px 'Segoe UI',sans-serif;fill:#24292f}.annotation{font:600 13px 'Segoe UI',sans-serif;fill:#b4232f}.grid{stroke:#d8dee4;stroke-width:1}.plot{fill:#ffffff;stroke:#8c959f;stroke-width:1}.series{fill:none;stroke-width:2.2;stroke-linejoin:round;stroke-linecap:round}
  </style>
  <rect width="${width}" height="${height}" fill="#f6f8fa"/>
  <text x="${left}" y="36" class="title">${title}</text>
  <text x="${left}" y="61" class="subtitle">${subtitle}</text>
  <rect x="${left}" y="${top}" width="${plotWidth}" height="${plotHeight}" class="plot"/>
  ${horizontal.join('\n  ')}
  ${vertical.join('\n  ')}
  <path d="${path('treeRssMb')}" class="series" stroke="#bf8700"/>
  <path d="${path('tuiPrivateMb')}" class="series" stroke="#8250df"/>
  <path d="${path('tuiRssMb')}" class="series" stroke="#0969da"/>
  ${peakMarkup}
  <text x="${left - 58}" y="${top - 14}" class="label">MiB</text>
  <text x="${left + plotWidth / 2}" y="${height - 18}" text-anchor="middle" class="label">Minutes in chart window</text>
  <line x1="${width - 390}" y1="38" x2="${width - 350}" y2="38" class="series" stroke="#0969da"/><text x="${width - 340}" y="43" class="axis">TUI RSS</text>
  <line x1="${width - 270}" y1="38" x2="${width - 230}" y2="38" class="series" stroke="#8250df"/><text x="${width - 220}" y="43" class="axis">TUI private</text>
  <line x1="${width - 125}" y1="38" x2="${width - 85}" y2="38" class="series" stroke="#bf8700"/><text x="${width - 75}" y="43" class="axis">Tree RSS</text>
</svg>
`
}
