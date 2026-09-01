import { describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  applyWorkflowSessionEvent, createWorkflowProjection, foldWorkflowSessionEvents, projectWorkflowSessionDelivery,
} from '../src/workflow-projection'

function event(type: string, data: unknown, seq = 0): SessionEvent {
  return { type, data, seq, time: seq } as unknown as SessionEvent
}

describe('durable workflow projection', () => {
  it('folds a run and member lifecycle into one row', () => {
    const events = [
      event('tool-workflow/run-start', { runId: 'run-a', name: 'audit' }, 1),
      event('tool-workflow/agent-start', { runId: 'run-a', seq: 1, label: 'one', phase: 'inspect', childId: 'child-a' }, 2),
      event('tool-workflow/agent-end', { runId: 'run-a', seq: 1, outcome: 'completed' }, 3),
      event('tool-workflow/run-end', { runId: 'run-a', stopReason: 'completed' }, 4),
    ]
    expect([...foldWorkflowSessionEvents(events).values()]).toEqual([{
      id: 'run-a', name: 'audit', status: 'completed', phase: 'inspect', agentsStarted: 1,
    }])
  })

  it('ignores member/end events that cannot prove current-session ownership', () => {
    const current = createWorkflowProjection()
    const projected = applyWorkflowSessionEvent(current, event('tool-workflow/agent-start', { runId: 'foreign', seq: 1 }))
    expect(projected).toBe(current)
    expect(applyWorkflowSessionEvent(projected, event('tool-workflow/run-end', { runId: 'foreign', stopReason: 'error' }, 2))).toBe(current)
  })

  it('maps cancelled and unknown stop reasons without inventing error details', () => {
    const running = applyWorkflowSessionEvent(
      applyWorkflowSessionEvent(createWorkflowProjection(), event('tool-workflow/run-start', { runId: 'run-a', name: 'audit' })),
      event('tool-workflow/run-end', { runId: 'run-a', stopReason: 'cancelled' }),
    )
    expect(running.get('run-a')).toEqual({ id: 'run-a', name: 'audit', status: 'cancelled', agentsStarted: 0 })
    const failed = applyWorkflowSessionEvent(
      applyWorkflowSessionEvent(createWorkflowProjection(), event('tool-workflow/run-start', { runId: 'run-b', name: 'audit' })),
      event('tool-workflow/run-end', { runId: 'run-b', stopReason: 'error' }),
    )
    expect(failed.get('run-b')).toEqual({ id: 'run-b', name: 'audit', status: 'error', agentsStarted: 0 })
  })

  it('fences live durable delivery by exact current Session identity', () => {
    const currentSession = Session.create(SessionId('workflow-current'))
    const foreignSession = Session.create(SessionId('workflow-foreign'))
    const workflows = createWorkflowProjection()
    const start = event('tool-workflow/run-start', { runId: 'run-a', name: 'audit' })
    expect(projectWorkflowSessionDelivery(
      currentSession,
      foreignSession,
      workflows,
      start,
    )).toBeNull()
    const accepted = projectWorkflowSessionDelivery(
      currentSession,
      currentSession,
      workflows,
      start,
    )
    expect(accepted?.get('run-a')).toEqual({
      id: 'run-a', name: 'audit', status: 'running', agentsStarted: 0,
    })
    if (accepted === null) throw new Error('expected current run start to open a row')
    const member = projectWorkflowSessionDelivery(
      currentSession,
      currentSession,
      accepted,
      event('tool-workflow/agent-start', {
        runId: 'run-a', seq: 1, label: 'inspect', phase: 'inspect', childId: 'child-a',
      }, 1),
    )
    expect(member?.get('run-a')).toMatchObject({ agentsStarted: 1, phase: 'inspect' })
    if (member === null) throw new Error('expected current member start to update the row')
    const completed = projectWorkflowSessionDelivery(
      currentSession,
      currentSession,
      member,
      event('tool-workflow/run-end', { runId: 'run-a', stopReason: 'completed' }, 2),
    )
    expect(completed?.get('run-a')).toMatchObject({ status: 'completed', agentsStarted: 1 })
  })

  it('rejects a subagent Session stream even when its run id collides with the current projection', () => {
    const parentId = SessionId('workflow-parent')
    const childId = SessionId('workflow-child')
    const parent = Session.create(parentId)
    const child = Session.create(childId, undefined, {
      version: 0,
      id: childId,
      createdAt: 2,
      origin: 'subagent',
      parentSession: parentId,
      delegationDepth: 1,
    })
    const current = applyWorkflowSessionEvent(
      createWorkflowProjection(),
      event('tool-workflow/run-start', { runId: 'run-shared', name: 'parent-run' }),
    )
    expect(projectWorkflowSessionDelivery(
      parent,
      child,
      current,
      event('tool-workflow/run-start', { runId: 'run-shared', name: 'child-run' }),
    )).toBeNull()
    expect(current.get('run-shared')?.name).toBe('parent-run')
  })

  it('resets a new Session and reconstructs a resumed Session from durable history only', () => {
    const history = [
      event('tool-workflow/run-start', { runId: 'run-a', name: 'audit' }, 1),
      event('tool-workflow/agent-start', { runId: 'run-a', seq: 1, phase: '', label: 'one', childId: 'child' }, 2),
      event('tool-workflow/run-end', { runId: 'run-a', stopReason: 'completed' }, 3),
    ]
    const old = foldWorkflowSessionEvents(history)
    expect(old.size).toBe(1)
    expect(createWorkflowProjection().size).toBe(0)
    expect(foldWorkflowSessionEvents(history).get('run-a')).toEqual({
      id: 'run-a', name: 'audit', status: 'completed', phase: '', agentsStarted: 1,
    })
  })
})
