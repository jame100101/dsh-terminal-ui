import { describe, expect, it } from 'vitest'
import { createUiPublishScheduler, shouldCoalesceSessionEvent, shouldPublishCoalescedFold } from '../src/ui-publish'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

function event(type: string, data: unknown): SessionEvent {
  return { type, seq: 1, time: 1, data } as SessionEvent
}

describe('shouldCoalesceSessionEvent', () => {
  it('coalesces text and reasoning deltas only', () => {
    expect(shouldCoalesceSessionEvent(event('assistant/chunk', { chunk: { type: 'text-delta', index: 0, text: 'a' } }))).toBe(true)
    expect(shouldCoalesceSessionEvent(event('assistant/chunk', { chunk: { type: 'reasoning-delta', index: 0, text: 'a' } }))).toBe(true)
    expect(shouldCoalesceSessionEvent(event('assistant/chunk', { chunk: { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } } }))).toBe(false)
    expect(shouldCoalesceSessionEvent(event('tool/call', { name: 'bash' }))).toBe(false)
    expect(shouldCoalesceSessionEvent(event('assistant/message', { message: { content: [] } }))).toBe(false)
    expect(shouldCoalesceSessionEvent(event('turn/end', { reason: { kind: 'completed' } }))).toBe(false)
  })
})

describe('shouldPublishCoalescedFold', () => {
  it('skips a publish when live and nodes stay the same object', () => {
    const live = { text: 'a', think: '', thinkSince: null }
    const nodes: unknown[] = []
    expect(shouldPublishCoalescedFold({ live, nodes }, { live, nodes })).toBe(false)
    expect(shouldPublishCoalescedFold({ live, nodes }, { live: { ...live }, nodes })).toBe(true)
    expect(shouldPublishCoalescedFold({ live, nodes }, { live, nodes: [{}] })).toBe(true)
  })
})

describe('createUiPublishScheduler', () => {
  it('treats an empty immediate request, flush, and dispose as no-ops', () => {
    let publishes = 0
    const scheduler = createUiPublishScheduler(() => { publishes += 1 }, 40, {
      schedule: callback => callback(),
      cancel: () => {},
    })
    scheduler.flush()
    scheduler.dispose()
    scheduler.request(true)
    expect(publishes).toBe(1)
  })

  it('collapses coalesced requests into one delayed publish', () => {
    let publishes = 0
    const pending: { callback: () => void }[] = []
    const scheduler = createUiPublishScheduler(() => { publishes += 1 }, 40, {
      schedule: (callback) => {
        pending.push({ callback })
        return pending.length
      },
      cancel: () => { pending.pop() },
    })
    scheduler.request(false)
    scheduler.request(false)
    scheduler.request(false)
    expect(publishes).toBe(0)
    expect(pending).toHaveLength(1)
    pending[0]?.callback()
    expect(publishes).toBe(1)
  })

  it('flush publishes a pending coalesced request and dispose drops it', () => {
    let publishes = 0
    const pending: { callback: () => void }[] = []
    const scheduler = createUiPublishScheduler(() => { publishes += 1 }, 40, {
      schedule: (callback) => {
        pending.push({ callback })
        return pending.length
      },
      cancel: () => { pending.pop() },
    })
    scheduler.request(false)
    scheduler.flush()
    expect(publishes).toBe(1)
    scheduler.request(false)
    scheduler.dispose()
    expect(pending).toHaveLength(0)
  })

  it('flushes immediately on an interactive event', () => {
    let publishes = 0
    const pending: { callback: () => void }[] = []
    const scheduler = createUiPublishScheduler(() => { publishes += 1 }, 40, {
      schedule: (callback) => {
        pending.push({ callback })
        return pending.length
      },
      cancel: () => { pending.pop() },
    })
    scheduler.request(false)
    scheduler.request(true)
    expect(publishes).toBe(1)
    expect(pending).toHaveLength(0)
  })
})
