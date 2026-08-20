/**
 * Pure viewport math for the transcript and the composer, ported from the
 * DamnatioX TypeScript TUI. The transcript viewport slices rendered lines by
 * a scroll offset that counts hidden lines from the bottom; the composer
 * viewport hard-wraps overflowing input onto further lines and keeps the
 * caret's own line visible.
 * @module @deepseek-ai/dsh-tui/src/viewport
 */

import stringWidth from 'string-width'

/**
 * Select the width Ink may paint without touching the terminal's autowrap
 * column. A terminal with at least two columns keeps its final physical cell
 * blank, so repaint control sequences never inherit a pending right-margin
 * wrap from a full-width frame.
 * @param terminalColumns - physical terminal columns.
 * @returns the frame width in terminal cells.
 */
export function selectTerminalFrameWidth(terminalColumns: number): number {
  return Math.max(1, Math.floor(terminalColumns) - 1)
}

/** One styled transcript line entering the viewport. */
export interface TranscriptLine {
  key: string
  text: string
  color?: string
  bold?: boolean
  dim?: boolean
  /** Waiting retry headers blink dim from a Transcript-local timer. */
  pulse?: boolean
  /**
   * Live thinking/compaction header. Transcript owns the 100ms glyph and
   * shimmer so ChatTranscript does not rebuild the window on that timer.
   */
  shimmer?: 'thinking' | 'compact'
  /** Epoch ms for the elapsed suffix on a thinking shimmer row. */
  shimmerSince?: number
  /** Grok prompt-block fill (`bg = light`): a gray bar behind user rows. */
  background?: boolean
  runs?: { text: string; bold?: boolean; code?: boolean; underline?: boolean; dim?: boolean; color?: string }[]
  /** Node whose disclosure arrow owns this header line. */
  disclosureNodeId?: number
  /** Thinking arrows toggle the global display; other arrows toggle one node. */
  disclosureKind?: 'thinking' | 'node'
}

/** The visible slice plus its scroll bookkeeping. */
export interface TranscriptViewport {
  lines: TranscriptLine[]
  offset: number
  maximumOffset: number
}

/**
 * Slice the rendered transcript lines to one viewport. The offset counts
 * hidden lines from the bottom (offset 0 = follow mode). `bottomReserved`
 * rows (a floating back-to-bottom button) pin to the viewport bottom
 * outside the scroll area.
 * @param lines - all rendered transcript lines.
 * @param height - the viewport height in rows.
 * @param requestedOffset - the requested scroll offset (hidden bottom lines).
 * @param bottomReserved - rows reserved at the bottom of the viewport.
 * @returns the visible slice and clamped offset facts.
 */
export function selectTranscriptViewport(
  lines: readonly TranscriptLine[],
  height: number,
  requestedOffset: number,
  bottomReserved = 0,
): TranscriptViewport {
  const viewportHeight = Math.max(1, Math.floor(height))
  const reserved = Math.max(0, Math.min(Math.floor(bottomReserved), viewportHeight - 1))
  const capacity = Math.max(1, viewportHeight - reserved)
  const normalizedOffset = Number.isFinite(requestedOffset)
    ? Math.max(0, Math.floor(requestedOffset))
    : 0
  const maximumOffset = Math.max(0, lines.length - capacity)
  const offset = Math.min(normalizedOffset, maximumOffset)
  const end = Math.max(0, lines.length - offset)
  const start = Math.max(0, end - capacity)
  return {
    lines: lines.slice(start, end),
    offset,
    maximumOffset,
  }
}

/** Extra projected rows above and below the visible transcript slice. */
export const TRANSCRIPT_LINE_OVERSCAN = 32

/** One overscan window over per-node (or tail) line blocks. */
export interface TranscriptBlocksWindow {
  /** Concatenated rows covering the viewport plus overscan. */
  lines: TranscriptLine[]
  /** Scroll offset relative to {@link lines}, for {@link selectTranscriptViewport}. */
  relativeOffset: number
  /** Clamped hidden-from-bottom offset in the full transcript. */
  offset: number
  /** Maximum offset from the full line count. */
  maximumOffset: number
  /** Sum of every block's length. */
  totalCount: number
  /** Absolute index of {@link lines}[0] in the full transcript. */
  windowStart: number
}

/**
 * Concatenate only the blocks that intersect the visible slice plus overscan.
 * Line counts still walk every block so the scrollbar knows the full length;
 * Ink never receives the off-window rows.
 * @param blocks - per-node (and tail) line arrays in transcript order.
 * @param height - the viewport height in rows.
 * @param requestedOffset - hidden lines counted from the bottom.
 * @param overscan - extra rows before and after the visible slice.
 * @param bottomReserved - rows reserved at the bottom of the viewport.
 * @returns the overscan window and the full-transcript scroll facts.
 */
export function selectTranscriptBlocksWindow(
  blocks: readonly (readonly TranscriptLine[])[],
  height: number,
  requestedOffset: number,
  overscan = TRANSCRIPT_LINE_OVERSCAN,
  bottomReserved = 0,
): TranscriptBlocksWindow {
  const viewportHeight = Math.max(1, Math.floor(height))
  const reserved = Math.max(0, Math.min(Math.floor(bottomReserved), viewportHeight - 1))
  const capacity = Math.max(1, viewportHeight - reserved)
  const extra = Math.max(0, Math.floor(overscan))
  let total = 0
  for (const block of blocks) total += block.length
  const maximumOffset = Math.max(0, total - capacity)
  const offset = Math.min(
    Number.isFinite(requestedOffset) ? Math.max(0, Math.floor(requestedOffset)) : 0,
    maximumOffset,
  )
  const end = Math.max(0, total - offset)
  const start = Math.max(0, end - capacity)
  const windowStart = Math.max(0, start - extra)
  const windowEnd = Math.min(total, end + extra)
  const lines: TranscriptLine[] = []
  let cursor = 0
  for (const block of blocks) {
    const next = cursor + block.length
    if (next > windowStart && cursor < windowEnd) {
      const sliceStart = Math.max(0, windowStart - cursor)
      const sliceEnd = Math.min(block.length, windowEnd - cursor)
      for (let index = sliceStart; index < sliceEnd; index += 1) {
        const line = block[index]
        if (line !== undefined) lines.push(line)
      }
    }
    cursor = next
    if (cursor >= windowEnd) break
  }
  return {
    lines,
    relativeOffset: windowEnd - end,
    offset,
    maximumOffset,
    totalCount: total,
    windowStart,
  }
}

/**
 * Resolve one zero-based terminal row inside the transcript to its rendered
 * line. The transcript bottom-aligns short content and may reserve its last
 * row for the back-to-bottom button, so raw viewport indices are insufficient
 * for mouse hit testing.
 * @param lines - all rendered transcript lines.
 * @param height - complete transcript height.
 * @param requestedOffset - hidden lines counted from the bottom.
 * @param bottomReserved - rows pinned below the scrolling content.
 * @param row - zero-based row inside the complete transcript box.
 * @returns the line under that row, or `undefined` for padding/reserved rows.
 */
export function transcriptLineAtRow(
  lines: readonly TranscriptLine[],
  height: number,
  requestedOffset: number,
  bottomReserved: number,
  row: number,
): TranscriptLine | undefined {
  const viewportHeight = Math.max(1, Math.floor(height))
  const reserved = Math.max(0, Math.min(Math.floor(bottomReserved), viewportHeight - 1))
  const contentHeight = viewportHeight - reserved
  const position = Math.floor(row)
  if (position < 0 || position >= contentHeight) return undefined
  const viewport = selectTranscriptViewport(lines, viewportHeight, requestedOffset, reserved)
  const padding = Math.max(0, contentHeight - viewport.lines.length)
  return viewport.lines[position - padding]
}

/**
 * Display width of a painted row excluding trailing pad spaces. A click on
 * the empty gray tail of a user prompt must not become a full-width range.
 * @param text - one painted row, possibly padded with `padEndDisplay`.
 * @returns the selectable display-column count.
 */
export function lineSelectableWidth(text: string): number {
  return stringWidth(text.replace(/[ \t]+$/u, ''))
}

/**
 * Map a mouse row/column onto one cell of the windowed transcript, honoring
 * flex-end padding and the left content pad (terminal column 2).
 * @param lines - windowed transcript lines.
 * @param height - complete transcript height.
 * @param requestedOffset - hidden lines counted from the bottom of `lines`.
 * @param bottomReserved - rows pinned below the scrolling content.
 * @param row - zero-based row inside the complete transcript box.
 * @param terminalColumn - 1-based terminal column of the click.
 * @returns the cell, or `undefined` for flex-end padding, reserved rows, or the gutter.
 * Blank spacer rows still return a cell (column 0) so a drag can start or
 * pass through them; copy skips those rows.
 */
export function transcriptCellAt(
  lines: readonly TranscriptLine[],
  height: number,
  requestedOffset: number,
  bottomReserved: number,
  row: number,
  terminalColumn: number,
): { lineIndex: number; column: number; line: TranscriptLine } | undefined {
  const viewportHeight = Math.max(1, Math.floor(height))
  const reserved = Math.max(0, Math.min(Math.floor(bottomReserved), viewportHeight - 1))
  const contentHeight = viewportHeight - reserved
  const position = Math.floor(row)
  if (position < 0 || position >= contentHeight) return undefined
  const viewport = selectTranscriptViewport(lines, viewportHeight, requestedOffset, reserved)
  const padding = Math.max(0, contentHeight - viewport.lines.length)
  const visibleIndex = position - padding
  const line = viewport.lines[visibleIndex]
  if (line === undefined) return undefined
  const selectable = lineSelectableWidth(line.text)
  const capacity = Math.max(1, contentHeight)
  const normalizedOffset = Number.isFinite(requestedOffset) ? Math.max(0, Math.floor(requestedOffset)) : 0
  const maximumOffset = Math.max(0, lines.length - capacity)
  const offset = Math.min(normalizedOffset, maximumOffset)
  const end = Math.max(0, lines.length - offset)
  const start = Math.max(0, end - capacity)
  const lineIndex = start + visibleIndex
  const column = selectable <= 0
    ? 0
    : Math.max(0, Math.min(selectable, Math.floor(terminalColumn) - 2))
  return { lineIndex, column, line }
}

/** The visible text plus the caret column inside one single-line input. */
export interface InputViewport {
  text: string
  cursorColumn: number
}

/**
 * Compute the visible slice of one single-line input around its caret, with
 * one terminal cell reserved for the native cursor. Values wider than the
 * available cells get `…` ellipses on the hidden side(s); the caret column
 * is the display width of the visible prefix.
 * @param value - the full input value.
 * @param cursorOffset - the caret offset in code units.
 * @param width - the available cells (the box width).
 * @returns the visible text and the caret column.
 */
export function selectInputViewport(
  value: string,
  cursorOffset: number,
  width: number,
): InputViewport {
  // Keep one terminal cell free for the native cursor. Without this reserve,
  // an exact-width value places the IME cursor in the next box/terminal row.
  const available = Math.max(0, Math.floor(width) - 1)
  if (available === 0) {
    return { text: '', cursorColumn: 0 }
  }
  const boundedOffset = Math.max(0, Math.min(cursorOffset, value.length))
  const before = visible(value.slice(0, boundedOffset))
  const after = visible(value.slice(boundedOffset))
  const beforeWidth = stringWidth(before)
  const afterWidth = stringWidth(after)
  if (beforeWidth + afterWidth <= available) {
    return { text: `${before}${after}`, cursorColumn: beforeWidth }
  }
  const desiredRight = Math.min(afterWidth, Math.floor(available / 3))
  const leftWindow = available - desiredRight
  const leftHidden = beforeWidth > leftWindow
  const leftContent = leftHidden
    ? takeDisplaySuffix(before, Math.max(0, leftWindow - 1))
    : before
  const left = `${leftHidden ? '…' : ''}${leftContent}`
  const remaining = Math.max(0, available - stringWidth(left))
  const rightHidden = afterWidth > remaining
  const right = takeDisplayPrefix(after, Math.max(0, remaining - (rightHidden ? 1 : 0)))
  return {
    text: `${left}${right}${rightHidden ? '…' : ''}`,
    cursorColumn: stringWidth(left),
  }
}

/** Render newlines as one visible glyph so the composer stays single-line. */
function visible(value: string): string {
  return value.replaceAll('\r\n', '↵').replaceAll(/[\r\n]/gu, '↵')
}

/** The visible lines plus the caret position of one multi-line composer. */
export interface ComposerLayout {
  /** The visible wrapped lines, caret line LAST (the window follows the caret). */
  visibleLines: string[]
  /** Caret row within `visibleLines` (always `visibleLines.length - 1`). */
  caretLine: number
  /** Caret column in terminal cells on the caret row. */
  caretColumn: number
  /** Index into the full wrap of the first visible line. */
  windowStart: number
}

/**
 * Wrap one composer value into at most `maxLines` lines and anchor the caret
 * inside its own line. Greedy left-anchored wrapping means the wrap points
 * before the caret are exactly the wrap points of the prefix, so the caret
 * column is the display width of the prefix's last wrapped line; a prefix
 * that exactly fills its row moves the caret to column 0 of the next line.
 * The visible window always includes the caret's line and slides within the
 * full wrap so later lines stay visible after the caret.
 * @param value - the full input value (may contain newlines).
 * @param cursorOffset - the caret offset in code units.
 * @param width - the available cells per line.
 * @param maxLines - the tallest composer, in lines.
 * @returns the visible slice and caret placement.
 */
export function selectComposerLayout(
  value: string,
  cursorOffset: number,
  width: number,
  maxLines: number,
): ComposerLayout {
  const lineWidth = Math.max(1, Math.floor(width))
  const bounded = Math.max(0, Math.min(cursorOffset, value.length))
  const prefix = value.slice(0, bounded)
  const prefixLines = wrapComposerText(prefix, lineWidth)
  const lines = wrapComposerText(value, lineWidth)
  let caretLineIndex = Math.max(0, Math.min(prefixLines.length - 1, lines.length - 1))
  const caretLineText = prefixLines[caretLineIndex] ?? ''
  const caretLineWidth = stringWidth(caretLineText)
  let caretColumn = caretLineWidth
  // An exactly-filled row places the caret at the START of the next line.
  if (caretLineWidth >= lineWidth && bounded < value.length) {
    caretColumn = 0
    caretLineIndex = Math.min(caretLineIndex + 1, Math.max(0, lines.length - 1))
  }
  const windowMax = Math.max(1, maxLines)
  const start = Math.max(0, Math.min(caretLineIndex - windowMax + 1, Math.max(0, lines.length - windowMax)))
  const visibleLines = lines.slice(start, start + windowMax)
  return { visibleLines, caretLine: caretLineIndex - start, caretColumn, windowStart: start }
}

/** One wrapped composer row and its source offsets. */
export interface ComposerLineRange {
  text: string
  start: number
  end: number
}

/**
 * Hard-wrap one composer value by cells, keeping empty lines, and record the
 * source offsets of each painted row so mouse hits can set the caret.
 * @param value - the full input value (may contain newlines).
 * @param width - wrap budget in terminal cells.
 * @returns wrapped rows with `[start, end)` offsets into `value`.
 */
export function wrapComposerRanges(value: string, width: number): ComposerLineRange[] {
  const lineWidth = Math.max(1, Math.floor(width))
  const out: ComposerLineRange[] = []
  let offset = 0
  const parts = value.split('\n')
  for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
    const source = parts[partIndex] ?? ''
    if (source === '') {
      out.push({ text: '', start: offset, end: offset })
      offset += partIndex === parts.length - 1 ? 0 : 1
      continue
    }
    let current = ''
    let currentStart = offset
    let currentWidth = 0
    let index = 0
    while (index < source.length) {
      const next = nextCodePointBoundary(source, index)
      const character = source.slice(index, next)
      const characterWidth = Math.max(1, stringWidth(character))
      if (currentWidth > 0 && currentWidth + characterWidth > lineWidth) {
        out.push({ text: current, start: currentStart, end: offset + index })
        current = ''
        currentStart = offset + index
        currentWidth = 0
        continue
      }
      current += character
      currentWidth += characterWidth
      index = next
    }
    out.push({ text: current, start: currentStart, end: offset + source.length })
    offset += source.length + (partIndex === parts.length - 1 ? 0 : 1)
  }
  return out.length === 0 ? [{ text: '', start: 0, end: 0 }] : out
}

/** Hard-wrap one composer value by cells, keeping empty lines (multi-line input). */
function wrapComposerText(value: string, width: number): string[] {
  return wrapComposerRanges(value, width).map(range => range.text)
}

/** Display cells taken by `› ` on wrap line 0 and the matching indent on later rows. */
export const COMPOSER_PROMPT_WIDTH = 2
/**
 * Empty cell at the end of each composer wrap row. A line that fills the
 * painted box clips its last glyph under Ink `truncate` (width `>=` box)
 * and Windows Terminal pending-wrap; wrap one cell sooner than paint.
 */
export const COMPOSER_WRAP_GUTTER = 1

/**
 * Painted text cells after the prompt prefix (includes {@link COMPOSER_WRAP_GUTTER}).
 * @param boxWidth - inner width of the composer input box, including the prefix.
 * @returns cells in the text box to the right of `› `/indent.
 */
export function composerTextPaintWidth(boxWidth: number): number {
  return Math.max(1, Math.floor(boxWidth) - COMPOSER_PROMPT_WIDTH)
}

/**
 * Wrap budget for composer text after the prompt prefix.
 * @param boxWidth - inner width of the composer input box, including the prefix.
 * @returns cells available for wrapped draft text.
 */
export function composerTextWrapWidth(boxWidth: number): number {
  return Math.max(1, composerTextPaintWidth(boxWidth) - COMPOSER_WRAP_GUTTER)
}

/**
 * Map a visible composer cell to a source offset.
 * @param value - the full input value.
 * @param width - wrap budget in terminal cells.
 * @param lineIndex - 0-based row in the full wrap (not the sliding window).
 * @param column - 0-based display column on that row.
 * @returns a code-unit offset into `value`.
 */
export function composerOffsetAt(value: string, width: number, lineIndex: number, column: number): number {
  const ranges = wrapComposerRanges(value, width)
  if (ranges.length === 0) return 0
  const row = ranges[Math.max(0, Math.min(lineIndex, ranges.length - 1))]
  if (row === undefined) return value.length
  const target = Math.max(0, column)
  let used = 0
  let index = row.start
  while (index < row.end) {
    const next = nextCodePointBoundary(value, index)
    const character = value.slice(index, next)
    const characterWidth = Math.max(1, stringWidth(character))
    if (used + characterWidth > target) return index
    used += characterWidth
    index = next
  }
  return row.end
}

/**
 * Source offsets of the glyph under a composer cell. The exclusive end is the
 * next code-point boundary so a drag includes the character under the pointer
 * in both directions.
 * @param value - the full input value.
 * @param width - wrap budget in terminal cells.
 * @param lineIndex - 0-based row in the full wrap (not the sliding window).
 * @param column - 0-based display column on that row.
 * @returns inclusive start and exclusive end offsets of that glyph.
 */
export function composerGlyphAt(
  value: string,
  width: number,
  lineIndex: number,
  column: number,
): { start: number; end: number } {
  const start = composerOffsetAt(value, width, lineIndex, column)
  if (start >= value.length) return { start: value.length, end: value.length }
  return { start, end: nextCodePointBoundary(value, start) }
}

/**
 * Move the composer caret by one wrap row, keeping the display column.
 * First-row up and last-row down leave the offset unchanged.
 * @param value - the full input value.
 * @param width - wrap budget in terminal cells.
 * @param cursorOffset - caret offset in code units.
 * @param direction - `-1` up, `1` down.
 * @returns the caret offset after the move.
 */
export function composerOffsetForVerticalMove(
  value: string,
  width: number,
  cursorOffset: number,
  direction: -1 | 1,
): number {
  if (value === '') return 0
  const ranges = wrapComposerRanges(value, width)
  const layout = selectComposerLayout(value, cursorOffset, width, Math.max(1, ranges.length))
  const nextLine = layout.windowStart + layout.caretLine + direction
  if (nextLine < 0 || nextLine >= ranges.length) return cursorOffset
  return composerOffsetAt(value, width, nextLine, layout.caretColumn)
}

/** Hard-newline count at which the composer collapses to a preview plus a line-count row. */
export const COMPOSER_COLLAPSE_HARD_LINES = 4

/**
 * Number of hard-newline lines in a composer value. An empty value is one line.
 * @param value - the composer draft.
 * @returns the line count.
 */
export function countComposerHardLines(value: string): number {
  return value === '' ? 1 : value.split('\n').length
}

/**
 * Rows the composer paints: 2 when the draft has at least
 * {@link COMPOSER_COLLAPSE_HARD_LINES} hard lines, otherwise the wrapped
 * caret window capped at `maxLines`.
 * @param value - the composer draft.
 * @param cursorOffset - caret offset in code units.
 * @param width - wrap budget in terminal cells.
 * @param maxLines - the tallest expanded composer.
 * @returns the painted row count.
 */
export function composerVisibleRowCount(
  value: string,
  cursorOffset: number,
  width: number,
  maxLines: number,
): number {
  if (countComposerHardLines(value) >= COMPOSER_COLLAPSE_HARD_LINES) return 2
  return selectComposerLayout(value, cursorOffset, width, maxLines).visibleLines.length
}

/**
 * Slice panel rows to one TOP-anchored viewport: offset 0 shows the first
 * row, and the offset counts hidden rows from the top. Panels are lists,
 * not transcripts, so unlike {@link selectTranscriptViewport} no banner row
 * is reserved and the anchor never follows the tail.
 * @param lines - all rendered panel rows.
 * @param height - the viewport height in rows.
 * @param requestedOffset - the requested scroll offset (hidden top rows).
 * @returns the visible slice and clamped offset facts.
 */
export function selectPanelViewport(
  lines: TranscriptLine[],
  height: number,
  requestedOffset: number,
): TranscriptViewport {
  const viewportHeight = Math.max(1, Math.floor(height))
  const normalizedOffset = Number.isFinite(requestedOffset)
    ? Math.max(0, Math.floor(requestedOffset))
    : 0
  const maximumOffset = Math.max(0, lines.length - viewportHeight)
  const offset = Math.min(normalizedOffset, maximumOffset)
  return {
    lines: lines.slice(offset, offset + viewportHeight),
    offset,
    maximumOffset,
  }
}

/** The right-edge scrollbar column for the transcript viewport. */
export interface ScrollbarState {
  /** Whether the transcript overflows the viewport (the column is drawn). */
  visible: boolean
  /** 0-based first content row the thumb occupies. */
  thumbTop: number
  /** Content rows the thumb occupies (at least one when visible). */
  thumbHeight: number
  /** Rows the column spans (the viewport minus reserved bottom rows). */
  contentHeight: number
}

/**
 * Compute the right-edge scrollbar column for the transcript viewport. The
 * thumb mirrors the scroll offset: offset 0 (follow mode, newest lines) pins
 * it to the BOTTOM, the maximum offset (oldest lines) pins it to the top.
 * The bottom-reserved row (the floating back-to-bottom button) stays outside
 * the thumb's travel and renders plain rail.
 * @param lineCount - all rendered transcript lines.
 * @param height - the viewport height in rows.
 * @param requestedOffset - the requested scroll offset (hidden bottom lines).
 * @param bottomReserved - rows reserved at the bottom of the viewport.
 * @returns the scrollbar geometry.
 */
export function selectScrollbar(
  lineCount: number,
  height: number,
  requestedOffset: number,
  bottomReserved = 0,
): ScrollbarState {
  const viewportHeight = Math.max(1, Math.floor(height))
  const reserved = Math.max(0, Math.min(Math.floor(bottomReserved), viewportHeight - 1))
  const capacity = Math.max(1, viewportHeight - reserved)
  const maximumOffset = Math.max(0, Math.floor(lineCount) - capacity)
  if (maximumOffset <= 0) {
    return { visible: false, thumbTop: 0, thumbHeight: 0, contentHeight: capacity }
  }
  const offset = Math.min(Math.max(0, Math.floor(requestedOffset)), maximumOffset)
  const thumbHeight = Math.min(capacity, Math.max(1, Math.round(capacity * capacity / Math.max(1, Math.floor(lineCount)))))
  const progress = 1 - offset / maximumOffset
  const thumbTop = Math.round(progress * (capacity - thumbHeight))
  return { visible: true, thumbTop, thumbHeight, contentHeight: capacity }
}

/**
 * Map one terminal row of the scrollbar column to the scroll offset whose
 * thumb position lands there: the top row jumps to the OLDEST lines (maximum
 * offset) and the bottom row to the newest (offset 0). Rows outside the
 * column clamp to its ends.
 * @param oneBasedRow - the clicked terminal row.
 * @param topRow - the 1-based first row of the scrollbar column.
 * @param contentHeight - the column's travel rows.
 * @param maximumOffset - the current maximum scroll offset.
 * @returns the target scroll offset.
 */
export function scrollOffsetForScrollbarRow(
  oneBasedRow: number,
  topRow: number,
  contentHeight: number,
  maximumOffset: number,
): number {
  const height = Math.max(1, Math.floor(contentHeight))
  const top = Math.floor(topRow)
  const bottom = top + height - 1
  const clamped = Math.max(top, Math.min(Math.floor(oneBasedRow), bottom))
  const fraction = height <= 1 ? 1 : (clamped - top) / (height - 1)
  return Math.round((1 - fraction) * Math.max(0, Math.floor(maximumOffset)))
}

/** The previous code-point boundary at or before an offset. */
export function previousCodePointBoundary(value: string, offset: number): number {
  if (offset <= 0) return 0
  const previous = value.charCodeAt(offset - 1)
  if (previous >= 0xdc00 && previous <= 0xdfff && offset >= 2) {
    const lead = value.charCodeAt(offset - 2)
    if (lead >= 0xd800 && lead <= 0xdbff) return offset - 2
  }
  return offset - 1
}

/** The next code-point boundary at or after an offset. */
export function nextCodePointBoundary(value: string, offset: number): number {
  if (offset >= value.length) return value.length
  const lead = value.charCodeAt(offset)
  if (lead >= 0xd800 && lead <= 0xdbff && offset + 1 < value.length) {
    const trail = value.charCodeAt(offset + 1)
    if (trail >= 0xdc00 && trail <= 0xdfff) return offset + 2
  }
  return offset + 1
}

/** The longest prefix of `value` fitting in `width` display cells. */
function takeDisplayPrefix(value: string, width: number): string {
  let result = ''
  let used = 0
  for (const character of value) {
    const next = Math.max(1, stringWidth(character))
    if (used + next > width) break
    result += character
    used += next
  }
  return result
}

/** The longest suffix of `value` fitting in `width` display cells. */
function takeDisplaySuffix(value: string, width: number): string {
  let result = ''
  let used = 0
  const characters = [...value]
  for (let index = characters.length - 1; index >= 0; index -= 1) {
    const character = characters[index] ?? ''
    const next = Math.max(1, stringWidth(character))
    if (used + next > width) break
    result = `${character}${result}`
    used += next
  }
  return result
}
