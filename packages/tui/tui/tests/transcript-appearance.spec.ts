import { describe, it, expect } from 'vitest'
import stringWidth from 'string-width'
import { cachedNodeLines, cachedNodeLineCount, createNodeLineCache } from '../src/render'
import { compactResultCard, projectResultCard } from '../src/card-project'
import type { TuiNode } from '../src/types'

describe('compact transcript projections', () => {
  it('separates theme cache variants and preserves host thinking duration', () => {
    const cache = createNodeLineCache()
    const node: TuiNode = { kind: 'think', id: 1, text: '中文 reasoning', durationMs: 3456 }
    expect(cachedNodeLines(cache, node, 40, false, undefined, 'en')[0]?.text).toBe('✓ Thinking 3.5s ▶')
    expect(cachedNodeLines(cache, node, 40, false, undefined, 'en', true)[0]?.text).toBe('Thought for 3.5s ▶')
    expect(cachedNodeLineCount(cache, node, 40, true, undefined, 'en', true)).toBe(2)
  })
  it.each(['running', 'done', 'error'] as const)('preserves %s tool status and indents every wrapped output row', status => {
    const node: TuiNode = { kind: 'tool', id: 2, callId: 'test', name: 'read', detail: 'Read(file.ts)', status, text: '中文🙂 '.repeat(20), args: {}, callCard: null, resultCard: null }
    const lines = cachedNodeLines(createNodeLineCache(), node, 30, true, undefined, 'en', true)
    expect(lines[0]?.text).toContain(status === 'error' ? '× Read' : '● Read')
    if (status === 'error') expect(lines[0]?.color).toBe('red')
    if (status === 'running') expect(lines[0]?.text).toContain('…')
    if (status === 'done') {
      expect(lines[1]?.text).toMatch(/^  ⎿ /u)
      expect(lines.slice(2).every(line => line.text.startsWith('    '))).toBe(true)
    }
    expect(lines.every(line => stringWidth(line.text) <= 30)).toBe(true)
    expect(node.status).toBe(status)
  })
  it('retains semantic diff shading, file and hunk coordinates through compaction', () => {
    const view = compactResultCard({ card: 'diff', diffs: [{ path: '真实.ts', oldText: 'same\nbefore\n', newText: 'same\nafter\n' }] })
    const rows = projectResultCard(view as never, '', 'en')
    expect(rows.find(line => line.diffKind === 'remove')?.text).toBe('- 2 · │ before')
    expect(rows.find(line => line.diffKind === 'add')?.text).toBe('+ · 2 │ after')
    expect(rows.some(line => line.text.includes('真实.ts'))).toBe(true)
    expect(rows.some(line => line.text.startsWith('@@ -1,2 +1,2 @@'))).toBe(true)
    expect(rows.filter(line => line.diffKind !== undefined)).toHaveLength(2)
  })
})

it('retains a completed tool title without retaining its pending card', () => {
  const node: TuiNode = { kind: 'tool', id: 3, callId: 'done', name: 'edit', detail: 'edit {}', displayTitle: 'Update(greeting.ts)', status: 'done', text: '', args: undefined, callCard: null, resultCard: null }
  expect(cachedNodeLines(createNodeLineCache(), node, 60, false, undefined, 'en', true)[0]?.text).toBe('● Update(greeting.ts) ▶')
  expect(cachedNodeLines(createNodeLineCache(), node, 60, false, undefined, 'en')[0]?.text).toContain('edit {}')
})

it.each([28, 80])('keeps every assistant block inside the two-cell gutter at width %i', width => {
  const node: TuiNode = { kind: 'assistant', id: 7, messageId: 'm', text: 'Intro ' + '中文🙂'.repeat(12) + '\n\n## Heading\n\n| A | B |\n| --- | --- |\n| x | **yes** |\n\n3. *item*' }
  const lines = cachedNodeLines(createNodeLineCache(), node, width, false, undefined, 'en', true)
  expect(lines[0]?.text.startsWith('● ')).toBe(true)
  expect(lines.slice(1).filter(line => line.text !== '').every(line => line.text.startsWith('  '))).toBe(true)
  expect(lines.every(line => stringWidth(line.text) <= width)).toBe(true)
  expect(lines.find(line => line.text.includes('Heading'))?.runs?.some(run => run.bold)).toBe(true)
  expect(lines.some(line => line.text.includes('3. item'))).toBe(true)
})
