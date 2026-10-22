import { describe, expect, it } from 'vitest'
import { projectFileDelta } from '../src/diff-project'
const diff = (oldText: string | null, newText: string) => projectFileDelta({ path: 'a.ts', oldText, newText })
describe('snapshot diff projection', () => {
  it('keeps unchanged code as context with accurate counts and coordinates', () => {
    const delta = diff('a\nb\nc\n', 'a\nx\nc\n')
    expect([delta.added, delta.removed]).toEqual([1, 1])
    expect(delta.hunks).toHaveLength(1)
    expect(delta.hunks[0]).toMatchObject({ oldStart: 1, newStart: 1, oldCount: 3, newCount: 3 })
    expect(delta.hunks[0]!.lines.map(line => [line.kind, line.oldLine, line.newLine]))
      .toEqual([['context', 1, 1], ['remove', 2, undefined], ['add', undefined, 2], ['context', 3, 3]])
  })
  it('has no fake record for empty or identical files', () => {
    expect(diff('', '').hunks).toEqual([])
    expect(diff('same', 'same').hunks).toEqual([])
  })
  it('handles empty known before/after images without inventing file lifecycle', () => {
    expect(diff('', 'new\n').hunks[0]).toMatchObject({ oldStart: 0, oldCount: 0, newStart: 1, newCount: 1 })
    expect(diff('old\n', '').hunks[0]).toMatchObject({ oldStart: 1, oldCount: 1, newStart: 0, newCount: 0 })
    expect(diff(null, 'new\n')).toMatchObject({ incomplete: 'before-image', added: 0, removed: 0, hunks: [] })
  })
  it('separates distant hunks', () => {
    const before = Array.from({ length: 30 }, (_, i) => `line ${i}`)
    const after = [...before]; after[2] = 'first'; after[26] = 'last'
    const result = diff(before.join('\n'), after.join('\n'))
    expect(result.hunks).toHaveLength(2)
    expect(result.hunks[1]).toMatchObject({ oldStart: 24, newStart: 24 })
    expect([result.added, result.removed]).toEqual([2, 2])
  })
  it('preserves Unicode, tabs, CRLF and missing-final-newline metadata', () => {
    const result = diff('中文\t🙂\r\nold', '中文\t🙂\r\nnew\r\n')
    expect(result.lineEndings).toBe('CRLF')
    expect(result.hunks[0]!.lines[0]!.text).toBe('中文\t🙂')
    expect(result.hunks[0]!.lines.find(line => line.kind === 'remove')!.noNewline).toBe(true)
    expect(result.hunks[0]!.lines.find(line => line.kind === 'add')!.noNewline).toBe(false)
  })
  it('treats a final newline change as a real change', () => {
    expect(diff('a', 'a\n')).toMatchObject({ added: 1, removed: 1 })
  })
  it('fails closed for binary or excessive comparison work', () => {
    expect(diff('a\0', 'b\0').incomplete).toBe('binary')
    expect(diff(null, 'b\0').incomplete).toBe('binary')
    expect(diff('x'.repeat(200_001), '').incomplete).toBe('budget')
    expect(diff('a\n'.repeat(1100), 'b\n'.repeat(1100)).incomplete).toBe('budget')
  })
})
