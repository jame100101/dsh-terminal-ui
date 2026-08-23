import { describe, expect, it } from 'vitest'
import {
  createPastedTextBlock, expandPastedTextBlocks, PASTED_TEXT_COLLAPSE_CHARACTERS, PASTED_TEXT_COLLAPSE_LINES,
  pastedTextCharacterCount, pastedTextDeletionRange, pastedTextLineCount,
  retainPastedTextBlocks, shouldCollapsePastedText,
} from '../src/pasted-text'

describe('large pasted text capsules', () => {
  it('uses Unicode characters for the collapse threshold', () => {
    expect(pastedTextCharacterCount('a😀中')).toBe(3)
    expect(shouldCollapsePastedText('x'.repeat(PASTED_TEXT_COLLAPSE_CHARACTERS - 1))).toBe(false)
    expect(shouldCollapsePastedText('x'.repeat(PASTED_TEXT_COLLAPSE_CHARACTERS))).toBe(true)
    expect(shouldCollapsePastedText(Array.from({ length: PASTED_TEXT_COLLAPSE_LINES - 1 }, () => 'x').join('\n'))).toBe(false)
    expect(shouldCollapsePastedText(Array.from({ length: PASTED_TEXT_COLLAPSE_LINES }, () => 'x').join('\n'))).toBe(true)
  })

  it('formats one compact token with the logical line count', () => {
    expect(pastedTextLineCount('a\r\nb\nc\rd')).toBe(4)
    expect(createPastedTextBlock('one', 1).token).toBe('[Pasted text #1 +1 line]')
    expect(createPastedTextBlock('a\nb\nc', 2).token).toBe('[Pasted text #2 +3 lines]')
    expect(() => createPastedTextBlock('x', 0)).toThrow(RangeError)
  })

  it('expands several retained blocks in owning-draft order', () => {
    const first = createPastedTextBlock('alpha\nbeta', 1)
    const second = createPastedTextBlock('gamma', 2)
    const draft = `before ${first.token} between ${second.token} after`
    expect(expandPastedTextBlocks(draft, [first, second])).toBe('before alpha\nbeta between gamma after')
  })

  it('releases a block when its complete token leaves the draft', () => {
    const first = createPastedTextBlock('alpha', 1)
    const second = createPastedTextBlock('beta', 2)
    expect(retainPastedTextBlocks(`x ${second.token}`, [first, second])).toEqual([second])
    expect(retainPastedTextBlocks('[Pasted text #2 +1 lin]', [second])).toEqual([])
  })

  it('deletes a visible token atomically from either direction', () => {
    const token = createPastedTextBlock('alpha\nbeta', 1).token
    const value = `a ${token} z`
    const start = 2
    const end = start + token.length
    expect(pastedTextDeletionRange(value, end, 'backspace')).toEqual({ start, end })
    expect(pastedTextDeletionRange(value, start, 'delete')).toEqual({ start, end })
    expect(pastedTextDeletionRange(value, 0, 'backspace')).toBeNull()
  })
})
