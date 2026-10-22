/** Pure display of host facts; no timers, provider requests or shell status scripts. */
import stringWidth from 'string-width'
import type { SessionStats } from './types'
import type { ColorRole } from './theme'
export interface StatusSegment { text: string; role: ColorRole }
const valid = (value: number): boolean => Number.isFinite(value) && value >= 0
const percent = (used: number, total: number): number | null => valid(used) && valid(total) && total > 0 ? Math.min(100, Math.round(used / total * 100)) : null
export function statusMetrics(stats: SessionStats, occupancy: { projectedTokens: number; contextWindow: number } | null): { context: number | null; capacity: number | null; cache: number | null } {
  const sample = stats.latestUsage
  const total = sample ? sample.input + sample.cacheRead + sample.cacheWrite : 0
  return {
    // Cumulative billing is never a substitute for the current context projection.
    context: occupancy ? percent(occupancy.projectedTokens, occupancy.contextWindow) : null,
    capacity: occupancy && valid(occupancy.contextWindow) && occupancy.contextWindow > 0 ? occupancy.contextWindow : null,
    cache: sample && [sample.input, sample.cacheRead, sample.cacheWrite].every(valid) ? percent(sample.cacheRead, total) : null,
  }
}
function count(value: number): string { return value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : value >= 1e3 ? `${Math.round(value / 1e3)}k` : String(Math.round(value)) }
function bar(value: number | null, cells: number, role: ColorRole): StatusSegment[] {
  if (cells === 0 || value === null) return []
  const filled = Math.round(value / 100 * cells)
  return [{ text: '■'.repeat(filled), role }, { text: '□'.repeat(cells - filled) + ' ', role: 'muted' }]
}
/** Drop bar detail at narrow widths while retaining both labels and unknown values. */
export function buildStatusLine(stats: SessionStats, occupancy: { projectedTokens: number; contextWindow: number } | null, width: number): StatusSegment[] {
  const metrics = statusMetrics(stats, occupancy)
  const contextRole: ColorRole = metrics.context === null ? 'muted' : metrics.context >= 85 ? 'error' : metrics.context >= 60 ? 'warning' : 'success'
  const cacheRole: ColorRole = metrics.cache === null ? 'muted' : metrics.cache >= 80 ? 'success' : 'warning'
  for (const cells of [10, 5, 0]) {
    const detail = cells > 0 && metrics.capacity !== null ? ` / ${count(metrics.capacity)}` : ''
    const segments: StatusSegment[] = [
      { text: cells === 0 ? 'Ctx ' : 'Context: ', role: 'info' },
      ...bar(metrics.context, cells, contextRole),
      { text: metrics.context === null ? '--' : `${metrics.context}%`, role: contextRole },
      { text: detail + ' | ', role: 'muted' },
      { text: 'Cache: ', role: 'muted' },
      ...bar(metrics.cache, cells, cacheRole),
      { text: metrics.cache === null ? '--' : `${metrics.cache}%`, role: cacheRole },
    ]
    if (stringWidth(segments.map(segment => segment.text).join('')) <= width) return segments
  }
  const compact = `Ctx ${metrics.context === null ? '--' : `${metrics.context}%`}`
  return stringWidth(compact) <= width ? [{ text: compact, role: contextRole }] : []
}
