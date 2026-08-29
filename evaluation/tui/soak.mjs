#!/usr/bin/env node
/**
 * Keyless continuous-session projection soak. Default duration is two hours.
 *
 *   node --import tsx/esm evaluation/tui/soak.mjs
 *   TUI_SOAK_MS=2000 node --import tsx/esm evaluation/tui/soak.mjs
 *
 * One runner retains one fold, parser, scratch, and append-only event list for
 * the whole wall-clock interval. Official session-log bytes are reported as
 * the process memory floor. Real ConPTY coverage remains in terminal-pty.spec.
 */
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTuiSoakRunner } from '../../packages/tui/tui/src/soak-workload.ts'

const TWO_HOURS_MS = 2 * 60 * 60 * 1000
const budgetMs = Number(process.env.TUI_SOAK_MS ?? TWO_HOURS_MS)
const turnIntervalMs = Number(process.env.TUI_SOAK_TURN_MS ?? 100)
const sampleIntervalMs = Number(process.env.TUI_SOAK_SAMPLE_MS ?? 5_000)
const maxHeapBytes = Number(process.env.TUI_SOAK_MAX_HEAP_BYTES ?? 2_000_000_000)
const maxRssBytes = Number(process.env.TUI_SOAK_MAX_RSS_BYTES ?? 3_000_000_000)
const maxReports = Number(process.env.TUI_SOAK_MAX_REPORTS ?? 1_440)
const started = Date.now()
const reports = []
const runner = await createTuiSoakRunner()
let nextSampleAt = started
let failed = false
while (Date.now() - started < budgetMs) {
  const turnStarted = Date.now()
  const report = runner.advance(1)
  if (Date.now() >= nextSampleAt) {
    reports.push({ ...report, elapsedMs: Date.now() - started })
    if (reports.length > maxReports) reports.shift()
    process.stderr.write(
      `[dsh-soak] elapsed=${Date.now() - started}ms rounds=${report.rounds} fold=${report.foldNodes}/${report.foldChars} session=${report.sessionEvents}/${report.sessionBytes} parser_peak=${report.parserPendingPeak} heap=${report.heapUsed} rss=${report.rss}\n`,
    )
    nextSampleAt = Date.now() + sampleIntervalMs
  }
  if (report.foldChars > report.foldCharBudget || report.heapUsed > maxHeapBytes || report.rss > maxRssBytes) {
    process.stderr.write(`[dsh-soak] FAIL budget fold=${report.foldChars}/${report.foldCharBudget} heap=${report.heapUsed}/${maxHeapBytes} rss=${report.rss}/${maxRssBytes}\n`)
    failed = true
    break
  }
  const waitMs = Math.max(0, turnIntervalMs - (Date.now() - turnStarted))
  if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs))
}
const finalReport = runner.report()
if (reports.at(-1)?.rounds !== finalReport.rounds) reports.push({ ...finalReport, elapsedMs: Date.now() - started })
const out = join(dirname(fileURLToPath(import.meta.url)), 'soak-last.json')
await writeFile(out, `${JSON.stringify({
  budgetMs,
  turnIntervalMs,
  sampleIntervalMs,
  maxHeapBytes,
  maxRssBytes,
  maxReports,
  failed,
  finalReport,
  reports,
}, undefined, 2)}\n`)
process.stderr.write(`[dsh-soak] wrote ${out} rounds=${finalReport.rounds} failed=${failed}\n`)
if (failed) process.exitCode = 1
