import { describe, expect, it } from 'vitest'
import { captureTranscriptAnchor, resolveTranscriptAnchor, type AnchorBlock } from '../src/transcript-anchor'
const block = (key: string, texts: string[]): AnchorBlock => ({ key, count: texts.length,
  lines: () => texts.map((text, i) => ({ key: `${key}-${i}`, text })) })
describe('transcript content anchor', () => {
  it('keeps content when earlier blocks grow or collapse, and when the tail appends', () => {
    const a = block('a', ['header'])
    const b = block('b', ['one', 'two', 'three'])
    const anchor = captureTranscriptAnchor([a, b], 2)!
    expect(resolveTranscriptAnchor([block('a', Array(20).fill('detail')), b], anchor)).toBe(21)
    expect(resolveTranscriptAnchor([a, b, block('tail', Array(50).fill('stream'))], anchor)).toBe(2)
    expect(resolveTranscriptAnchor([block('a', []), b], anchor)).toBe(1)
  })
  it('keeps the projected source position when width changes the row boundaries', () => {
    const anchor = captureTranscriptAnchor([block('a', ['abcdefghij', 'klmnopqrst'])], 1)!
    expect(anchor.sourceOffset).toBe(10)
    expect(resolveTranscriptAnchor([block('a', ['abcde', 'fghij', 'klmno', 'pqrst'])], anchor)).toBe(2)
  })
  it('ignores padding and resolves repeated rows by source position', () => {
    const anchor = captureTranscriptAnchor([block('a', ['same   ', 'same   ', 'end'])], 1)!
    expect(anchor.sourceOffset).toBe(4)
    expect(resolveTranscriptAnchor([block('a', ['same', 'same', 'end'])], anchor)).toBe(1)
  })
  it('falls back to the header on collapse and a neighbor when the node disappears', () => {
    const before = [block('a', ['first']), block('b', ['header', 'detail']), block('c', ['next'])]
    const anchor = captureTranscriptAnchor(before, 2)!
    expect(resolveTranscriptAnchor([before[0]!, block('b', ['header']), before[2]!], anchor)).toBe(1)
    expect(resolveTranscriptAnchor([before[0]!, before[2]!], anchor)).toBe(1)
    expect(resolveTranscriptAnchor([], anchor)).toBeNull()
  })
  it('materializes only the selected block and leaves live-tail capture to the caller', () => {
    let calls = 0
    const hidden = { key: 'hidden', count: 100_000, lines: () => { calls++; return [] } }
    const blocks = [hidden, block('visible', ['one', 'two'])]
    const anchor = captureTranscriptAnchor(blocks, 100_001)!
    expect(resolveTranscriptAnchor(blocks, anchor)).toBe(100_001)
    expect(calls).toBe(0)
    expect(captureTranscriptAnchor(blocks, 100_010)).toBeNull()
  })
})
