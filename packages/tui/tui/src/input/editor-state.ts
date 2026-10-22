/** UI-owned composer state; host attachment objects stay owned by Harness. */
export interface EditorState {
  text: string
  caret: number
  selection: { anchor: number; head: number } | null
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** Iterate user-perceived characters with their UTF-16 source offsets. */
export function graphemes(value: string): Intl.Segments {
  return segmenter.segment(value)
}

/** Step left without separating combining marks, surrogate pairs or ZWJ emoji. */
export function previousGraphemeBoundary(value: string, offset: number): number {
  const bounded = Math.max(0, Math.min(offset, value.length))
  return bounded === 0 ? 0 : (segmenter.segment(value).containing(bounded - 1)?.index ?? 0)
}

/** Step right using the same boundaries as wrapping, hit testing and deletion. */
export function nextGraphemeBoundary(value: string, offset: number): number {
  const bounded = Math.max(0, Math.min(offset, value.length))
  const part = segmenter.segment(value).containing(bounded)
  return part === undefined ? value.length : part.index + part.segment.length
}
