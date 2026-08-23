/**
 * Composer-owned capsules for large bracketed or clipboard pastes. The draft
 * keeps a short token while this module retains the exact text until submit.
 * @module @deepseek-ai/dsh-tui/src/pasted-text
 */

/** Minimum Unicode character count that collapses one paste into a token. */
export const PASTED_TEXT_COLLAPSE_CHARACTERS = 1_000

/** Minimum logical line count that collapses a multiline paste into a token. */
export const PASTED_TEXT_COLLAPSE_LINES = 20

/** One large paste retained outside the visible composer draft. */
export interface PastedTextBlock {
  /** Draft token shown in place of the retained text. */
  readonly token: string
  /** Exact sanitized text inserted when the user submits. */
  readonly text: string
}

const PASTED_TEXT_TOKEN_RE = /\[Pasted text #\d+ \+\d+ lines?\]/gu

/**
 * Count Unicode characters rather than UTF-16 code units.
 * @param text - sanitized pasted text.
 * @returns the number of Unicode characters.
 */
export function pastedTextCharacterCount(text: string): number {
  return Array.from(text).length
}

/**
 * Count logical lines in pasted text, accepting LF, CRLF, and bare CR input.
 * @param text - sanitized pasted text.
 * @returns at least one line.
 */
export function pastedTextLineCount(text: string): number {
  return text === '' ? 1 : text.split(/\r\n|\r|\n/u).length
}

/**
 * Decide whether a paste should be retained behind a compact draft token.
 * @param text - sanitized pasted text.
 * @returns true at the presentation threshold.
 */
export function shouldCollapsePastedText(text: string): boolean {
  return pastedTextCharacterCount(text) >= PASTED_TEXT_COLLAPSE_CHARACTERS
    || pastedTextLineCount(text) >= PASTED_TEXT_COLLAPSE_LINES
}

/**
 * Create the visible token and retained text for one large paste.
 * @param text - exact sanitized paste.
 * @param ordinal - one-based ordinal within the current composer draft.
 * @returns the retained paste block.
 */
export function createPastedTextBlock(text: string, ordinal: number): PastedTextBlock {
  if (!Number.isSafeInteger(ordinal) || ordinal < 1) throw new RangeError('pasted-text ordinal must be a positive integer')
  const lines = pastedTextLineCount(text)
  return {
    token: `[Pasted text #${ordinal} +${lines} ${lines === 1 ? 'line' : 'lines'}]`,
    text,
  }
}

/**
 * Expand retained paste tokens before command dispatch or model submission.
 * @param draft - visible composer draft.
 * @param blocks - retained paste blocks owned by the draft.
 * @returns the full input text.
 */
export function expandPastedTextBlocks(draft: string, blocks: readonly PastedTextBlock[]): string {
  let expanded = draft
  for (const block of blocks) expanded = expanded.replace(block.token, block.text)
  return expanded
}

/**
 * Drop retained text after its complete token leaves the draft.
 * @param draft - next visible composer draft.
 * @param blocks - retained paste blocks from the previous draft.
 * @returns blocks whose tokens remain intact.
 */
export function retainPastedTextBlocks(draft: string, blocks: readonly PastedTextBlock[]): readonly PastedTextBlock[] {
  return blocks.filter(block => draft.includes(block.token))
}

/**
 * Treat a compact paste token as one deletion unit.
 * @param value - visible composer draft.
 * @param cursorOffset - caret offset in UTF-16 code units.
 * @param direction - deletion direction.
 * @returns the token range to delete, or null for ordinary text deletion.
 */
export function pastedTextDeletionRange(
  value: string,
  cursorOffset: number,
  direction: 'backspace' | 'delete',
): { start: number; end: number } | null {
  for (const match of value.matchAll(PASTED_TEXT_TOKEN_RE)) {
    const start = match.index
    const end = start + match[0].length
    if (direction === 'backspace' && cursorOffset > start && cursorOffset <= end) return { start, end }
    if (direction === 'delete' && cursorOffset >= start && cursorOffset < end) return { start, end }
  }
  return null
}
