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
  return { visibleLines, caretLine: caretLineIndex - start, caretColumn }
}

/** Hard-wrap one composer value by cells, keeping empty lines (multi-line input). */
function wrapComposerText(value: string, width: number): string[] {
  const lines: string[] = []
  for (const source of value.split('\n')) {
    if (source === '') {
      lines.push('')
      continue
    }
    let current = ''
    let currentWidth = 0
    for (const character of source) {
      const characterWidth = Math.max(1, stringWidth(character))
      if (currentWidth + characterWidth > width) {
        lines.push(current)
        current = ''
        currentWidth = 0
      }
      current += character
      currentWidth += characterWidth
    }
    lines.push(current)
  }
  return lines
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
