import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JobSnapshot } from '@deepseek-ai/dsh-jobs'
import { jobsChangeVisibleTo, projectJobsRows } from '../src/jobs-projection'

function agent(id: string): Agent {
  return { id } as unknown as Agent
}

function snapshot(id: string, ownerSession?: string): JobSnapshot {
  return {
    id: id as JobSnapshot['id'],
    kind: 'bash',
    label: id,
    ...(ownerSession === undefined ? {} : { ownerSession: ownerSession as JobSnapshot['ownerSession'] }),
    status: 'running',
    startedAt: 100,
    reported: false,
  }
}

describe('owner-scoped jobs projection', () => {
  it('passes the exact current Agent to JobRegistry.list and projects visible rows', () => {
    const current = agent('agent-a')
    let caller: Agent | undefined
    const jobs = {
      list: (received?: Agent): JobSnapshot[] => {
        caller = received
        return [snapshot('job-a', 'session-a'), snapshot('job-u')]
      },
    }
    expect(projectJobsRows(jobs, current, 350)).toEqual([
      { id: 'job-a', kind: 'bash', label: 'job-a', status: 'running', elapsedMs: 250 },
      { id: 'job-u', kind: 'bash', label: 'job-u', status: 'running', elapsedMs: 250 },
    ])
    expect(caller).toBe(current)
  })

  it('keeps a terminal elapsed value anchored at finishedAt', () => {
    const current = agent('agent-a')
    const jobs = {
      list: (): JobSnapshot[] => [{ ...snapshot('job-a'), status: 'completed', finishedAt: 225 }],
    }
    expect(projectJobsRows(jobs, current, 999)[0]?.elapsedMs).toBe(125)
  })

  it('refreshes only for the current exact owner or unowned work', () => {
    const current = agent('agent-a')
    const foreign = agent('agent-b')
    expect(jobsChangeVisibleTo(current, current)).toBe(true)
    expect(jobsChangeVisibleTo(undefined, current)).toBe(true)
    expect(jobsChangeVisibleTo(foreign, current)).toBe(false)
  })
})
