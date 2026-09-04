import { describe, expect, it } from 'vitest'
import { jobsChangeVisibleTo, recordedPreset } from '../src/harness'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

function event(type: string, data: unknown): SessionEvent {
  return { type, data, seq: 1, time: 1 } as unknown as SessionEvent
}

describe('Harness integration seam', () => {
  it('exposes recordedPreset as header fallback then latest agent-preset/selected', () => {
    const header = { agentPreset: 'standard' }
    expect(recordedPreset(header, [])).toBe('standard')
    expect(recordedPreset(header, [event('agent-preset/selected', { agentPreset: 'minimal' })])).toBe('minimal')
  })

  it('exposes owner-scoped jobs visibility', () => {
    const current = {} as Agent
    const foreign = {} as Agent
    expect(jobsChangeVisibleTo(undefined, current)).toBe(true)
    expect(jobsChangeVisibleTo(current, current)).toBe(true)
    expect(jobsChangeVisibleTo(foreign, current)).toBe(false)
  })
})
