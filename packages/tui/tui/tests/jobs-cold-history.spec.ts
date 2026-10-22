import { expect, it } from 'vitest'
import { JobId } from '@deepseek-ai/dsh-jobs'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { mergeHistoricalJobs } from '../src/jobs-projection'
import { buildJobDetailRows } from '../src/settings-data'
const owner = SessionId('owner')
const data = { jobId: JobId('bash-fixture'), owner, kind: 'bash', label: 'original operation', startedAt: 100 }
const registered = { type: 'job/registered', data, seq: 1, time: 100 } as SessionEvent
it('marks a persisted registration without a live registry as interrupted, non-stoppable and unknown outcome', () => {
  const rows = mergeHistoricalJobs([], [registered], owner)
  expect(rows).toMatchObject([{ id: 'bash-fixture', status: 'interrupted' }])
  expect(buildJobDetailRows(rows[0], 'en').some(row => row.action === 'kill-job' || row.action === 'request-job-stop')).toBe(false)
})
it('uses actual terminal evidence and lets live registry override history without duplicate rows', () => {
  const settled = { type: 'job/settled', data: { ...data, status: 'killed', cause: 'teardown', producerReported: true, finishedAt: 150 }, seq: 2, time: 150 } as SessionEvent
  expect(mergeHistoricalJobs([], [registered, settled], owner)).toMatchObject([{ status: 'killed', elapsedMs: 50 }])
  const live = { id: 'bash-fixture', kind: 'bash', label: 'live', status: 'running', elapsedMs: 25 }
  expect(mergeHistoricalJobs([live], [registered], owner)).toEqual([live])
})
it('does not transfer original job ownership into forked session history', () => {
  expect(mergeHistoricalJobs([], [registered], SessionId('fork'))).toEqual([])
})
