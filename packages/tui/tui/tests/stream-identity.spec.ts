import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { applyEvent, createScratch, initialState } from '../src/fold'
const event = (type: string, data: unknown, seq: number): SessionEvent => ({ type, data, seq, time: seq }) as SessionEvent

describe('streaming to settled projection identity', () => {
  it.each(['assistant/message', 'assistant/attempt'])('preserves assistant and thinking render identity across %s', type => {
    const scratch = createScratch()
    let fold = applyEvent(initialState(), event('step/start', { turn: 1, step: 1 }, 1), scratch)
    fold = applyEvent(fold, event('assistant/chunk', { chunk: { type: 'reasoning-delta', index: 0, text: 'thinking' } }, 3), scratch)
    fold = applyEvent(fold, event('assistant/chunk', { chunk: { type: 'text-delta', index: 1, text: 'answer' } }, 4), scratch)
    const renderId = fold.live?.renderId
    expect(renderId).toBe(1)
    fold = applyEvent(fold, event(type, { message: { id: 'assistant-id', role: 'assistant', content: [{ type: 'text', text: 'answer' }] } }, 6), scratch)
    expect(fold.live).toBeNull()
    expect(fold.nodes.filter(node => node.kind === 'assistant' || node.kind === 'think').map(node => [node.id, node.renderId])).toEqual([[6, 1], [6, 1]])
  })
  it('starts a distinct identity when retry streaming follows a settled failed attempt', () => {
    const scratch = createScratch()
    let fold = applyEvent(initialState(), event('assistant/chunk', { chunk: { type: 'text-delta', index: 0, text: 'partial' } }, 3), scratch)
    fold = applyEvent(fold, event('assistant/attempt', {}, 4), scratch)
    fold = applyEvent(fold, event('assistant/chunk', { chunk: { type: 'text-delta', index: 0, text: 'retry' } }, 7), scratch)
    expect(fold.live?.renderId).toBe(7)
    expect(fold.nodes[0]).toMatchObject({ id: 4, renderId: 3, interrupted: true })
  })
})

it('retains a durable attempt boundary when the host stream-start clears the live buffer', () => {
  const scratch = createScratch()
  const start = event('step/start', { turn: 1, step: 1 }, 2)
  let live = applyEvent(initialState(), start, scratch)
  live = { ...live, live: null }
  live = applyEvent(live, event('assistant/chunk', { chunk: { type: 'text-delta', index: 0, text: 'text' } }, -1), scratch)
  expect(live.live?.renderId).toBe(2)
  const settlement = event('assistant/message', { message: { id: 'm', role: 'assistant', content: [{ type: 'text', text: 'text' }] }, stream: [{ type: 'chunk', time: 10, chunk: { type: 'text-delta', index: 0, text: 'text' } }] }, 4)
  live = applyEvent(live, settlement, scratch)
  const replayScratch = createScratch()
  let replay = applyEvent(initialState(), start, replayScratch)
  replay = applyEvent(replay, settlement, replayScratch)
  expect(live.nodes).toEqual(replay.nodes)
})
