import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JobView } from '@deepseek-ai/dsh-jobs'
import { jobsChangeVisibleTo, projectJobsRows } from '../src/jobs-projection'

function agent(id: string): Agent {
  return { id } as unknown as Agent
}

function snapshot(id: string, owner?: string): JobView {
  return {
    id: id as JobView['id'],
    kind: 'bash',
    label: id,
    ...(owner === undefined ? {} : { owner: owner as JobView['owner'] }),
    status: 'running',
    startedAt: 100,
    output: { total: 0, earliest: 0 },
  }
}

describe('owner-scoped jobs projection', () => {
  it('passes the current Session ID to JobRegistry.list and projects visible rows', () => {
    const current = agent('agent-a')
    let caller: Agent['id'] | undefined
    const jobs = {
      list: (received?: Agent['id']): JobView[] => {
        caller = received
        return [snapshot('job-a', 'session-a'), snapshot('job-u')]
      },
    }
    expect(projectJobsRows(jobs, current, 350)).toEqual([
      { id: 'job-a', kind: 'bash', label: 'job-a', status: 'running', elapsedMs: 250 },
      { id: 'job-u', kind: 'bash', label: 'job-u', status: 'running', elapsedMs: 250 },
    ])
    expect(caller).toBe(current.id)
  })

  it('keeps a terminal elapsed value anchored at finishedAt', () => {
    const current = agent('agent-a')
    const jobs = {
      list: (): JobView[] => [{ ...snapshot('job-a'), status: 'completed', finishedAt: 225 }],
    }
    expect(projectJobsRows(jobs, current, 999)[0]?.elapsedMs).toBe(125)
  })

  it('refreshes only for the current exact owner or unowned work', () => {
    const current = agent('agent-a')
    const foreign = agent('agent-b')
    expect(jobsChangeVisibleTo(current.id, current)).toBe(true)
    expect(jobsChangeVisibleTo(undefined, current)).toBe(true)
    expect(jobsChangeVisibleTo(foreign.id, current)).toBe(false)
  })
})
