import { describe, expect, it } from 'vitest'
import {
  nextCodePointBoundary, previousCodePointBoundary, scrollOffsetForScrollbarRow, selectComposerLayout, selectInputViewport,
  selectPanelViewport, selectScrollbar, selectTerminalFrameWidth, selectTranscriptBlocksWindow, selectTranscriptViewport,
  transcriptLineAtRow,
} from '../src/viewport'
import type { TranscriptLine } from '../src/viewport'

const line = (key: string, text = key): TranscriptLine => ({ key, text })

describe('selectTerminalFrameWidth', () => {
  it.each([
    { columns: 1, width: 1 },
    { columns: 2, width: 1 },
    { columns: 80, width: 79 },
    { columns: 100, width: 99 },
  ])('reserves the physical autowrap column at $columns columns', ({ columns, width }) => {
    expect(selectTerminalFrameWidth(columns)).toBe(width)
  })
})

describe('selectTranscriptViewport', () => {
  it('follows the newest lines at offset 0', () => {
    const lines = Array.from({ length: 10 }, (_, index) => line(`l${index}`))
    const viewport = selectTranscriptViewport(lines, 5, 0)
    expect(viewport.offset).toBe(0)
    expect(viewport.maximumOffset).toBe(5) // 10 lines - 5 content rows
    expect(viewport.lines.map(entry => entry.text)).toEqual(['l5', 'l6', 'l7', 'l8', 'l9'])
  })

  it('hides lines from the bottom as the offset grows', () => {
    const lines = Array.from({ length: 10 }, (_, index) => line(`l${index}`))
    const viewport = selectTranscriptViewport(lines, 5, 3)
    expect(viewport.offset).toBe(3)
    // The last 3 lines hidden; the window shows the 5 before them.
    expect(viewport.lines.map(entry => entry.text)).toEqual(['l2', 'l3', 'l4', 'l5', 'l6'])
  })

  it('clamps the offset to the maximum and never hides the first line', () => {
    const lines = Array.from({ length: 3 }, (_, index) => line(`l${index}`))
    const viewport = selectTranscriptViewport(lines, 5, 99)
    expect(viewport.maximumOffset).toBe(0)
    expect(viewport.offset).toBe(0)
    expect(viewport.lines.length).toBe(3)
  })

  it('returns an empty slice for an empty transcript', () => {
    const viewport = selectTranscriptViewport([], 5, 0)
    expect(viewport.lines).toEqual([])
    expect(viewport.maximumOffset).toBe(0)
  })

  it('reserves bottom rows for a pinned button without losing the tail', () => {
    const lines = Array.from({ length: 10 }, (_, index) => line(`l${index}`))
    const viewport = selectTranscriptViewport(lines, 5, 0, 1)
    expect(viewport.lines.map(entry => entry.text)).toEqual(['l6', 'l7', 'l8', 'l9'])
    expect(viewport.maximumOffset).toBe(6)
  })

  it('shrinks the content window further while scrolled with a bottom row reserved', () => {
    const lines = Array.from({ length: 10 }, (_, index) => line(`l${index}`))
    const viewport = selectTranscriptViewport(lines, 5, 2, 1)
    expect(viewport.lines.map(entry => entry.text)).toEqual(['l4', 'l5', 'l6', 'l7'])
  })
})

describe('selectTranscriptBlocksWindow', () => {
  const blocksOf = (count: number, size: number): TranscriptLine[][] =>
    Array.from({ length: count }, (_, block) =>
      Array.from({ length: size }, (_, index) => line(`b${block}-${index}`)))

  it('matches a flat viewport at offset 0 after slicing the overscan window', () => {
    const blocks = blocksOf(20, 5)
    const flat = blocks.flat()
    const windowed = selectTranscriptBlocksWindow(blocks, 8, 0, 4)
    const sliced = selectTranscriptViewport(windowed.lines, 8, windowed.relativeOffset)
    expect(windowed.totalCount).toBe(100)
    expect(windowed.maximumOffset).toBe(92)
    expect(windowed.offset).toBe(0)
    expect(sliced.lines.map(entry => entry.text)).toEqual(flat.slice(92).map(entry => entry.text))
    expect(windowed.lines.length).toBeLessThan(flat.length)
  })

  it('keeps the same visible slice as a flat transcript when scrolled', () => {
    const blocks = blocksOf(20, 5)
    const flat = blocks.flat()
    const windowed = selectTranscriptBlocksWindow(blocks, 8, 17, 4)
    const sliced = selectTranscriptViewport(windowed.lines, 8, windowed.relativeOffset)
    expect(windowed.offset).toBe(17)
    expect(sliced.lines.map(entry => entry.text)).toEqual(
      selectTranscriptViewport(flat, 8, 17).lines.map(entry => entry.text),
    )
  })

  it('includes overscan rows without changing the clamped offset', () => {
    const blocks = blocksOf(10, 4)
    const windowed = selectTranscriptBlocksWindow(blocks, 6, 10, 3)
    expect(windowed.offset).toBe(10)
    expect(windowed.lines.length).toBe(6 + 3 + 3)
    expect(windowed.lines[0]?.text).toBe('b5-1')
  })
})

describe('transcriptLineAtRow', () => {
  it('accounts for bottom alignment when the transcript is shorter than its viewport', () => {
    const lines = [line('a'), line('b')]
    expect(transcriptLineAtRow(lines, 5, 0, 0, 0)).toBeUndefined()
    expect(transcriptLineAtRow(lines, 5, 0, 0, 2)).toBeUndefined()
    expect(transcriptLineAtRow(lines, 5, 0, 0, 3)?.key).toBe('a')
    expect(transcriptLineAtRow(lines, 5, 0, 0, 4)?.key).toBe('b')
  })

  it('excludes a pinned bottom row from disclosure hit testing', () => {
    const lines = [line('a'), line('b')]
    expect(transcriptLineAtRow(lines, 5, 0, 1, 2)?.key).toBe('a')
    expect(transcriptLineAtRow(lines, 5, 0, 1, 3)?.key).toBe('b')
    expect(transcriptLineAtRow(lines, 5, 0, 1, 4)).toBeUndefined()
  })

  it('maps scrolled rows to the same slice used by the viewport', () => {
    const lines = Array.from({ length: 10 }, (_, index) => line(`l${index}`))
    expect(transcriptLineAtRow(lines, 5, 3, 0, 0)?.key).toBe('l2')
    expect(transcriptLineAtRow(lines, 5, 3, 0, 4)?.key).toBe('l6')
  })
})

describe('selectPanelViewport', () => {
  const rows = (count: number): TranscriptLine[] => Array.from({ length: count }, (_, index) => line(`r${index}`))

  it('anchors offset 0 to the TOP of the list (no tail following)', () => {
    const viewport = selectPanelViewport(rows(30), 5, 0)
    expect(viewport.lines.map(entry => entry.text)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4'])
    expect(viewport.maximumOffset).toBe(25)
  })

  it('counts hidden rows from the top and reserves no banner row', () => {
    const viewport = selectPanelViewport(rows(30), 5, 8)
    expect(viewport.lines.map(entry => entry.text)).toEqual(['r8', 'r9', 'r10', 'r11', 'r12'])
    expect(viewport.offset).toBe(8)
  })

  it('clamps the offset so the last rows stay reachable', () => {
    const viewport = selectPanelViewport(rows(30), 5, 99)
    expect(viewport.offset).toBe(25)
    expect(viewport.lines.map(entry => entry.text)).toEqual(['r25', 'r26', 'r27', 'r28', 'r29'])
  })

  it('returns an empty slice for an empty list', () => {
    const viewport = selectPanelViewport([], 5, 0)
    expect(viewport.lines).toEqual([])
    expect(viewport.maximumOffset).toBe(0)
  })
})

describe('selectScrollbar', () => {
  it('hides when the transcript fits the viewport', () => {
    const scrollbar = selectScrollbar(10, 10, 0)
    expect(scrollbar.visible).toBe(false)
    expect(scrollbar.contentHeight).toBe(10)
  })

  it('shows once the transcript overflows and pins the thumb to the bottom in follow mode', () => {
    const scrollbar = selectScrollbar(30, 10, 0)
    expect(scrollbar.visible).toBe(true)
    expect(scrollbar.contentHeight).toBe(10)
    expect(scrollbar.thumbHeight).toBeGreaterThanOrEqual(1)
    expect(scrollbar.thumbHeight).toBeLessThanOrEqual(10)
    // Offset 0 = newest lines → thumb at the bottom of the column.
    expect(scrollbar.thumbTop + scrollbar.thumbHeight).toBe(10)
  })

  it('pins the thumb to the top at the maximum offset', () => {
    const scrollbar = selectScrollbar(30, 10, 20)
    expect(scrollbar.visible).toBe(true)
    expect(scrollbar.thumbTop).toBe(0)
  })

  it('moves the thumb between the ends for a mid offset', () => {
    const scrollbar = selectScrollbar(30, 10, 10)
    expect(scrollbar.thumbTop).toBeGreaterThan(0)
    expect(scrollbar.thumbTop + scrollbar.thumbHeight).toBeLessThan(10)
  })

  it('clamps an over-requested offset and never overflows the column', () => {
    const scrollbar = selectScrollbar(30, 10, 999)
    expect(scrollbar.thumbTop).toBe(0)
    expect(scrollbar.thumbTop + scrollbar.thumbHeight).toBeLessThanOrEqual(10)
  })

  it('excludes the reserved bottom row from the thumb travel', () => {
    const scrollbar = selectScrollbar(30, 10, 0, 1)
    expect(scrollbar.contentHeight).toBe(9)
    expect(scrollbar.thumbTop + scrollbar.thumbHeight).toBe(9)
  })
})

describe('scrollOffsetForScrollbarRow', () => {
  it('maps the top row to the OLDEST lines (maximum offset)', () => {
    expect(scrollOffsetForScrollbarRow(5, 5, 10, 20)).toBe(20)
  })

  it('maps the bottom row to the newest lines (offset 0)', () => {
    expect(scrollOffsetForScrollbarRow(14, 5, 10, 20)).toBe(0)
  })

  it('maps a mid row to a mid offset', () => {
    const offset = scrollOffsetForScrollbarRow(7, 5, 10, 20)
    expect(offset).toBeGreaterThan(0)
    expect(offset).toBeLessThan(20)
  })

  it('clamps rows outside the column to its ends', () => {
    expect(scrollOffsetForScrollbarRow(1, 5, 10, 20)).toBe(20)
    expect(scrollOffsetForScrollbarRow(99, 5, 10, 20)).toBe(0)
  })
})

describe('selectInputViewport', () => {
  it('shows the whole value with the caret column at its end', () => {
    const viewport = selectInputViewport('hello', 5, 12)
    expect(viewport.text).toBe('hello')
    expect(viewport.cursorColumn).toBe(5)
  })

  it('reserves one cell for the native cursor', () => {
    // Width 6 → 5 usable cells; 'hello' (5) fills them exactly.
    const viewport = selectInputViewport('hello', 5, 6)
    expect(viewport.text).toBe('hello')
    expect(viewport.cursorColumn).toBe(5)
  })

  it('ellipsizes the right side when the caret is near the start', () => {
    const viewport = selectInputViewport('abcdefghij', 0, 8)
    expect(viewport.text).toBe('abcdef…')
    expect(viewport.cursorColumn).toBe(0)
  })

  it('ellipsizes both sides with the caret in the middle', () => {
    const viewport = selectInputViewport('abcdefghijklmnop', 8, 10)
    expect(viewport.text.startsWith('…')).toBe(true)
    expect(viewport.text.endsWith('…')).toBe(true)
    expect(viewport.cursorColumn).toBeGreaterThan(0)
  })
})

describe('code-point boundaries', () => {
  it('steps over surrogate pairs', () => {
    const emoji = 'a😀b'
    expect(previousCodePointBoundary(emoji, 3)).toBe(1)
    expect(nextCodePointBoundary(emoji, 1)).toBe(3)
  })
})

describe('selectComposerLayout', () => {
  it('keeps a short value on one line with the caret at its end', () => {
    const layout = selectComposerLayout('hello', 5, 20, 5)
    expect(layout.visibleLines).toEqual(['hello'])
    expect(layout.caretLine).toBe(0)
    expect(layout.caretColumn).toBe(5)
  })

  it('wraps overflowing text onto a second line instead of truncating', () => {
    const layout = selectComposerLayout('abcdefghij', 10, 4, 5)
    expect(layout.visibleLines).toEqual(['abcd', 'efgh', 'ij'])
    expect(layout.caretLine).toBe(2)
    expect(layout.caretColumn).toBe(2)
  })

  it('places the caret at column 0 on the next line when the prefix fills a row exactly', () => {
    const layout = selectComposerLayout('abcdefgh', 4, 4, 5)
    expect(layout.visibleLines).toEqual(['abcd', 'efgh'])
    expect(layout.caretLine).toBe(1)
    expect(layout.caretColumn).toBe(0)
  })

  it('keeps the caret on its own line with the caret column inside the prefix', () => {
    const layout = selectComposerLayout('abcdefghij', 7, 4, 5)
    expect(layout.visibleLines).toEqual(['abcd', 'efgh', 'ij'])
    expect(layout.caretLine).toBe(1)
    expect(layout.caretColumn).toBe(3)
  })

  it('caps the visible window at maxLines with the caret line last', () => {
    const value = 'a'.repeat(40)
    const layout = selectComposerLayout(value, 40, 4, 3)
    expect(layout.visibleLines).toEqual(['aaaa', 'aaaa', 'aaaa'])
    expect(layout.caretLine).toBe(2)
    expect(layout.caretColumn).toBe(4)
  })

  it('slides the window so an early caret stays visible at the window head', () => {
    const value = 'a'.repeat(40)
    const layout = selectComposerLayout(value, 2, 4, 3)
    expect(layout.visibleLines).toEqual(['aaaa', 'aaaa', 'aaaa'])
    expect(layout.caretLine).toBe(0)
    expect(layout.caretColumn).toBe(2)
  })

  it('keeps a mid-text caret inside a sliding window', () => {
    const value = 'a'.repeat(40)
    const layout = selectComposerLayout(value, 20, 4, 3)
    expect(layout.visibleLines).toEqual(['aaaa', 'aaaa', 'aaaa'])
    expect(layout.caretLine).toBe(2)
    expect(layout.caretColumn).toBe(0)
  })

  it('honors explicit newlines from Shift+Enter', () => {
    const layout = selectComposerLayout('ab\ncd', 5, 20, 5)
    expect(layout.visibleLines).toEqual(['ab', 'cd'])
    expect(layout.caretLine).toBe(1)
    expect(layout.caretColumn).toBe(2)
  })

  it('wraps a CJK run by display cells', () => {
    const layout = selectComposerLayout('中文测试文本', 6, 4, 5)
    expect(layout.visibleLines).toEqual(['中文', '测试', '文本'])
    expect(layout.caretLine).toBe(2)
    expect(layout.caretColumn).toBe(4)
  })

  it('uses Ink 7.1.1 display widths for emoji and ambiguous Unicode symbols', () => {
    const layout = selectComposerLayout('a⚙😀中', 4, 5, 5)
    expect(layout.visibleLines).toEqual(['a⚙😀', '中'])
    expect(layout.caretLine).toBe(0)
    expect(layout.caretColumn).toBe(4)
  })

  it.each([
    { offset: 3, line: 0, column: 3 },
    { offset: 4, line: 1, column: 0 },
    { offset: 5, line: 1, column: 1 },
  ])('keeps width-1, exact-width, and width+1 caret positions stable at offset $offset', ({ offset, line, column }) => {
    const layout = selectComposerLayout('abcde', offset, 4, 5)
    expect(layout.caretLine).toBe(line)
    expect(layout.caretColumn).toBe(column)
  })

  it('returns one empty line for an empty value', () => {
    const layout = selectComposerLayout('', 0, 20, 5)
    expect(layout.visibleLines).toEqual([''])
    expect(layout.caretLine).toBe(0)
    expect(layout.caretColumn).toBe(0)
  })
})
