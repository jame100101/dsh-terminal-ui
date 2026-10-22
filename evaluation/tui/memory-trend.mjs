/** Analyze late RSS independently of the permissive short-run safety budget. */
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { linearSlopePerMinute } from './process-tree.mjs'

const MINUTE = 60_000, MIB = 1024 * 1024
export function summarizeMemoryTrend(report) {
  const samples = report.samples ?? []
  const elapsed = samples.at(-1)?.elapsedMs ?? 0
  const tail = samples.filter(sample => sample.elapsedMs >= elapsed - 15 * MINUTE)
  const slope = linearSlopePerMinute(tail.map(sample => ({ elapsedMs: sample.elapsedMs, value: sample.rssBytes })))
  const windows = []
  for (let start = 0; start + 5 * MINUTE <= elapsed; start += 5 * MINUTE) {
    const points = samples.filter(sample => sample.elapsedMs >= start && sample.elapsedMs < start + 5 * MINUTE)
    if (points.length) windows.push({ startMs: start, minRssBytes: Math.min(...points.map(p => p.rssBytes)), maxRssBytes: Math.max(...points.map(p => p.rssBytes)) })
  }
  // A short run, interrupted capture, or collection-assisted diagnostic cannot
  // clear the release memory check. This is evidence for this workload only.
  const valid = samples.every((p, i) => Number.isFinite(p.elapsedMs) && Number.isFinite(p.rssBytes) && p.rssBytes >= 0 && (i === 0 || p.elapsedMs > samples[i - 1].elapsedMs))
  const coverage = valid && elapsed >= 45 * MINUTE && tail.length >= 90 && tail[0].elapsedMs <= elapsed - 15 * MINUTE + 15_000 && tail.every((p, i) => i === 0 || p.elapsedMs - tail[i - 1].elapsedMs <= 15_000)
  const diagnostic = Boolean(report.forcedGcDiagnostic || report.heapSnapshotDiagnostic)
  const recent = windows.slice(-3)
  const floorGrowth = recent.length === 3 ? recent[2].minRssBytes - recent[0].minRssBytes : null
  // Require both a small late slope and stable five-minute low-water marks.
  // Preserve the original soak safety thresholds; this additional check must
  // not label a slow persistent leak PASS merely because it stays below 1 GiB.
  const status = !coverage || diagnostic || report.error || report.exitCode !== 0 ? 'UNTESTED'
    : slope > 0.5 * MIB || floorGrowth === null || floorGrowth > 8 * MIB ? 'FAIL' : 'PASS'
  return { status, measuredMs: elapsed, lateRssSlopeBytesPerMinute: slope, lateFloorGrowthBytes: floorGrowth, diagnostic, windows }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw new Error('Provide a host-soak JSON report')
  const result = summarizeMemoryTrend(JSON.parse(await readFile(process.argv[2], 'utf8')))
  console.log(JSON.stringify(result, null, 2))
  if (result.status !== 'PASS') process.exitCode = 1
}
