import { describe, expect, it, vi } from 'vitest'
import { selectPanelSnapshot } from '../src/publish-snapshot'
import { createTuiStore } from '../src/store'
import type { TuiSnapshot } from '../src/store'

function snapshot(overrides: Partial<TuiSnapshot> = {}): TuiSnapshot {
  return createTuiStore({
    version: 1,
    nodes: [],
    trace: [],
    todos: [],
    stats: { turns: 0, steps: 0, llmMs: 0, toolMs: 0, ttftMs: 0, stepsWithTtft: 0, decodeMs: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }, contextWindow: 0 },
    live: null,
    busy: false,
    provider: 'p',
    model: 'm',
    sessionId: 's',
    cwd: '.',
    pendingApproval: null,
    pendingQuestion: null,
    commands: [],
    models: [],
    sessions: [],
    queued: [],
    settings: null,
    jobs: [],
    subagents: [],
    workflows: [],
    feedback: new Map(),
    plan: { active: false, pending: false },
    goal: null,
    reasoning: { effort: undefined, levels: [] },
    attachmentCount: 0,
    pendingImages: [],
    compaction: false,
    sandbox: 'read-only',
    occupancy: null,
    ...overrides,
  }).getSnapshot()
}

describe('selectPanelSnapshot', () => {
  it('skips compute and keeps panel field identity when reusePanels is true', () => {
    const previous = snapshot({
      sessions: [{ id: 'a', model: 'm', status: 'running' }],
      queued: [{ text: 'hello', steer: false }],
      jobs: [{ id: 'j', kind: 'k', label: 'l', status: 'running', elapsedMs: 1 }],
    })
    const compute = vi.fn(() => {
      throw new Error('must not recompute panel fields on a stream publish')
    })
    const next = selectPanelSnapshot(previous, true, compute)
    expect(compute).not.toHaveBeenCalled()
    expect(next.sessions).toBe(previous.sessions)
    expect(next.queued).toBe(previous.queued)
    expect(next.jobs).toBe(previous.jobs)
    expect(next.settings).toBe(previous.settings)
    expect(next.occupancy).toBe(previous.occupancy)
  })

  it('uses the computed panel fields when reusePanels is false', () => {
    const previous = snapshot()
    const computed = {
      commands: previous.commands,
      models: previous.models,
      sessions: [{ id: 'b', model: 'n', status: 'idle' }] as const,
      queued: previous.queued,
      settings: previous.settings,
      jobs: previous.jobs,
      subagents: previous.subagents,
      workflows: previous.workflows,
      feedback: previous.feedback,
      reasoning: previous.reasoning,
      attachmentCount: 2,
      pendingImages: [],
      sandbox: 'workspace-write' as const,
      occupancy: { projectedTokens: 1, contextWindow: 2 },
    }
    const next = selectPanelSnapshot(previous, false, () => computed)
    expect(next.sessions).toBe(computed.sessions)
    expect(next.attachmentCount).toBe(2)
    expect(next.sandbox).toBe('workspace-write')
  })
})
