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

/** Incremental bookkeeping for the single visible live-Thinking body row. */
export interface LiveThinkingTailState {
  /** Cell-bounded tail, with a leading ellipsis when older text is hidden. */
  tail: string
  /** Bounded display suffix without the synthetic leading ellipsis. */
  sourceTail: string
  /** Bounded raw-source suffix used to distinguish append from replacement. */
  matchTail: string
  /** Number of source code units already consumed. */
  offset: number
  /** The consumed source ended in CR, so an appended LF completes the same break. */
  endedWithCarriageReturn: boolean
  width: number
}

const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/**
 * Keep the end of one line within a display-cell budget without splitting a grapheme.
 * The retained queue stays bounded to the visible suffix while a large source is scanned.
 * @param value - one logical source line.
 * @param width - terminal-cell budget.
 * @returns the full line when it fits, otherwise an ellipsis plus its visible tail.
 */
function fitDisplayTail(value: string, width: number): { tail: string; sourceTail: string } {
  const budget = Math.max(0, Math.floor(width))
  if (budget === 0 || value === '') return { tail: '', sourceTail: '' }
  const suffixBudget = Math.max(0, budget - 1)
  let totalWidth = 0
  let suffixWidth = 0
  let head = 0
  let suffix: { text: string; width: number }[] = []
  for (const { segment } of GRAPHEME_SEGMENTER.segment(value)) {
    const segmentWidth = stringWidth(segment)
    totalWidth += segmentWidth
    suffix.push({ text: segment, width: segmentWidth })
    suffixWidth += segmentWidth
    while (suffixWidth > suffixBudget && head < suffix.length) {
      suffixWidth -= suffix[head]?.width ?? 0
      head += 1
    }
    if (head >= 256) {
      suffix = suffix.slice(head)
      head = 0
    }
  }
  if (totalWidth <= budget) return { tail: value, sourceTail: value }
  const sourceTail = suffix.slice(head).map(entry => entry.text).join('')
  return { tail: `…${sourceTail}`, sourceTail }
}

/** Render source line breaks as one compact separator inside the live tail row. */
function visibleThinkingText(value: string): string {
  return value.replaceAll('\r\n', ' ↵ ').replaceAll(/[\r\n]/gu, ' ↵ ')
}

/**
 * Project only the visible tail of a growing Thinking stream. Appends inspect
 * the new delta plus the previously bounded tail. Line breaks remain visible
 * as compact separators instead of temporarily clearing the body row.
 * @param previous - prior incremental state, or null for a new stream.
 * @param text - full accumulated reasoning text.
 * @param width - terminal-cell budget after the `  │ ` prefix.
 * @returns the next bounded tail state.
 */
export function projectLiveThinkingTail(
  previous: LiveThinkingTailState | null,
  text: string,
  width: number,
): LiveThinkingTailState {
  const budget = Math.max(0, Math.floor(width))
  const previousMatches = previous !== null
    && previous.width === budget
    && text.length >= previous.offset
    && text.slice(Math.max(0, previous.offset - previous.matchTail.length), previous.offset) === previous.matchTail
  if (previousMatches && text.length === previous.offset) return previous
  let source: string
  if (!previousMatches) {
    source = visibleThinkingText(text)
  } else {
    let delta = text.slice(previous.offset)
    if (previous.endedWithCarriageReturn && delta.startsWith('\n')) delta = delta.slice(1)
    source = `${previous.sourceTail}${visibleThinkingText(delta)}`
  }
  const fitted = fitDisplayTail(source, budget)
  return {
    ...fitted,
    matchTail: text.slice(-64),
    offset: text.length,
    endedWithCarriageReturn: text.endsWith('\r'),
    width: budget,
  }
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
