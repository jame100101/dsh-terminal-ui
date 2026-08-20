/**
 * In-app transcript drag-select: map terminal cells onto already-wrapped
 * rows and extract clipboard text. Mouse tracking stays on (wheel and the
 * scrollbar still belong to the TUI); this is the default copy path, not a
 * separate mode.
 * @module @deepseek-ai/dsh-tui/src/selection
 */

import stringWidth from 'string-width'
import type { TranscriptLine } from './viewport'

/** One cell inside the already-windowed transcript lines. */
export interface TranscriptCell {
  /** Index into the windowed `lines` array. */
  lineIndex: number
  /** 0-based display column inside that line. */
  column: number
  line: TranscriptLine
}

/** A drag-select range in windowed line indices and display columns. */
export interface TextSelection {
  anchor: { lineIndex: number; column: number }
  head: { lineIndex: number; column: number }
}

/**
 * Slice `text` by terminal display columns (`string-width`), so CJK and
 * emoji stay on character boundaries. A 2-cell glyph that straddles `start`
 * is included.
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
 * Display-column span of `lineIndex` inside `selection`, or null when the
 * line is outside the range.
 * @param selection - the current range.
 * @param lineIndex - windowed line index.
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

/**
 * Clipboard text for a drag range over painted rows. Chrome prefixes (`▸ `,
 * `● `, think bars) drop only when the range includes the start of the line.
 * @param lines - windowed transcript rows.
 * @param selection - the drag range.
 * @returns the joined text, or '' when the range is empty.
 */
export function extractSelectedText(
  lines: readonly TranscriptLine[],
  selection: TextSelection,
): string {
  const { start, end } = orderedSelection(selection)
  const rows: string[] = []
  for (let index = start.lineIndex; index <= end.lineIndex; index += 1) {
    const line = lines[index]
    if (line === undefined) continue
    const width = stringWidth(line.text)
    const spanStart = index === start.lineIndex ? start.column : 0
    const spanEnd = index === end.lineIndex ? end.column : width
    const sliced = sliceDisplayRange(line.text, spanStart, spanEnd)
    rows.push(stripLineChrome(sliced, spanStart <= 0))
  }
  while (rows.length > 0 && rows[rows.length - 1] === '') rows.pop()
  return rows.join('\n')
}
