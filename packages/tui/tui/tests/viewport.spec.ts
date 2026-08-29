import { describe, expect, it } from 'vitest'
import {
  COMPOSER_PROMPT_WIDTH, COMPOSER_WRAP_GUTTER, composerGlyphAt, composerOffsetAt,
  composerOffsetForVerticalMove, composerTextPaintWidth, composerTextWrapWidth, composerVisibleRowCount,
  exclusivePrefixSums, lineSelectableWidth, nextCodePointBoundary, nodeIndexAtLine, previousCodePointBoundary,
  scrollOffsetForScrollbarRow,
  selectComposerLayout, selectInputViewport, selectPanelViewport, selectScrollbar, selectTerminalFrameWidth,
  rememberTranscriptWindow, selectTranscriptBlocksWindow, selectTranscriptViewport, transcriptCellAt,
  transcriptLineAtRow, wrapComposerRanges,
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

  it('keeps follow mode on the tail when lines append, and holds a scrolled window when offset grows by the delta', () => {
    const first = Array.from({ length: 10 }, (_, index) => line(`l${index}`))
    const grown = Array.from({ length: 14 }, (_, index) => line(`l${index}`))
    expect(selectTranscriptViewport(first, 5, 0).lines.at(-1)?.text).toBe('l9')
    expect(selectTranscriptViewport(grown, 5, 0).lines.at(-1)?.text).toBe('l13')
    const scrolled = selectTranscriptViewport(first, 5, 3)
    expect(scrolled.lines.map(entry => entry.text)).toEqual(['l2', 'l3', 'l4', 'l5', 'l6'])
    const held = selectTranscriptViewport(grown, 5, 3 + 4)
    expect(held.lines.map(entry => entry.text)).toEqual(['l2', 'l3', 'l4', 'l5', 'l6'])
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

describe('exclusivePrefixSums', () => {
  it('maps a line to its block in log time', () => {
    const prefix = exclusivePrefixSums([3, 5, 2])
    expect(prefix).toEqual([0, 3, 8, 10])
    expect(nodeIndexAtLine(prefix, 0)).toBe(0)
    expect(nodeIndexAtLine(prefix, 2)).toBe(0)
    expect(nodeIndexAtLine(prefix, 3)).toBe(1)
    expect(nodeIndexAtLine(prefix, 7)).toBe(1)
    expect(nodeIndexAtLine(prefix, 8)).toBe(2)
    expect(nodeIndexAtLine(prefix, 9)).toBe(2)
    expect(nodeIndexAtLine([0], 0)).toBe(0)
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
    expect(windowed.windowStart).toBe(21)
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

describe('transcriptCellAt', () => {
  it('clamps to unpadded content and maps blank spacer rows to column 0', () => {
    const lines = [
      line('pad', ' '),
      { key: 'user', text: '▸ hi there          ' },
    ]
    expect(lineSelectableWidth('▸ hi there          ')).toBe(10)
    expect(transcriptCellAt(lines, 5, 0, 0, 0, 4)).toBeUndefined()
    expect(transcriptCellAt(lines, 5, 0, 0, 3, 4)?.line.key).toBe('pad')
    expect(transcriptCellAt(lines, 5, 0, 0, 3, 4)?.column).toBe(0)
    const cell = transcriptCellAt(lines, 5, 0, 0, 4, 80)
    expect(cell?.line.key).toBe('user')
    expect(cell?.column).toBe(10)
    expect(transcriptCellAt(lines, 5, 0, 0, 4, 4)?.column).toBe(2)
  })

  it('adds windowStart so a windowed slice reports absolute line indices', () => {
    const lines = Array.from({ length: 10 }, (_, index) => line(`l${index}`))
    const windowed = lines.slice(5)
    const cell = transcriptCellAt(windowed, 5, 0, 0, 0, 2, 5)
    expect(cell?.line.key).toBe('l5')
    expect(cell?.lineIndex).toBe(5)
    const last = transcriptCellAt(windowed, 5, 0, 0, 4, 2, 5)
    expect(last?.line.key).toBe('l9')
    expect(last?.lineIndex).toBe(9)
  })

  it('records an overscan window into a sparse absolute-index map', () => {
    const lines = [line('a'), line('b'), line('c')]
    const map = new Map<number, ReturnType<typeof line>>()
    rememberTranscriptWindow(map, lines, 10)
    expect(map.get(10)?.key).toBe('a')
    expect(map.get(12)?.key).toBe('c')
    expect(map.size).toBe(3)
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
    expect(layout.ranges).toHaveLength(1)
    expect(layout.ranges[0]).toEqual({ text: 'hello', start: 0, end: 5 })
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
    expect(layout.windowStart).toBe(0)
  })

  it('keeps wrap-boundary offsets adjacent so a glyph is never skipped', () => {
    const ranges = wrapComposerRanges('abcdefgh', 4)
    expect(ranges.map(range => range.text)).toEqual(['abcd', 'efgh'])
    expect(ranges[0]?.end).toBe(ranges[1]?.start)
    expect(composerOffsetAt('abcdefgh', 4, 0, 3)).toBe(3)
    expect(composerOffsetAt('abcdefgh', 4, 1, 0)).toBe(4)
  })

  it('maps a composer cell to a source offset including CJK wrap', () => {
    expect(composerOffsetAt('hello', 20, 0, 2)).toBe(2)
    expect(composerOffsetAt('中文测试文本', 4, 0, 2)).toBe(1)
    expect(composerOffsetAt('中文测试文本', 4, 1, 0)).toBe(2)
    expect(composerOffsetAt('ab\ncd', 20, 1, 1)).toBe(4)
    expect(wrapComposerRanges('中文测试', 4).map(range => range.text)).toEqual(['中文', '测试'])
  })

  it('maps a composer cell to a glyph range that includes the character under the pointer', () => {
    expect(composerGlyphAt('hello', 20, 0, 2)).toEqual({ start: 2, end: 3 })
    expect(composerGlyphAt('中文测试文本', 4, 0, 2)).toEqual({ start: 1, end: 2 })
    expect(composerGlyphAt('ab\ncd', 20, 1, 1)).toEqual({ start: 4, end: 5 })
  })

  it('reserves a two-cell prompt prefix and a one-cell wrap gutter', () => {
    expect(COMPOSER_PROMPT_WIDTH).toBe(2)
    expect(COMPOSER_WRAP_GUTTER).toBe(1)
    expect(composerTextPaintWidth(20)).toBe(18)
    expect(composerTextWrapWidth(20)).toBe(17)
    expect(composerTextWrapWidth(20)).toBeLessThan(composerTextPaintWidth(20))
    expect(composerTextWrapWidth(3)).toBe(1)
    expect(composerTextWrapWidth(2)).toBe(1)
    expect(composerTextWrapWidth(1)).toBe(1)
  })

  it('moves the composer caret by wrap row without leaving the draft', () => {
    const value = 'abcdefgh'
    const down = composerOffsetForVerticalMove(value, 4, 1, 1)
    expect(down).toBe(5)
    expect(composerOffsetForVerticalMove(value, 4, down, -1)).toBe(1)
    expect(composerOffsetForVerticalMove(value, 4, 1, -1)).toBe(1)
    expect(composerOffsetForVerticalMove(value, 4, 7, 1)).toBe(7)
    expect(composerOffsetForVerticalMove('', 4, 0, -1)).toBe(0)
  })

  it('caps ordinary multi-line drafts at the composer viewport height', () => {
    expect(composerVisibleRowCount('a\nb\nc', 0, 20, 5)).toBe(3)
    expect(composerVisibleRowCount('a\nb\nc\nd', 0, 20, 5)).toBe(4)
    expect(composerVisibleRowCount('a\nb\nc\nd\ne\nf', 0, 20, 5)).toBe(5)
  })
})
