import { expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { applyEvent, createScratch, initialState } from '../src/fold'

it('settles the new embedded stream without duplicating live text and replays the same thinking', () => {
  const scratch = createScratch()
  const delta = { type: 'text-delta' as const, index: 0, text: 'hello' }
  let live = applyEvent(initialState(), { type: 'assistant/chunk', seq: -1, time: 100, data: { chunk: delta } }, scratch)
  expect(live.live?.text).toBe('hello')
  const event = { type: 'assistant/message', seq: 1, time: 200, data: { turn: 1, step: 1, message: { id: 'm', role: 'assistant', content: [{ type: 'text', text: 'hello' }] }, stream: [
    { type: 'chunk', time: 80, chunk: { type: 'reasoning-delta', index: 0, text: 'consider' } },
    { type: 'chunk', time: 100, chunk: delta },
  ] } } as unknown as SessionEvent
  live = applyEvent(live, event, scratch)
  const replay = applyEvent(initialState(), event, createScratch())
  expect(live.nodes).toEqual(replay.nodes)
  expect(live.nodes.filter(node => node.kind === 'assistant').map(node => node.text)).toEqual(['hello'])
  expect(live.nodes.some(node => node.kind === 'think' && node.text === 'consider')).toBe(true)
  expect(live.live).toBeNull()
})

it('replays an interrupted attempt and clears its transient body', () => {
  const event = { type: 'assistant/attempt', seq: 7, time: 300, data: { stream: [
    { type: 'chunk', time: 100, chunk: { type: 'reasoning-delta', index: 0, text: 'thinking' } },
    { type: 'chunk', time: 200, chunk: { type: 'text-delta', index: 0, text: 'partial' } },
  ] } } as unknown as SessionEvent
  const state = applyEvent(initialState(), event, createScratch())
  expect(state.live).toBeNull()
  expect(state.nodes.filter(node => node.kind === 'assistant')).toEqual([
    expect.objectContaining({ text: 'partial', interrupted: true }),
  ])
  expect(state.nodes.some(node => node.kind === 'think' && node.text === 'thinking')).toBe(true)
})
