/** Display-only highlights; never changes official source lines or hunk coordinates. */
import { diffWordsWithSpace } from 'diff'
export interface WordSpan { start: number; end: number }
export function wordDiffSpans(before: string, after: string): { before: WordSpan[]; after: WordSpan[] } | null {
  if (before.length + after.length > 16_000) return null
  const changes = diffWordsWithSpace(before, after, { ignoreCase: false, maxEditLength: 512 })
  if (!changes) return null
  const changed = changes.reduce((sum, part) => sum + (part.added || part.removed ? part.value.length : 0), 0)
  if (!changed || changed / Math.max(1, before.length + after.length) > 0.4) return null
  const spans = { before: [] as WordSpan[], after: [] as WordSpan[] }
  let oldOffset = 0, newOffset = 0
  for (const part of changes) {
    if (part.removed) spans.before.push({ start: oldOffset, end: oldOffset + part.value.length })
    if (part.added) spans.after.push({ start: newOffset, end: newOffset + part.value.length })
    if (!part.added) oldOffset += part.value.length
    if (!part.removed) newOffset += part.value.length
  }
  // jsdiff token boundaries need not be grapheme boundaries (e.g. emoji modifiers).
  const expand = (text: string, ranges: WordSpan[]): WordSpan[] => {
    const result: WordSpan[] = []
    for (const { segment, index } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
      if (!ranges.some(range => range.start < index + segment.length && range.end > index)) continue
      const previous = result.at(-1)
      if (previous?.end === index) previous.end += segment.length
      else result.push({ start: index, end: index + segment.length })
    }
    return result
  }
  return { before: expand(before, spans.before), after: expand(after, spans.after) }
}
