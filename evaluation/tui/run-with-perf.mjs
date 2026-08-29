#!/usr/bin/env node
/** Launch the source TUI under an external process-tree sampler. */

import { appendFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { readProcessTable, walkProcessTree } from './process-tree.mjs'

const evaluationDir = dirname(fileURLToPath(import.meta.url))
const root = resolve(evaluationDir, '..', '..')
const launcher = join(root, 'apps', 'tui-cli', 'bin', 'dsh-tui.js')
const logPath = join(tmpdir(), `dsh-tui-evaluation-${process.pid}.log`)
const requestedSampleMs = Number(process.env.DSH_TUI_EVAL_SAMPLE_MS ?? 5_000)
const sampleMs = Number.isFinite(requestedSampleMs) ? Math.max(1_000, Math.min(60_000, Math.floor(requestedSampleMs))) : 5_000
writeFileSync(logPath, `[dsh-tui-eval] log=${logPath} evaluator=${process.pid} sample_ms=${sampleMs}\n`)

let viewer
if (process.platform === 'win32') {
  const escaped = logPath.replaceAll("'", "''")
  const command = `Write-Host 'DSH TUI evaluation'; Get-Content -LiteralPath '${escaped}' -Wait -Tail 120`
  viewer = spawn('powershell.exe', ['-NoProfile', '-NoExit', '-Command', command], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  })
  viewer.once('error', error => {
    appendFileSync(logPath, `[dsh-tui-eval] viewer_error=${error.message}\n`)
  })
}

const child = spawn(process.execPath, [launcher, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
})
let peakRssBytes = 0
let sampling = false
const sample = async () => {
  if (sampling || child.pid === undefined) return
  sampling = true
  const started = Date.now()
  try {
    const entries = await readProcessTable()
    const tree = walkProcessTree(child.pid, entries)
    peakRssBytes = Math.max(peakRssBytes, tree.rssBytes)
    const processes = tree.processes.map(entry => `${entry.pid}:${entry.name}:${entry.rssBytes}`).join(',')
    appendFileSync(logPath, `[dsh-tui-eval] at=${Date.now()} rss=${tree.rssBytes} peak_rss=${peakRssBytes} count=${tree.processes.length} sample_ms=${Date.now() - started} tree=${processes}\n`)
  } catch (error) {
    appendFileSync(logPath, `[dsh-tui-eval] at=${Date.now()} error=${error instanceof Error ? error.message : String(error)}\n`)
  } finally {
    sampling = false
  }
}
void sample()
const timer = setInterval(() => void sample(), sampleMs)
const forward = signal => {
  try { child.kill(signal) } catch { /* child already exited */ }
}
const onSigint = () => forward('SIGINT')
const onSigterm = () => forward('SIGTERM')
process.on('SIGINT', onSigint)
process.on('SIGTERM', onSigterm)

const outcome = await new Promise((resolveOutcome, reject) => {
  child.once('error', reject)
  child.once('exit', (code, signal) => resolveOutcome({ code, signal }))
})
clearInterval(timer)
process.off('SIGINT', onSigint)
process.off('SIGTERM', onSigterm)
appendFileSync(logPath, `[dsh-tui-eval] exit=${String(outcome.code)} signal=${String(outcome.signal)} peak_rss=${peakRssBytes}\n`)
try { viewer?.kill() } catch { /* viewer already closed */ }
if (outcome.code !== null) process.exitCode = outcome.code
else process.exitCode = outcome.signal === 'SIGINT' ? 130 : 1
