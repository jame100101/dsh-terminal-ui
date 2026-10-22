import { describe, expect, it } from 'vitest'
import { wordDiffSpans } from '../src/word-diff'
import { compactResultCard, projectResultCard } from '../src/card-project'

describe('word diff display projection', () => {
  it('preserves whitespace and isolates a small changed word', () => {
    const before = 'const greeting = "Hello";'
    const after = 'const greeting = "World";'
    const spans = wordDiffSpans(before, after)!
    expect(spans.before.map(span => before.slice(span.start, span.end))).toEqual(['Hello'])
    expect(spans.after.map(span => after.slice(span.start, span.end))).toEqual(['World'])
    const whitespace = wordDiffSpans('const  value = 1', 'const value = 1')!
    expect(whitespace.before.map(span => 'const  value = 1'.slice(span.start, span.end)).join('')).toBe('  ')
  })
  it('falls back for unchanged, mostly replaced and oversized lines', () => {
    expect(wordDiffSpans('same', 'same')).toBeNull()
    expect(wordDiffSpans('old', 'new')).toBeNull()
    expect(wordDiffSpans('x'.repeat(16_001), 'x')).toBeNull()
  })
  it('expands changed emoji modifiers to whole graphemes and retains Chinese', () => {
    const before = 'unchanged greeting: 👩🏻‍💻 你好 unchanged'
    const after = 'unchanged greeting: 👩🏽‍💻 您好 unchanged'
    const spans = wordDiffSpans(before, after)!
    expect(spans.before.map(span => before.slice(span.start, span.end)).join('')).toContain('👩🏻‍💻')
    expect(spans.after.map(span => after.slice(span.start, span.end)).join('')).toContain('👩🏽‍💻')
    const boundaries = new Set([...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(after)].flatMap(({ index, segment }) => [index, index + segment.length]))
    expect(spans.after.every(span => boundaries.has(span.start) && boundaries.has(span.end))).toBe(true)
  })
  it('preserves highlights in compact cards without coloring the line-number gutter', () => {
    const compact = compactResultCard({ card: 'diff', diffs: [{ path: 'a.ts', oldText: 'const greeting = "Hello";\n', newText: 'const greeting = "World";\n' }] })
    const rows = projectResultCard(compact as never, '', 'en')
    const changed = rows.filter(row => row.changes?.length)
    expect(changed).toHaveLength(2)
    expect(changed.map(row => row.changes!.map(span => row.text.slice(span.start, span.end)).join(''))).toEqual(['Hello', 'World'])
    expect(changed.every(row => row.changes!.every(span => span.start > row.text.indexOf('│')))).toBe(true)
    expect(compactResultCard(compact)).toEqual(compact)
  })
  it('does not pair replacements across a context line or separate files', () => {
    const rows = projectResultCard({ card: 'diff', diffs: [
      { path: 'a', oldText: 'const greeting = "Hello";\ncontext\n', newText: 'context\nconst greeting = "World";\n' },
      { path: 'b', oldText: '', newText: 'const greeting = "World";\n' },
    ] } as never, '', 'en')
    expect(rows.every(row => !row.changes?.length)).toBe(true)
  })
})
