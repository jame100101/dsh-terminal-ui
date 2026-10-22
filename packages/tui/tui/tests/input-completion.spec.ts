import { describe, expect, it } from 'vitest'
import { completeMention, mentionAtCaret, slashAtCaret, pathMention, sameCompletionIdentity } from '../src/input/completion'
import { searchInputHistory } from '../src/input/history-search'

describe('caret-scoped mention completion', () => {
  it('replaces a middle token and preserves all suffix text', () => {
    const text = 'read @src/old.ts then explain'
    const range = mentionAtCaret(text, 9)!
    expect(range).toEqual({ start: 5, end: 16, query: 'src' })
    expect(completeMention(text, range, '@src/new.ts')).toEqual({ text: 'read @src/new.ts then explain', caret: 16 })
  })
  it('lexes quoted Chinese and Windows paths without treating separators as escapes', () => {
    const text = 'read @"C:\\中文 folder\\a.ts" next'
    const caret = text.indexOf('a.ts') + 1
    expect(mentionAtCaret(text, caret)?.query).toBe('C:\\中文 folder\\a')
    expect(pathMention('中文 folder/a.ts')).toBe('@"中文 folder/a.ts"')
    expect(completeMention('read @x after', { start: 5, end: 7, query: 'x' }, '@"a b/"', true)).toEqual({ text: 'read @"a b/" after', caret: 11 })
  })
  it('ignores non-active mentions and invalidates results for every owner coordinate', () => {
    expect(mentionAtCaret('mail@example.com', 8)).toBeNull()
    expect(mentionAtCaret('/model @x', 9)).toBeNull()
    const identity = { sessionId: 's1', cwd: '/a', revision: 1, caret: 2 }
    expect(sameCompletionIdentity(identity, { ...identity })).toBe(true)
    for (const change of [{ sessionId: 's2' }, { cwd: '/b' }, { revision: 2 }, { caret: 3 }]) {
      expect(sameCompletionIdentity(identity, { ...identity, ...change })).toBe(false)
    }
  })
})

it('searches history newest first without mutating stored entries', () => {
  const history = ['Chinese 中文', 'other', '中文 latest']
  expect(searchInputHistory(history, '中文')).toEqual(['中文 latest', 'Chinese 中文'])
  expect(history).toEqual(['Chinese 中文', 'other', '中文 latest'])
})

it('completes slash tokens in the middle without consuming arguments or prose', () => {
  const text = 'please /modxx then continue'
  const range = slashAtCaret(text, 11)!
  expect(range).toEqual({ start: 7, end: 13, query: 'mod' })
  expect(completeMention(text, range, '/model')).toEqual({ text: 'please /model then continue', caret: 13 })
  expect(slashAtCaret('/modxx argument', 4)).toEqual({ start: 0, end: 6, query: 'mod' })
  expect(slashAtCaret('https://example.org', 8)).toBeNull()
})
