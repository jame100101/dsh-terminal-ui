import { expect, it } from 'vitest'
import { summarizeMemoryTrend } from '../evaluation/tui/memory-trend.mjs'
const MIB = 1024 * 1024
function report(value: (minute: number) => number, minutes = 60) {
  return { exitCode: 0, error: null, samples: Array.from({ length: minutes * 12 + 1 }, (_, i) => ({ elapsedMs: i * 5000, rssBytes: value(i / 12) * MIB })) }
}
it('accepts a long warm-up followed by bounded late allocations', () => {
  expect(summarizeMemoryTrend(report(m => m < 25 ? 200 + 10 * m : 450 + 3 * Math.sin(m))).status).toBe('PASS')
})
it('rejects slow persistent RSS growth below the old 16 MiB/min safety budget', () => {
  const result = summarizeMemoryTrend(report(m => 300 + m))
  expect(result.status).toBe('FAIL')
  expect(result.lateRssSlopeBytesPerMinute).toBeCloseTo(MIB)
})
it('does not let an early fall hide a late leak', () => {
  expect(summarizeMemoryTrend(report(m => m < 40 ? 800 - 10 * m : 400 + 2 * (m - 40))).status).toBe('FAIL')
})
it('refuses short, forced-GC, incomplete or failed evidence', () => {
  expect(summarizeMemoryTrend(report(() => 300, 30)).status).toBe('UNTESTED')
  expect(summarizeMemoryTrend({ ...report(() => 300), forcedGcDiagnostic: true }).status).toBe('UNTESTED')
  expect(summarizeMemoryTrend({ ...report(() => 300), heapSnapshotDiagnostic: true }).status).toBe('UNTESTED')
  expect(summarizeMemoryTrend({ ...report(() => 300), error: 'tool failed' }).status).toBe('UNTESTED')
  expect(summarizeMemoryTrend(report(() => Number.NaN)).status).toBe('UNTESTED')
  const missing = report(() => 300)
  missing.samples = missing.samples.filter(p => p.elapsedMs < 50 * 60000 || p.elapsedMs > 55 * 60000)
  expect(summarizeMemoryTrend(missing).status).toBe('UNTESTED')
})
