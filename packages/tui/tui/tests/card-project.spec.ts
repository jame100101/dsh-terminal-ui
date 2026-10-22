import { describe, expect, it } from 'vitest'
import { compactCallCard, compactResultCard, projectCallCard, projectResultCard } from '../src/card-project'

describe('projectResultCard locale', () => {
  it('renders search, read, and web chrome entirely in English', () => {
    const search = projectResultCard({
      card: 'search',
      shape: 'paths',
      paths: ['src/index.ts'],
      total: 5,
      truncated: true,
    } as never, '', 'en')
    const read = projectResultCard({
      card: 'read',
      path: 'src/index.ts',
      offset: 1,
      totalLines: 20,
      lines: [{ number: 1, text: 'export {}' }],
    } as never, '', 'en')
    const web = projectResultCard({
      card: 'web',
      kind: 'fetch',
      url: 'https://example.test',
      statusCode: 200,
      truncated: true,
    } as never, '', 'en')
    const text = [...search, ...read, ...web].map(line => line.text).join('\n')
    expect(text).toContain('truncated (showing 1/5)')
    expect(text).toContain('of 20 lines')
    expect(text).toContain('content truncated')
    expect(text).not.toMatch(/\p{Script=Han}/u)
  })

  it('retains Chinese card labels in the Chinese locale', () => {
    const rows = projectResultCard({
      card: 'search',
      shape: 'paths',
      paths: [],
      total: 3,
      truncated: false,
    } as never, '', 'zh')
    expect(rows.at(-1)?.text).toBe('共 3 项')
  })

  it('compacts giant terminal output and drops duplicate read content', () => {
    const huge = 'x'.repeat(20_000)
    const terminal = compactResultCard({ card: 'terminal', output: huge, exitCode: 0 }) as { output: string }
    expect(terminal.output.length).toBeLessThanOrEqual(4001)
    expect(terminal.output.endsWith('…')).toBe(true)
    const read = compactResultCard({
      card: 'read',
      path: 'a.ts',
      offset: 1,
      totalLines: 3,
      lines: [
        { number: 1, text: 'a' },
        { number: 2, text: 'b' },
      ],
      content: [{ type: 'text', text: huge }],
    }) as { lines: unknown[]; content?: unknown }
    expect(read.content).toBeUndefined()
    expect(read.lines).toHaveLength(2)
    const call = compactCallCard({
      card: 'diff',
      title: 'Write a.ts',
      diffs: [{ path: 'a.ts', oldText: null, newText: huge }],
    }) as { diffs: { newText: string }[] }
    expect(call.diffs[0]?.newText.length).toBeLessThanOrEqual(4001)
  })
})


describe('bounded real diff cards', () => {
  it('retains a real change past the old payload cap after compaction', () => {
    const prefix = 'unchanged line\n'.repeat(400)
    const view = { card: 'diff', diffs: [{ path: 'deep.ts', oldText: prefix + 'before\n', newText: prefix + 'after\n' }] }
    const compact = compactResultCard(view)
    const rows = projectResultCard(compact as never, '', 'en')
    const text = rows.map(line => line.text).join('\n')
    expect(text).toContain('+1 -1')
    expect(text).toContain('before')
    expect(text).toContain('after')
    expect(text).toContain('401')
    expect(compactResultCard(compact)).toEqual(compact)
  })
  it('labels pending null-before-image snapshots without claiming a new file or additions', () => {
    const rows = projectCallCard(compactCallCard({ card: 'diff', title: 'Write',
      diffs: [{ path: 'existing.ts', oldText: null, newText: 'replacement' }] }) as never, '')
    const text = rows.map(line => line.text).join('\n')
    expect(text).toContain('Pending tool preview')
    expect(text).toContain('prior content unavailable')
    expect(text).not.toContain('(new)')
    expect(rows.some(line => line.color === 'green')).toBe(false)
  })
  it('renders multiple files and newline metadata without counting metadata as changes', () => {
    const rows = projectResultCard({ card: 'diff', diffs: [
      { path: 'a.ts', oldText: 'old', newText: 'new' },
      { path: 'b.ts', oldText: '', newText: 'hello\n' },
    ] } as never, '', 'en')
    const text = rows.map(line => line.text).join('\n')
    expect(text).toContain('── a.ts')
    expect(text).toContain('── b.ts')
    expect(text).toContain('No newline at end')
    expect(text).toContain('@@ -0,0 +1,1 @@')
    expect(rows.filter(line => line.color === 'green')).toHaveLength(2)
  })
  it('explicitly marks line and row truncation and caps output', () => {
    for (const newText of ['x'.repeat(500), 'added\n'.repeat(500)]) {
      const compact = compactResultCard({ card: 'diff', diffs: [{ path: 'large', oldText: '', newText }] })
      const rows = projectResultCard(compact as never, '', 'en')
      expect(rows.length).toBeLessThanOrEqual(200)
      expect(rows.at(-1)!.text).toContain('Preview incomplete: display limit')
      expect(rows.at(-1)!.text).toContain('original tool record')
    }
  })
})


it('aligns both diff number columns across digit boundaries', () => {
  const oldText = Array.from({ length: 12 }, (_, i) => `line ${i}`).join('\n')
  const rows = projectResultCard({ card: 'diff', diffs: [{ path: 'digits.ts', oldText, newText: oldText.replace('line 9', 'replacement') }] } as never, '')
  const gutters = rows.filter(row => row.text.includes(' │ '))
  expect(gutters.length).toBeGreaterThan(2)
  expect(new Set(gutters.map(row => row.text.indexOf('│'))).size).toBe(1)
})
