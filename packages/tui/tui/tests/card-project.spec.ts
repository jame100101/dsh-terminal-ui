import { describe, expect, it } from 'vitest'
import { compactCallCard, compactResultCard, projectResultCard } from '../src/card-project'

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
