/**
 * In-app transcript drag-select: map terminal cells onto already-wrapped
 * rows and extract clipboard text. Mouse tracking stays on (wheel and the
 * scrollbar still belong to the TUI); this is the default copy path, not a
 * separate mode.
 * @module @deepseek-ai/dsh-tui/src/selection
 */

import stringWidth from 'string-width'
import { lineSelectableWidth, type TranscriptLine } from './viewport'

/** One cell inside the already-windowed transcript lines. */
export interface TranscriptCell {
  /** Index into the windowed `lines` array. */
  lineIndex: number
  /** 0-based display column inside that line. */
  column: number
  line: TranscriptLine
}

/** A drag-select range in absolute transcript line indices and display columns. */
export interface TextSelection {
  anchor: { lineIndex: number; column: number }
  head: { lineIndex: number; column: number }
}

/** One glyph under the pointer, as an inclusive start and exclusive end column. */
export interface GlyphAnchor {
  lineIndex: number
  start: number
  end: number
}

/**
 * Display-column span of the glyph that owns `column`. Trailing pad is not a
 * glyph: a click past the last character returns an empty span at the
 * selectable end so a drag can still reach the line end.
 * @param text - one painted row.
 * @param column - 0-based display column.
 * @returns inclusive start and exclusive end display columns.
 */
export function glyphSpanAt(text: string, column: number): { start: number; end: number } {
  const selectable = lineSelectableWidth(text)
  if (selectable <= 0) return { start: 0, end: 0 }
  const target = Math.max(0, Math.floor(column))
  if (target >= selectable) return { start: selectable, end: selectable }
  let col = 0
  for (const character of text) {
    const width = Math.max(1, stringWidth(character))
    const next = col + width
    if (col >= selectable) break
    if (target < next) return { start: col, end: Math.min(selectable, next) }
    col = next
  }
  return { start: selectable, end: selectable }
}

/**
 * Build an ordered selection that includes both the press glyph and the
 * glyph under the pointer, whether the drag runs forward or backward.
 * @param press - glyph at mouse-down.
 * @param head - glyph under the pointer.
 * @returns an ordered range whose exclusive end is the last glyph's end.
 */
export function selectionFromGlyphs(press: GlyphAnchor, head: GlyphAnchor): TextSelection {
  if (press.lineIndex === head.lineIndex && press.start === head.start && press.end === head.end) {
    return {
      anchor: { lineIndex: press.lineIndex, column: press.start },
      head: { lineIndex: press.lineIndex, column: press.start },
    }
  }
  const pressFirst = press.lineIndex < head.lineIndex
    || (press.lineIndex === head.lineIndex && press.start <= head.start)
  const start = pressFirst ? press : head
  const end = pressFirst ? head : press
  return {
    anchor: { lineIndex: start.lineIndex, column: start.start },
    head: { lineIndex: end.lineIndex, column: end.end },
  }
}

/**
 * Slice `text` by terminal display columns (`string-width`), so CJK and
 * emoji stay on character boundaries. A 2-cell glyph that overlaps `[start, end)`
 * is included, so a clipboard range that starts mid-glyph still copies it.
 * @param text - one painted row.
 * @param startCol - 0-based display column, inclusive.
 * @param endCol - 0-based display column, exclusive.
 * @returns the characters covering that span.
 */
export function sliceDisplayRange(text: string, startCol: number, endCol: number): string {
  const start = Math.max(0, startCol)
  const end = Math.max(start, endCol)
  let column = 0
  let out = ''
  for (const character of text) {
    const width = Math.max(1, stringWidth(character))
    const next = column + width
    if (next > start && column < end) out += character
    column = next
    if (column >= end) break
  }
  return out
}

/**
 * Partition `text` by display columns without overlap. A glyph belongs to the
 * segment that contains its start column, so adjacent before/mid/after slices
 * concatenate to the original row and keep the same display width.
 * @param text - one painted row.
 * @param startCol - 0-based display column, inclusive.
 * @param endCol - 0-based display column, exclusive.
 * @returns the characters whose start column lies in `[startCol, endCol)`.
 */
export function sliceDisplaySegment(text: string, startCol: number, endCol: number): string {
  const start = Math.max(0, startCol)
  const end = Math.max(start, endCol)
  let column = 0
  let out = ''
  for (const character of text) {
    const width = Math.max(1, stringWidth(character))
    if (column >= end) break
    if (column >= start) out += character
    column += width
  }
  return out
}

/**
 * Split one painted row into unselected prefix, overlapping mid-span, and
 * unselected suffix. A 2-cell glyph that straddles `startCol` goes entirely
 * into `mid` so a backward drag does not drop the first selected character.
 * @param text - one painted row.
 * @param startCol - 0-based display column, inclusive.
 * @param endCol - 0-based display column, exclusive.
 * @returns unselected prefix, overlapping highlight, and unselected suffix.
 */
export function sliceDisplayParts(
  text: string,
  startCol: number,
  endCol: number,
): { before: string; mid: string; after: string } {
  const start = Math.max(0, startCol)
  const end = Math.max(start, endCol)
  let column = 0
  let before = ''
  let mid = ''
  let after = ''
  for (const character of text) {
    const width = Math.max(1, stringWidth(character))
    const next = column + width
    if (next <= start) before += character
    else if (column >= end) after += character
    else mid += character
    column = next
  }
  return { before, mid, after }
}

/** Ordered start/end of one selection. */
export function orderedSelection(selection: TextSelection): {
  start: { lineIndex: number; column: number }
  end: { lineIndex: number; column: number }
} {
  const { anchor, head } = selection
  if (anchor.lineIndex < head.lineIndex
    || (anchor.lineIndex === head.lineIndex && anchor.column <= head.column)) {
    return { start: anchor, end: head }
  }
  return { start: head, end: anchor }
}

/** True when the range covers at least one display cell. */
export function selectionMoved(selection: TextSelection): boolean {
  const { start, end } = orderedSelection(selection)
  return start.lineIndex !== end.lineIndex || start.column !== end.column
}

/**
 * True when the range is a drag, not a click. A one-row, one-column move is
 * click jitter at a row boundary and must not highlight a block.
 * @param selection - the current range.
 */
export function selectionIsDrag(selection: TextSelection): boolean {
  const { start, end } = orderedSelection(selection)
  const lineDelta = Math.abs(end.lineIndex - start.lineIndex)
  const columnDelta = Math.abs(end.column - start.column)
  if (lineDelta === 0) return columnDelta > 0
  return Math.max(lineDelta, columnDelta) >= 2
}

/**
 * Display-column span of `lineIndex` inside `selection`, or null when the
 * line is outside the range.
 * @param selection - the current range.
 * @param lineIndex - absolute transcript line index.
 * @param lineWidth - display width of that line.
 */
export function selectionSpanOnLine(
  selection: TextSelection,
  lineIndex: number,
  lineWidth: number,
): { start: number; end: number } | null {
  const { start, end } = orderedSelection(selection)
  if (lineIndex < start.lineIndex || lineIndex > end.lineIndex) return null
  const spanStart = lineIndex === start.lineIndex ? start.column : 0
  const spanEnd = lineIndex === end.lineIndex ? end.column : lineWidth
  if (spanEnd <= spanStart) return null
  return { start: spanStart, end: spanEnd }
}

/** Drop trailing pad spaces and a leading user/assistant/think chrome prefix. */
function stripLineChrome(text: string, fromLineStart: boolean): string {
  const trimmed = text.replace(/\s+$/u, '')
  if (!fromLineStart) return trimmed
  if (trimmed.startsWith('▸ ')) return trimmed.slice(2)
  if (trimmed.startsWith('● ')) return trimmed.slice(2)
  if (trimmed.startsWith('  │ ')) return trimmed.slice(4)
  return trimmed
}

/** Dense transcript rows, or a sparse map of absolute indices collected during a drag. */
export type TranscriptLineLookup = readonly TranscriptLine[] | ReadonlyMap<number, TranscriptLine>

function transcriptLineAt(source: TranscriptLineLookup, index: number): TranscriptLine | undefined {
  if (Array.isArray(source)) return (source as readonly TranscriptLine[])[index]
  return (source as ReadonlyMap<number, TranscriptLine>).get(index)
}

/**
 * Clipboard text for a drag range over painted rows. Chrome prefixes (`▸ `,
 * `● `, think bars) drop only when the range includes the start of the line.
 * @param lines - absolute transcript rows, dense or sparse.
 * @param selection - the drag range.
 * @returns the joined text, or '' when the range is empty.
 */
export function extractSelectedText(
  lines: TranscriptLineLookup,
  selection: TextSelection,
): string {
  const { start, end } = orderedSelection(selection)
  const rows: string[] = []
  for (let index = start.lineIndex; index <= end.lineIndex; index += 1) {
    const line = transcriptLineAt(lines, index)
    if (line === undefined) continue
    const width = lineSelectableWidth(line.text)
    if (width <= 0) continue
    const spanStart = index === start.lineIndex ? start.column : 0
    const spanEnd = index === end.lineIndex ? end.column : width
    const sliced = sliceDisplayRange(line.text, spanStart, spanEnd)
    rows.push(stripLineChrome(sliced, spanStart <= 0))
  }
  while (rows.length > 0 && rows[rows.length - 1] === '') rows.pop()
  return rows.join('\n')
}
