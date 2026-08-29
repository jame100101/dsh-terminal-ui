#!/usr/bin/env node
/** Automated Windows ConPTY campaign for busy rendering and build contention. */

import { spawn } from 'node:child_process'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { linearSlopePerMinute, mergeProcessTrees, readProcessTable, walkProcessTree } from './process-tree.mjs'

const evaluationDir = dirname(fileURLToPath(import.meta.url))
const root = join(evaluationDir, '..', '..')
const fixture = join(root, 'packages', 'tui', 'tui', 'tests', 'fixtures', 'pty-app.tsx')
const require = createRequire(join(root, 'packages', 'tui', 'tui', 'package.json'))
const nodePty = require('node-pty')
const xtermHeadless = require('@xterm/headless')
const boundedNumber = (value, fallback, minimum, maximum) => {
  const number = Number(value ?? fallback)
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, Math.floor(number))) : fallback
}
const durationMs = boundedNumber(process.env.DSH_TUI_CONPTY_MS, 30 * 60 * 1_000, 5_000, 2 * 60 * 60 * 1_000)
const sampleMs = boundedNumber(process.env.DSH_TUI_CONPTY_SAMPLE_MS, 5_000, 1_000, 60_000)
const nodeCount = boundedNumber(process.env.DSH_TUI_CONPTY_NODE_COUNT, 3_000, 1, 3_000)
const updateMs = boundedNumber(process.env.DSH_TUI_CONPTY_UPDATE_MS, 40, 10, 1_000)
const busy = process.env.DSH_TUI_CONPTY_BUSY !== '0'
const childMemoryLog = join(tmpdir(), `dsh-tui-conpty-${process.pid}-${Date.now()}.jsonl`)
const runBuild = process.env.DSH_TUI_CONPTY_BUILD !== '0'
const reportPath = process.env.DSH_TUI_CONPTY_REPORT === undefined
  ? join(evaluationDir, 'conpty-soak-last.json')
  : resolve(root, process.env.DSH_TUI_CONPTY_REPORT)
const terminal = new xtermHeadless.Terminal({ cols: 100, rows: 30, allowProposedApi: true, scrollback: 0 })
const pty = nodePty.spawn(process.execPath, ['--import', 'tsx/esm', fixture], {
  cols: 100,
  rows: 30,
  cwd: root,
  name: 'xterm-256color',
  env: {
    ...process.env,
    CI: 'false',
    NODE_ENV: 'production',
    TERM: 'xterm-256color',
    TUI_PTY_BUSY: busy ? '1' : '0',
    TUI_PTY_NODE_COUNT: String(nodeCount),
    TUI_PTY_UPDATE_MS: String(updateMs),
    TUI_PTY_MEMORY_LOG: childMemoryLog,
  },
})
let parsed = Promise.resolve()
let outputBytes = 0
pty.onData((data) => {
  outputBytes += Buffer.byteLength(data)
  parsed = parsed.then(() => new Promise(resolve => terminal.write(data, resolve)))
})

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const screen = () => Array.from({ length: terminal.rows }, (_, index) => (
  terminal.buffer.active.getLine(terminal.buffer.active.viewportY + index)?.translateToString(true) ?? ''
))
async function waitFor(check, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await parsed
    if (check()) return Date.now()
    await delay(10)
  }
  throw new Error('ConPTY response timed out')
}

await waitFor(() => terminal.buffer.active.type === 'alternate' && screen().some(line => line.trimStart().startsWith('›')), 10_000)
const started = Date.now()
const inputLatencies = []
const samples = []
let lastThinking = ''
let lastThinkingChange = started
let maxThinkingStallMs = 0
let permissionIndex = 0
const permissions = ['read only', 'workspace write', 'full access']
let buildRuns = 0
let buildFailures = 0
let buildOutputBytes = 0
let activeBuild
let stopping = false
let campaignEndedAt = started
let campaignError = null

const buildLoop = async () => {
  while (!stopping) {
    const command = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'pnpm'
    const args = process.platform === 'win32'
      ? ['/d', '/s', '/c', 'npm.cmd run build:lib:host']
      : ['run', 'build:lib:host']
    activeBuild = spawn(command, args, {
      cwd: root,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    activeBuild.stdout?.on('data', chunk => { buildOutputBytes += chunk.length })
    activeBuild.stderr?.on('data', chunk => { buildOutputBytes += chunk.length })
    const code = await new Promise(resolve => {
      activeBuild.once('error', () => resolve(1))
      activeBuild.once('exit', exitCode => resolve(exitCode ?? 1))
    })
    buildRuns += 1
    if (code !== 0) buildFailures += 1
    activeBuild = undefined
    if (!stopping) await delay(250)
  }
}
const buildPromise = runBuild ? buildLoop() : Promise.resolve()

let sampleBusy = false
const sample = async () => {
  if (sampleBusy) return
  sampleBusy = true
  try {
    const entries = await readProcessTable()
    const tuiTree = walkProcessTree(pty.pid, entries)
    const evaluatorTree = walkProcessTree(process.pid, entries)
    const buildTree = activeBuild?.pid === undefined ? { processes: [], rssBytes: 0 } : walkProcessTree(activeBuild.pid, entries)
    const completeTree = mergeProcessTrees([tuiTree, evaluatorTree, buildTree])
    samples.push({
      elapsedMs: Date.now() - started,
      tuiRssBytes: tuiTree.rssBytes,
      completeRssBytes: completeTree.rssBytes,
      outputBytes,
      buildOutputBytes,
      buildRuns,
      buildFailures,
      processTreeComplete: entries.some(entry => entry.ppid > 0),
    })
    if (samples.length > 720) samples.shift()
  } finally {
    sampleBusy = false
  }
}

try {
  let iteration = 0
  while (Date.now() - started < durationMs) {
    const sentAt = Date.now()
    pty.write('z')
    await waitFor(() => screen().some(line => line.trimStart().startsWith('›') && line.includes('z')))
    inputLatencies.push(Date.now() - sentAt)
    pty.write('\x7f')
    await waitFor(() => screen().some(line => line.trimStart().startsWith('›') && !line.includes('z')))
    if (iteration % 8 === 0) {
      pty.write('\x1b[5~')
      await delay(50)
      pty.write('\x1b[6~')
    }
    if (iteration % 20 === 0) {
      pty.write('\x1b[9;2u')
      pty.write('\x1b[9;2:3u')
      permissionIndex = (permissionIndex + 1) % permissions.length
      await waitFor(() => screen().some(line => line.includes(permissions[permissionIndex])))
    }
    const thinking = screen().find(line => /Thinking \d+\.\ds/u.test(line)) ?? ''
    if (thinking !== lastThinking) {
      maxThinkingStallMs = Math.max(maxThinkingStallMs, Date.now() - lastThinkingChange)
      lastThinking = thinking
      lastThinkingChange = Date.now()
    }
    if (Date.now() - (samples.at(-1)?.elapsedMs ?? -sampleMs) - started >= sampleMs) {
      // Process-table collection may take seconds under a saturated Windows
      // build. Keep it off the interaction/Thinking observation path so the
      // evaluator does not manufacture the stall it is trying to measure.
      void sample().catch((error) => {
        campaignError ??= error instanceof Error ? error.message : String(error)
      })
    }
    iteration += 1
    await delay(100)
  }
} catch (error) {
  campaignError = error instanceof Error ? error.message : String(error)
} finally {
  campaignEndedAt = Date.now()
  maxThinkingStallMs = Math.max(maxThinkingStallMs, campaignEndedAt - lastThinkingChange)
  stopping = true
  try { pty.kill() } catch { /* PTY already exited */ }
  await buildPromise
}

while (sampleBusy) await delay(10)
let childMemorySamples = []
try {
  const memoryText = await readFile(childMemoryLog, 'utf8')
  childMemorySamples = memoryText.trim().split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line))
} catch (error) {
  campaignError ??= error instanceof Error ? error.message : String(error)
} finally {
  await rm(childMemoryLog, { force: true })
}
const sortedLatencies = [...inputLatencies].sort((left, right) => left - right)
const percentile = quantile => sortedLatencies[Math.min(sortedLatencies.length - 1, Math.floor(sortedLatencies.length * quantile))] ?? 0
const warmupMs = Math.min(5 * 60_000, (campaignEndedAt - started) / 4)
const postWarmupTuiRssSlopeBytesPerMinute = linearSlopePerMinute(samples
  .filter(entry => entry.elapsedMs >= warmupMs && entry.elapsedMs <= campaignEndedAt - started && entry.tuiRssBytes > 0)
  .map(entry => ({ elapsedMs: entry.elapsedMs, value: entry.tuiRssBytes })))
const report = {
  durationMs: campaignEndedAt - started,
  cleanupMs: Date.now() - campaignEndedAt,
  requestedDurationMs: durationMs,
  nodeCount,
  updateMs,
  busy,
  runBuild,
  campaignError,
  buildRuns,
  buildFailures,
  buildOutputBytes,
  outputBytes,
  inputSamples: inputLatencies.length,
  inputLatencyMs: { p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99), max: sortedLatencies.at(-1) ?? 0 },
  maxThinkingStallMs,
  peakTuiRssBytes: Math.max(0, ...samples.map(entry => entry.tuiRssBytes)),
  peakCompleteRssBytes: Math.max(0, ...samples.map(entry => entry.completeRssBytes)),
  processTreeComplete: samples.length > 0 && samples.every(entry => entry.processTreeComplete),
  peakTuiHeapUsedBytes: Math.max(0, ...childMemorySamples.map(entry => entry.heapUsed)),
  postWarmupTuiRssSlopeBytesPerMinute,
  childMemorySamples,
  samples,
}
await writeFile(reportPath, `${JSON.stringify(report, undefined, 2)}\n`)
process.stderr.write(`[dsh-conpty] wrote ${reportPath} input_p95=${report.inputLatencyMs.p95}ms tui_peak=${report.peakTuiRssBytes} build_runs=${buildRuns} failures=${buildFailures}\n`)
if (
  buildFailures > 0 ||
  report.campaignError !== null ||
  report.inputLatencyMs.p95 > 250 ||
  report.maxThinkingStallMs > 1_500 ||
  report.peakTuiRssBytes > 1_000_000_000 ||
  report.postWarmupTuiRssSlopeBytesPerMinute > 16 * 1024 * 1024
) {
  process.exitCode = 1
}
