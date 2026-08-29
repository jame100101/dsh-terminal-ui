import { describe, expect, it } from 'vitest'
import { createTuiSoakRunner, runTuiSoak } from '../src/soak-workload'
import { MAX_FOLD_CHARS } from '../src/fold'

describe('TUI soak budgets', () => {
  it('keeps fold, parser, and session-log estimates inside product caps on a compressed soak', async () => {
    const report = await runTuiSoak(1_000)
    expect(report.foldChars).toBeLessThanOrEqual(MAX_FOLD_CHARS)
    expect(report.foldNodes).toBe(3_000)
    expect(report.sessionEvents).toBe(11_000)
    expect(report.sessionEvents).toBeGreaterThan(report.foldNodes)
    expect(report.sessionBytes).toBeGreaterThan(report.foldChars)
    expect(report.parserPendingPeak).toBeGreaterThan(0)
  })

  it('accumulates one event log across advances instead of restarting short runs', async () => {
    const runner = await createTuiSoakRunner()
    const first = runner.advance(10)
    const second = runner.advance(10)
    expect(second.rounds).toBe(20)
    expect(second.sessionEvents).toBe(first.sessionEvents * 2)
    expect(second.sessionBytes).toBeGreaterThan(first.sessionBytes)
    expect(second.foldNodes).toBeGreaterThan(first.foldNodes)
  })
})
