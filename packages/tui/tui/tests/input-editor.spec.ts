import { describe, expect, it } from 'vitest'
import { nextGraphemeBoundary, previousGraphemeBoundary } from '../src/input/editor-state'
import { composerGlyphAt, composerOffsetAt, composerOffsetForVerticalMove, wrapComposerRanges } from '../src/viewport'

describe('composer grapheme coordinates', () => {
  it.each(['e\u0301', '👍🏽', '👨‍👩‍👧‍👦', '🇨🇳', '中'])('moves and deletes %s as one editing unit', (glyph) => {
    const text = `a${glyph}z`
    expect(nextGraphemeBoundary(text, 1)).toBe(1 + glyph.length)
    expect(previousGraphemeBoundary(text, 1 + glyph.length)).toBe(1)
    expect(text.slice(0, 1) + text.slice(nextGraphemeBoundary(text, 1))).toBe('az')
    expect(previousGraphemeBoundary(text, 0)).toBe(0)
    expect(nextGraphemeBoundary(text, text.length)).toBe(text.length)
  })

  it('wraps and mouse-selects whole graphemes using cell width', () => {
    const text = 'e\u0301👨‍👩‍👧‍👦中'
    expect(wrapComposerRanges(text, 3).map(row => row.text)).toEqual(['e\u0301👨‍👩‍👧‍👦', '中'])
    expect(composerOffsetAt(text, 3, 0, 2)).toBe(2)
    expect(composerGlyphAt(text, 3, 0, 2)).toEqual({ start: 2, end: text.length - 1 })
    expect(composerOffsetForVerticalMove(text, 3, text.length, -1)).toBe(2)
  })
})
