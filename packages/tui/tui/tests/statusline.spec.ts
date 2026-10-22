import { describe, expect, it } from 'vitest'
import stringWidth from 'string-width'
import { initialState } from '../src/fold'
import { buildStatusLine, statusMetrics } from '../src/statusline'

describe('host-backed status line', () => {
  it('uses latest reported cache input, not lifetime billing or output tokens', () => {
    const stats = initialState().stats
    stats.tokens = { input: 1000000, output: 500000, cacheRead: 0, cacheWrite: 0, reasoning: 80000 }
    stats.latestUsage = { input: 200, cacheRead: 600, cacheWrite: 200, output: 9000, reasoning: 8000 }
    expect(statusMetrics(stats, { projectedTokens: 50000, contextWindow: 1000000 })).toEqual({ context: 5, capacity: 1000000, cache: 60 })
  })
  it('does not invent context from cumulative tokens or treat missing samples as zero', () => {
    const stats = initialState().stats
    stats.tokens.input = 500000; stats.contextWindow = 1000000
    expect(statusMetrics(stats, null)).toEqual({ context: null, capacity: null, cache: null })
    const text = buildStatusLine(stats, null, 80).map(s => s.text).join('')
    expect(text).toContain('Context: --'); expect(text).toContain('Cache: --')
  })
  it('preserves measured zero occupancy and rejects invalid samples', () => {
    const stats = initialState().stats
    expect(statusMetrics(stats, { projectedTokens: 0, contextWindow: 1000 }).context).toBe(0)
    expect(statusMetrics(stats, { projectedTokens: NaN, contextWindow: 1000 }).context).toBeNull()
    stats.latestUsage = { input: 100, cacheRead: -10, cacheWrite: 0, output: 0, reasoning: 0 }
    expect(statusMetrics(stats, null).cache).toBeNull()
  })
  it.each([24, 40, 60, 80, 120])('fits %i cells and retains both metrics', width => {
    const stats = initialState().stats
    stats.latestUsage = { input: 340, cacheRead: 660, cacheWrite: 0, output: 10, reasoning: 0 }
    const segments = buildStatusLine(stats, { projectedTokens: 50000, contextWindow: 1000000 }, width)
    const text = segments.map(s => s.text).join('')
    expect(stringWidth(text)).toBeLessThanOrEqual(width)
    expect(text).toContain('5%'); expect(text).toContain('66%'); expect(text).toContain('Cache:')
    if (width >= 80) { expect(text).toContain('1.0M'); expect(text).toContain('■') }
  })
  it('shows compaction projection reductions immediately and caps bar overflow', () => {
    const stats = initialState().stats
    expect(statusMetrics(stats, { projectedTokens: 900, contextWindow: 1000 }).context).toBe(90)
    expect(statusMetrics(stats, { projectedTokens: 100, contextWindow: 1000 }).context).toBe(10)
    expect(statusMetrics(stats, { projectedTokens: 1100, contextWindow: 1000 }).context).toBe(100)
  })
})
