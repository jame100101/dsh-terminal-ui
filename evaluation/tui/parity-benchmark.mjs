#!/usr/bin/env node
/** Run: node evaluation/tui/parity-benchmark.mjs [output.json]
 * Pure-function microbenchmark, not keyboard-to-paint latency or a renderer A/B.
 * Fixtures are synthetic and contain no credentials or user session content.
 */
import { tsImport } from 'tsx/esm/api'
import { performance } from 'node:perf_hooks'
import { cpus, platform, arch, release } from 'node:os'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const { selectTranscriptBlocksWindow } = await tsImport('../../packages/tui/tui/src/viewport.ts', import.meta.url)
const { wrapDisplayLines, wrapLiveAssistantText } = await tsImport('../../packages/tui/tui/src/wrap.ts', import.meta.url)
const { nextGraphemeBoundary, previousGraphemeBoundary } = await tsImport('../../packages/tui/tui/src/input/editor-state.ts', import.meta.url)
const warmups = 3
const sampleCount = 21
let sink = 0
function measure(name, action) {
  for (let i = 0; i < warmups; i++) sink += action()
  const beforeMemory = process.memoryUsage()
  const beforeCpu = process.cpuUsage()
  let peakRss = beforeMemory.rss
  let peakHeap = beforeMemory.heapUsed
  const samples = []
  for (let i = 0; i < sampleCount; i++) {
    const start = performance.now()
    sink += action()
    samples.push(performance.now() - start)
    const memory = process.memoryUsage()
    peakRss = Math.max(peakRss, memory.rss)
    peakHeap = Math.max(peakHeap, memory.heapUsed)
  }
  const cpu = process.cpuUsage(beforeCpu)
  const afterMemory = process.memoryUsage()
  const sorted = [...samples].sort((a, b) => a - b)
  const percentile = p => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)]
  return { name, samplesMs: samples, p50Ms: percentile(0.5), p95Ms: percentile(0.95), p99Ms: percentile(0.99),
    cpuUserMs: cpu.user / 1000, cpuSystemMs: cpu.system / 1000,
    rssBeforeBytes: beforeMemory.rss, rssAfterBytes: afterMemory.rss, rssSampledPeakBytes: peakRss,
    heapBeforeBytes: beforeMemory.heapUsed, heapAfterBytes: afterMemory.heapUsed, heapSampledPeakBytes: peakHeap }
}
const sizes = [1_000, 10_000, 100_000]
const scenarios = []
for (const logicalLines of sizes) {
  const rows = Array.from({ length: logicalLines }, (_, i) => ({ key: `line:${i}`, text: `${i} source 中文 🙂 abcdefghijklmnop` }))
  const blocks = []
  for (let i = 0; i < rows.length; i += 50) blocks.push(rows.slice(i, i + 50))
  const source = rows.map(row => row.text).join('\n')
  const previous = wrapLiveAssistantText(null, source, 80)
  const appended = `${source}\nstream 中文 👩‍💻 next`
  const measurements = [
    measure('viewport-middle-projection', () => {
      const window = selectTranscriptBlocksWindow(blocks, 40, Math.floor(logicalLines / 2), 32)
      if (window.lines.length > 104 || window.totalCount !== logicalLines) throw new Error('Unbounded or invalid viewport')
      return window.lines.length
    }),
    measure('full-source-wrap', () => wrapDisplayLines(source, 80).length),
    measure('incremental-append-wrap', () => wrapLiveAssistantText(previous, appended, 80).lines.length),
  ]
  scenarios.push({ logicalLines, sourceCodeUnits: source.length, blocks: blocks.length, measurements })
  process.stderr.write(`measured ${logicalLines} logical lines\n`)
}
const draft = '中文👩‍💻e\u0301 input '.repeat(80)
const input = measure('grapheme-boundary-at-draft-tail', () => {
  const previous = previousGraphemeBoundary(draft, draft.length)
  const next = nextGraphemeBoundary(draft, previous)
  if (next !== draft.length) throw new Error('Grapheme roundtrip mismatch')
  return next
})
const trackedSources = ['packages/tui/tui/src/viewport.ts', 'packages/tui/tui/src/wrap.ts', 'packages/tui/tui/src/input/editor-state.ts', 'evaluation/tui/parity-benchmark.mjs']
const report = {
  schemaVersion: 1, recordedAt: new Date().toISOString(),
  scope: 'Pure viewport projection, full and incremental text wrapping, and input boundary microbenchmarks',
  limitations: [
    'Not input-to-visible latency; no React render, terminal, ANSI output, backpressure, network or host execution measured.',
    'No Claude Code comparison and no evidence justifying renderer replacement.',
    '21 warm samples: p99 is the maximum, not a reliable tail-latency population estimate.',
    'Memory is shared-process before/after and sampled after each operation, not allocation or in-operation peak; GC is uncontrolled.',
    'Source SHA256 values identify possibly uncommitted benchmark inputs; HEAD alone does not identify them.',
  ],
  environment: { node: process.version, platform: platform(), architecture: arch(), osRelease: release(), cpu: cpus()[0]?.model },
  head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceSha256: Object.fromEntries(trackedSources.map(path => [path, createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex')])),
  configuration: { warmups, sampleCount, width: 80, viewportRows: 40, overscanRows: 32, logicalLinesPerBlock: 50 },
  scenarios, input: { draftCodeUnits: draft.length, measurement: input }, sink,
}
const json = JSON.stringify(report, null, 2) + '\n'
if (process.argv[2]) {
  const output = resolve(process.argv[2]); mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, json)
  process.stderr.write(`saved ${output}\n`)
} else process.stdout.write(json)
