import { describe, expect, it } from 'vitest'
import { extractCopyText, resolveCopyTarget } from '../src/copy-text'
import type { TuiNode } from '../src/types'

const user = (id: number, text: string): TuiNode => ({ kind: 'user', id, text })
const assistant = (id: number, text: string): TuiNode => ({
  kind: 'assistant', id, text, messageId: `m${id}`,
})
const tool = (id: number, text: string): TuiNode => ({
  kind: 'tool', id, callId: `c${id}`, name: 'bash', detail: 'bash ls', status: 'done', text, args: undefined, callCard: null, resultCard: null,
})

describe('semantic copy text', () => {
  it('copies user and assistant node.text including multiline, CJK, emoji, and markdown source', () => {
    const md = '可以这样写：\n\n```ts\nconst value = 123\nconsole.log(value)\n```'
    expect(extractCopyText(user(1, 'fix the tests'))).toBe('fix the tests')
    expect(extractCopyText(assistant(2, md))).toBe(md)
    expect(extractCopyText(assistant(3, '你好 🎉'))).toBe('你好 🎉')
    expect(extractCopyText({ kind: 'think', id: 4, text: 'first inspect', durationMs: 20 })).toBe('first inspect')
    expect(extractCopyText(tool(5, 'line one'))).toBe('line one')
  })

  it('excludes UI glyphs and empty or chrome-only rows', () => {
    expect(extractCopyText(user(1, ''))).toBeNull()
    expect(extractCopyText(tool(2, ''))).toBeNull()
    expect(extractCopyText({ kind: 'status', id: 3, text: '└ turn 1 · LLM 1ms', error: false })).toBeNull()
    expect(extractCopyText({
      kind: 'retry', id: 4, retryId: 'r1', turn: 1, step: 1, provider: 'p', policyKey: 'k',
      retry: 1, maxRetries: 3, delayMs: 0, retryAt: 0, started: false, failure: { code: 'x' },
    })).toBeNull()
  })

  it('strips ANSI if it is present in the node body', () => {
    expect(extractCopyText(assistant(1, '\x1b[32mgreen\x1b[0m'))).toBe('green')
  })

  it('resolves /copy to the Nth-latest assistant reply', () => {
    const nodes: TuiNode[] = [
      user(1, 'first prompt'),
      assistant(2, 'first reply'),
      { kind: 'status', id: 3, text: '└ turn 1', error: false },
      assistant(4, 'second reply'),
      tool(5, 'tool body'),
    ]
    expect(extractCopyText((resolveCopyTarget(nodes, '') as { target: { node: TuiNode } }).target.node)).toBe('second reply')
    expect(extractCopyText((resolveCopyTarget(nodes, 'last') as { target: { node: TuiNode } }).target.node)).toBe('second reply')
    expect(extractCopyText((resolveCopyTarget(nodes, '1') as { target: { node: TuiNode } }).target.node)).toBe('second reply')
    expect(extractCopyText((resolveCopyTarget(nodes, '2') as { target: { node: TuiNode } }).target.node)).toBe('first reply')
    expect(resolveCopyTarget(nodes, '9')).toEqual({ ok: false, error: 'range' })
    expect(resolveCopyTarget(nodes, '0')).toEqual({ ok: false, error: 'usage' })
    expect(resolveCopyTarget(nodes, 'foo')).toEqual({ ok: false, error: 'usage' })
    expect(resolveCopyTarget([user(1, 'only prompt')], '')).toEqual({ ok: false, error: 'empty' })
  })
})
