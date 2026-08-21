import { describe, expect, it } from 'vitest'
import {
  extractSelectedText, glyphSpanAt, orderedSelection, selectionFromGlyphs, selectionIsDrag, selectionMoved,
  selectionSpanOnLine, sliceDisplayParts, sliceDisplayRange, sliceDisplaySegment,
} from '../src/selection'
import type { TranscriptLine } from '../src/viewport'

const line = (key: string, text: string): TranscriptLine => ({ key, text })

describe('transcript drag-select', () => {
  it('slices by display columns so CJK glyphs stay whole', () => {
    expect(sliceDisplayRange('你好abc', 0, 2)).toBe('你')
    expect(sliceDisplayRange('你好abc', 2, 5)).toBe('好a')
    expect(sliceDisplayRange('hello', 1, 4)).toBe('ell')
  })

  it('partitions a row so a mid-glyph split cannot duplicate CJK', () => {
    const text = '你好abc'
    const joined = sliceDisplaySegment(text, 0, 1)
      + sliceDisplaySegment(text, 1, 5)
      + sliceDisplaySegment(text, 5, 7)
    expect(joined).toBe(text)
    expect(sliceDisplaySegment(text, 0, 1)).toBe('你')
    expect(sliceDisplaySegment(text, 1, 5)).toBe('好a')
    expect(sliceDisplayRange(text, 1, 4)).toBe('你好')
  })

  it('puts a CJK that straddles the start of a backward drag into the highlight', () => {
    const text = '你好abc'
    const parts = sliceDisplayParts(text, 1, 5)
    expect(parts.before).toBe('')
    expect(parts.mid).toBe('你好a')
    expect(parts.after).toBe('bc')
    expect(parts.before + parts.mid + parts.after).toBe(text)
    const fromStart = sliceDisplayParts(text, 0, 4)
    expect(fromStart.before).toBe('')
    expect(fromStart.mid).toBe('你好')
    expect(fromStart.after).toBe('abc')
  })

  it('extracts a drag range and drops chrome only from line starts', () => {
    const lines = [
      line('1-0', '▸ first prompt   '),
      line('2-0', '● const value = 123'),
      line('2-1', 'console.log(value)'),
    ]
    expect(extractSelectedText(lines, {
      anchor: { lineIndex: 0, column: 0 },
      head: { lineIndex: 0, column: 20 },
    })).toBe('first prompt')
    expect(extractSelectedText(lines, {
      anchor: { lineIndex: 1, column: 0 },
      head: { lineIndex: 2, column: 18 },
    })).toBe('const value = 123\nconsole.log(value)')
    expect(extractSelectedText(lines, {
      anchor: { lineIndex: 1, column: 2 },
      head: { lineIndex: 1, column: 13 },
    })).toBe('const value')
  })

  it('skips blank spacer rows so a drag through a gap copies neighboring text only', () => {
    const lines = [
      line('1-0', '▸ hello'),
      line('pad', ' '),
      line('2-0', '● reply'),
    ]
    expect(extractSelectedText(lines, {
      anchor: { lineIndex: 0, column: 0 },
      head: { lineIndex: 2, column: 7 },
    })).toBe('hello\nreply')
  })

  it('extracts a drag from a sparse absolute-index map', () => {
    const map = new Map<number, TranscriptLine>([
      [10, line('a', '▸ hello')],
      [12, line('c', '● reply')],
    ])
    expect(extractSelectedText(map, {
      anchor: { lineIndex: 10, column: 0 },
      head: { lineIndex: 12, column: 7 },
    })).toBe('hello\nreply')
  })

  it('orders a backward drag and reports an empty click as unmoved', () => {
    const backward = orderedSelection({
      anchor: { lineIndex: 3, column: 8 },
      head: { lineIndex: 1, column: 2 },
    })
    expect(backward.start).toEqual({ lineIndex: 1, column: 2 })
    expect(backward.end).toEqual({ lineIndex: 3, column: 8 })
    expect(selectionMoved({
      anchor: { lineIndex: 2, column: 4 },
      head: { lineIndex: 2, column: 4 },
    })).toBe(false)
    expect(selectionSpanOnLine({
      anchor: { lineIndex: 1, column: 2 },
      head: { lineIndex: 3, column: 5 },
    }, 2, 10)).toEqual({ start: 0, end: 10 })
  })

  it('treats a one-row one-column move as a click, not a drag', () => {
    expect(selectionIsDrag({
      anchor: { lineIndex: 2, column: 4 },
      head: { lineIndex: 2, column: 4 },
    })).toBe(false)
    expect(selectionIsDrag({
      anchor: { lineIndex: 2, column: 4 },
      head: { lineIndex: 3, column: 4 },
    })).toBe(false)
    expect(selectionIsDrag({
      anchor: { lineIndex: 2, column: 4 },
      head: { lineIndex: 2, column: 5 },
    })).toBe(true)
    expect(selectionIsDrag({
      anchor: { lineIndex: 2, column: 4 },
      head: { lineIndex: 4, column: 4 },
    })).toBe(true)
  })

  it('includes both endpoint glyphs on a backward drag', () => {
    expect(glyphSpanAt('你好abc', 1)).toEqual({ start: 0, end: 2 })
    expect(glyphSpanAt('hello', 4)).toEqual({ start: 4, end: 5 })
    expect(glyphSpanAt('hello', 20)).toEqual({ start: 5, end: 5 })
    const backward = selectionFromGlyphs(
      { lineIndex: 2, start: 10, end: 11 },
      { lineIndex: 2, start: 3, end: 4 },
    )
    expect(backward.anchor).toEqual({ lineIndex: 2, column: 3 })
    expect(backward.head).toEqual({ lineIndex: 2, column: 11 })
    const forward = selectionFromGlyphs(
      { lineIndex: 0, start: 2, end: 3 },
      { lineIndex: 1, start: 4, end: 6 },
    )
    expect(forward.anchor).toEqual({ lineIndex: 0, column: 2 })
    expect(forward.head).toEqual({ lineIndex: 1, column: 6 })
    const same = selectionFromGlyphs(
      { lineIndex: 2, start: 4, end: 5 },
      { lineIndex: 2, start: 4, end: 5 },
    )
    expect(same.anchor).toEqual({ lineIndex: 2, column: 4 })
    expect(same.head).toEqual({ lineIndex: 2, column: 4 })
    expect(selectionIsDrag(same)).toBe(false)
  })
})
