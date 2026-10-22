import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import { mountAnswerers, settleApproval, settleQuestion } from '../src/harness/answerers'
import type { AnswererSurface } from '../src/harness/answerers'
import { createTuiStore } from '../src/store'
import type { TuiSnapshot } from '../src/store'

describe('mounted approval adapter request lifecycle', () => {
  it('ignores late abort and stale decisions while the next real handler request waits', async () => {
    let request: (req: ApprovalRequest, next: () => Promise<'rejected'>) => Promise<unknown> = async () => undefined
    // Only the event registration seam is mocked; execute the production handler and store writes.
    const ctx = { get: (key: string) => key === 'approval' ? {} : undefined,
      on: (_name: string, handler: typeof request) => { request = handler } } as unknown as Context
    const agent = { id: 'session-a' } as Agent
    const surface: AnswererSurface = { agent, version: 0, pendingApproval: null, pendingQuestion: null, approvalResolve: null, questionResolve: null }
    const store = createTuiStore({ pendingApproval: null, version: 0 } as TuiSnapshot)
    mountAnswerers(ctx, store, surface)
    const next = vi.fn(async () => 'rejected' as const)
    const a = new AbortController()
    const first = request({ agent, toolName: 'write', signal: a.signal }, next)
    const firstId = surface.pendingApproval?.requestId
    expect(settleApproval(store, surface, firstId, 'allowed-once')).toBe(true)
    await expect(first).resolves.toBe('allowed-once')
    const second = request({ agent, toolName: 'write' }, next)
    const secondId = surface.pendingApproval?.requestId
    expect(secondId).not.toBe(firstId)
    a.abort()
    expect(surface.pendingApproval?.requestId).toBe(secondId)
    expect(settleApproval(store, surface, firstId, 'allowed-once')).toBe(false)
    expect(settleApproval(store, surface, secondId, 'rejected')).toBe(true)
    expect(settleApproval(store, surface, secondId, 'allowed-once')).toBe(false)
    await expect(second).resolves.toBe('rejected')
    expect(next).not.toHaveBeenCalled()
  })
})


describe('mounted question adapter cancellation', () => {
  it('settles an aborted host wait and removes listeners after a valid answer', async () => {
    type Request = import('@deepseek-ai/dsh-user-questions').AskUserQuestionRequest
    let request: (req: Request, next: () => Promise<unknown>) => Promise<unknown> = async () => undefined
    const ctx = { get: (key: string) => key === 'userQuestions' ? {} : undefined,
      on: (_name: string, handler: typeof request) => { request = handler } } as unknown as Context
    const agent = { id: 'session-a' } as Agent
    const surface: AnswererSurface = { agent, version: 0, pendingApproval: null, pendingQuestion: null, approvalResolve: null, questionResolve: null }
    const store = createTuiStore({ pendingQuestion: null, version: 0 } as TuiSnapshot)
    mountAnswerers(ctx, store, surface)
    const next = vi.fn(async () => undefined)
    const aborted = new AbortController()
    const waiting = request({ agent, questions: [{ id: 'q', question: 'Continue?' }], signal: aborted.signal }, next)
    const rejected = expect(waiting).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    const oldId = surface.pendingQuestion?.requestId
    aborted.abort()
    await rejected
    expect(surface.pendingQuestion).toBeNull()
    expect(settleQuestion(store, surface, oldId, [])).toBe(false)
    const answered = new AbortController()
    const remove = vi.spyOn(answered.signal, 'removeEventListener')
    const second = request({ agent, questions: [{ id: 'q', question: 'Continue?' }], signal: answered.signal }, next)
    const answer = [{ id: 'q', selected: ['yes'] }]
    expect(settleQuestion(store, surface, surface.pendingQuestion?.requestId, answer)).toBe(true)
    await expect(second).resolves.toEqual({ answers: answer })
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(next).not.toHaveBeenCalled()
  })
})

it('holds a resident approval on its own surface and never updates or approves the foreground', async () => {
  let request: (req: ApprovalRequest, next: () => Promise<'rejected'>) => Promise<unknown> = async () => undefined
  const ctx = { get: (key: string) => key === 'approval' ? {} : undefined,
    on: (_name: string, handler: typeof request) => { request = handler } } as unknown as Context
  const surface = (id: string): AnswererSurface => ({ agent: { id } as Agent, version: 0, pendingApproval: null, pendingQuestion: null, approvalResolve: null, questionResolve: null })
  const foreground = surface('foreground'), resident = surface('resident')
  const store = createTuiStore({ pendingApproval: null, version: 0 } as TuiSnapshot)
  const residentStore = createTuiStore({ pendingApproval: null, version: 0 } as TuiSnapshot)
  mountAnswerers(ctx, store, foreground, agent => agent === resident.agent ? { surface: resident, store: residentStore } : undefined)
  const next = vi.fn(async () => 'rejected' as const)
  const result = request({ agent: resident.agent, toolName: 'write' }, next)
  const id = resident.pendingApproval?.requestId
  expect(id).toBeTruthy()
  expect(store.getSnapshot().pendingApproval).toBeNull()
  expect(settleApproval(store, foreground, id, 'allowed-once')).toBe(false)
  expect(settleApproval(residentStore, resident, id, 'allowed-once')).toBe(true)
  await expect(result).resolves.toBe('allowed-once')
  expect(next).not.toHaveBeenCalled()
})
