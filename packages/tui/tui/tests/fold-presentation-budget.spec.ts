import { describe, expect, it } from 'vitest'
import { compactResultCard } from '../src/card-project'
import { applyEvent, foldResidentChars, initialState, MAX_FOLD_CHARS } from '../src/fold'
import type { TuiNode } from '../src/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
const tool = (id: number, resultCard: unknown): TuiNode => ({ kind: 'tool', id, callId: `call-${id}`, name: 'edit',
  detail: '', text: '', status: 'done', args: undefined, callCard: null, resultCard })
describe('retained presentation budget', () => {
  it('counts compact payloads and diff preview rows, including cyclic input safely', () => {
    const card = { card: 'diff', diffs: [{ path: 'a', oldText: 'before', newText: 'after' }],
      tuiDiffPreview: { version: 1, rows: [{ text: 'a'.repeat(10_000) }] } }
    const state = { ...initialState(), nodes: [tool(1, card)] }
    expect(foldResidentChars(state)).toBeGreaterThan(10_000)
    const cycle: Record<string, unknown> = { text: 'x'.repeat(20_000) }; cycle.self = cycle
    expect(foldResidentChars({ ...initialState(), nodes: [tool(2, cycle)] })).toBeLessThan(20_100)
  })
  it('evicts old tool previews when their actual retained characters exceed the fold budget', () => {
    const resultCard = compactResultCard({ card: 'diff', diffs: [{ path: 'large', oldText: '',
      newText: Array.from({ length: 250 }, (_, i) => `${i} ${'x'.repeat(290)}`).join('\n') }] })
    const state = { ...initialState(), nodes: Array.from({ length: 40 }, (_, i) => tool(i, resultCard)) }
    expect(foldResidentChars(state)).toBeGreaterThan(MAX_FOLD_CHARS)
    const next = applyEvent(state, { type: 'user/message', seq: 100, time: 100,
      data: { id: 'u', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'next' }] } } as SessionEvent)
    expect(foldResidentChars(next)).toBeLessThanOrEqual(MAX_FOLD_CHARS)
    expect(next.nodes.length).toBeLessThan(state.nodes.length)
    expect(next.nodes.at(-1)).toMatchObject({ kind: 'user', text: 'next' })
  })
})
