import { describe, expect, it } from 'vitest'
import {
  extractSelectedText, orderedSelection, selectionMoved, selectionSpanOnLine, sliceDisplayRange,
} from '../src/selection'
import type { TranscriptLine } from '../src/viewport'

const line = (key: string, text: string): TranscriptLine => ({ key, text })

describe('transcript drag-select', () => {
  it('slices by display columns so CJK glyphs stay whole', () => {
    expect(sliceDisplayRange('你好abc', 0, 2)).toBe('你')
    expect(sliceDisplayRange('你好abc', 2, 5)).toBe('好a')
    expect(sliceDisplayRange('hello', 1, 4)).toBe('ell')
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
})
