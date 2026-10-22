/** UI-only reading anchors. Offsets refer to projected text, never to model/session storage. */
export interface AnchorLine { key: string; text: string }
export interface AnchorBlock {
  key: string
  count: number
  /** Resolve only the anchored block; the rest of a long transcript may remain sparse. */
  lines: () => readonly AnchorLine[]
}
export interface TranscriptAnchor {
  blockKey: string
  blockIndex: number
  previousKey?: string
  nextKey?: string
  lineKey: string
  text: string
  /** UTF-16 offset in concatenated, right-unpadded projected rows. */
  sourceOffset: number
}
const textOf = (line: AnchorLine): string => line.text.trimEnd()
/** Capture the top visible content row, without materializing other blocks. */
export function captureTranscriptAnchor(blocks: readonly AnchorBlock[], top: number): TranscriptAnchor | null {
  let start = 0
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index]!
    if (top >= start && top < start + block.count) {
      const lines = block.lines()
      const row = Math.min(Math.floor(top - start), lines.length - 1)
      const line = lines[row]
      if (line === undefined) return null
      let sourceOffset = 0
      for (let i = 0; i < row; i++) sourceOffset += textOf(lines[i]!).length
      return {
        blockKey: block.key, blockIndex: index, lineKey: line.key, text: textOf(line), sourceOffset,
        ...(blocks[index - 1] ? { previousKey: blocks[index - 1]!.key } : {}),
        ...(blocks[index + 1] ? { nextKey: blocks[index + 1]!.key } : {}),
      }
    }
    start += block.count
  }
  return null
}
/** Resolve the same content after reflow/disclosure; vanished nodes fall to a surviving neighbor. */
export function resolveTranscriptAnchor(blocks: readonly AnchorBlock[], anchor: TranscriptAnchor): number | null {
  if (blocks.length === 0) return null
  let index = blocks.findIndex(block => block.key === anchor.blockKey)
  const sameBlock = index >= 0
  if (!sameBlock) {
    index = blocks.findIndex(block => block.key === anchor.nextKey)
    if (index < 0) index = blocks.findIndex(block => block.key === anchor.previousKey)
    if (index < 0) index = Math.min(anchor.blockIndex, blocks.length - 1)
  }
  let start = 0
  for (let i = 0; i < index; i++) start += blocks[i]!.count
  if (!sameBlock) return start
  const lines = blocks[index]!.lines()
  if (lines.length === 0) return start
  const offsets: number[] = []
  let length = 0
  for (const line of lines) { offsets.push(length); length += textOf(line).length }
  // Repeated rows prefer their stable key, then the nearest projected source position.
  const keyed = lines.findIndex(line => line.key === anchor.lineKey && textOf(line) === anchor.text)
  if (keyed >= 0) return start + keyed
  let match = -1
  let distance = Infinity
  lines.forEach((line, row) => {
    if (anchor.text !== '' && textOf(line) === anchor.text) {
      const candidate = Math.abs(offsets[row]! - anchor.sourceOffset)
      if (candidate < distance) { distance = candidate; match = row }
    }
  })
  if (match >= 0) return start + match
  // Reflow changes row keys/text. Keep the same projected character position.
  // If disclosure removed the body, this naturally clamps to its remaining header.
  let row = 0
  while (row + 1 < lines.length && offsets[row + 1]! <= anchor.sourceOffset) row++
  return start + row
}
