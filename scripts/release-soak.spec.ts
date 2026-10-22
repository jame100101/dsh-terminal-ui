import { expect, it } from 'vitest'
import { summarizeReleaseSoak } from '../evaluation/tui/release-soak.mjs'
function report() {
  return {
    exitCode: 0, error: null, requestedMs: 3600000, elapsedMs: 3600100,
    nodeEnv: 'production', withTools: true, toolPayloadBytes: 32768,
    samples: Array.from({ length: 721 }, (_, i) => ({ elapsedMs: i * 5000, rssBytes: 500 * 1024 * 1024 })),
    memory: [{ agents: 1, sessions: 1 }, { agents: 2, sessions: 2 }],
  }
}
it('requires a completed large-output workload with a late RSS plateau', () => {
  expect(summarizeReleaseSoak(report()).status).toBe('PASS')
  const growing = report()
  growing.samples.forEach((p, i) => { p.rssBytes += i / 12 * 1024 * 1024 })
  expect(summarizeReleaseSoak(growing).status).toBe('FAIL')
})
it('does not accept small, diagnostic or incomplete runs as release evidence', () => {
  for (const override of [
    { withTools: false }, { toolPayloadBytes: 0 }, { toolPayloadBytes: NaN },
    { elapsedMs: 1800000 }, { elapsedMs: NaN }, { nodeEnv: 'development' }, { requestedMs: 600000 },
    { memory: [] }, { memory: [{ agents: NaN, sessions: 1 }] },
    { forcedGcDiagnostic: true }, { heapSnapshotDiagnostic: true }, { exitCode: 1 },
  ]) expect(summarizeReleaseSoak({ ...report(), ...override }).status).toBe('UNTESTED')
})
it('fails leaked host ownership even when RSS is flat', () => {
  for (const memory of [[{ agents: 3, sessions: 1 }], [{ agents: 1, sessions: 3 }]]) {
    expect(summarizeReleaseSoak({ ...report(), memory }).status).toBe('FAIL')
  }
})
