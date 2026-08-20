/**
 * Terminal cell wrapping and incremental live-assistant wrap. Streaming
 * chunks append to the unfinished last row instead of re-wrapping the whole
 * live buffer on every token.
 * @module @deepseek-ai/dsh-tui/src/wrap
 */

import stringWidth from 'string-width'

/** Live-assistant prefix matching the settled `● ` marker. */
export const LIVE_ASSISTANT_PREFIX = '● '
/** Trailing cursor shown on the unfinished live row. */
export const LIVE_ASSISTANT_CURSOR = '▌'

/**
 * Hard-wrap one source string by terminal cell width. Empty source lines
 * become empty wrapped rows so paragraph breaks survive.
 * @param text - the source, which may contain newlines.
 * @param width - wrap budget in terminal cells.
 * @returns wrapped rows in source order.
 */
export function wrapDisplayLines(text: string, width: number): string[] {
  const lines: string[] = []
  for (const source of text.split('\n')) {
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
 * Pad a display row with spaces to `width` cells so an Ink background
 * fill covers the whole prompt block, not only the glyphs.
 * @param text - the already-wrapped row.
 * @param width - target cell width.
 * @returns the padded row.
 */
export function padEndDisplay(text: string, width: number): string {
  const budget = Math.max(0, Math.floor(width))
  const used = stringWidth(text)
  if (used >= budget) return text
  return `${text}${' '.repeat(budget - used)}`
}

/** Incremental wrap bookkeeping for one live assistant stream. */
export interface LiveWrapState {
  lines: readonly string[]
  /** Number of `text` code units already wrapped. */
  offset: number
  width: number
}

/**
 * Wrap live assistant text, reusing completed rows from the previous call
 * when the width is unchanged and the source only grew.
 * @param previous - the last wrap, or null on a new live buffer.
 * @param text - the full live assistant text (no prefix or cursor).
 * @param width - wrap budget in terminal cells.
 * @returns wrapped rows including the prefix and trailing cursor.
 */
export function wrapLiveAssistantText(
  previous: LiveWrapState | null,
  text: string,
  width: number,
): LiveWrapState {
  if (previous === null || previous.width !== width || text.length < previous.offset) {
    return {
      lines: wrapDisplayLines(`${LIVE_ASSISTANT_PREFIX}${text}${LIVE_ASSISTANT_CURSOR}`, width),
      offset: text.length,
      width,
    }
  }
  if (text.length === previous.offset) return previous
  const delta = text.slice(previous.offset)
  if (previous.lines.length === 0) {
    return {
      lines: wrapDisplayLines(`${LIVE_ASSISTANT_PREFIX}${delta}${LIVE_ASSISTANT_CURSOR}`, width),
      offset: text.length,
      width,
    }
  }
  const existing = previous.lines.slice(0, -1)
  let last = previous.lines[previous.lines.length - 1] as string
  if (last.endsWith(LIVE_ASSISTANT_CURSOR)) last = last.slice(0, -LIVE_ASSISTANT_CURSOR.length)
  return {
    lines: [...existing, ...wrapDisplayLines(`${last}${delta}${LIVE_ASSISTANT_CURSOR}`, width)],
    offset: text.length,
    width,
  }
}
