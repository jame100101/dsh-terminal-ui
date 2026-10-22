import { describe, it, expect } from 'vitest'
import { DraftUndo, atomicRange, wordLeft, wordRight, logicalLineStart, logicalLineEnd, killFragment, yankFragment } from '../src/input/draft-editing'
import type { DraftSnapshot } from '../src/input/draft-editing'
import { createPastedTextBlock } from '../src/pasted-text'
const draft = (text: string, resources: string[] = []): DraftSnapshot => ({ editor: { text, caret: text.length, selection: null }, sessionId: 's', resources, pasted: [] })
describe('complete draft editing', () => {
  it('moves by Unicode words and whole resource capsules', () => {
    expect(wordLeft('alpha 中文 👩🏽‍💻', 'alpha 中文 👩🏽‍💻'.length)).toBe('alpha 中文 '.length)
    expect(wordRight('one two', 0)).toBe(3)
    expect(wordLeft('one [Image #1]', 14)).toBe(4)
    expect(wordRight('one [Image #1]', 4)).toBe(14)
    expect(atomicRange('x [Image #1] y', 5, 8)).toEqual({ start: 2, end: 12 })
    expect(logicalLineStart('\nabc', 0)).toBe(0)
    expect(logicalLineStart('a\nbc', 3)).toBe(2)
    expect(logicalLineEnd('a\nbc', 0)).toBe(1)
  })
  it('restores exact caret, selection, image and paste state and does not consume failures', () => {
    const undo = new DraftUndo(), before = draft('[Image #1] paste', ['a']), after = draft('changed')
    before.editor.selection = { anchor: 0, head: 10 }; before.editor.caret = 4
    before.pasted = [createPastedTextBlock('large text', 1)]
    undo.record(before)
    expect(() => undo.restore('undo', after, () => { throw new Error('missing image') })).toThrow()
    let restored: DraftSnapshot | undefined
    expect(undo.restore('undo', after, value => { restored = value })).toBe(true)
    expect(restored).toEqual(before)
    expect(undo.restore('redo', before, value => { restored = value })).toBe(true)
    expect(restored).toEqual(after)
    expect(undo.restore('undo', { ...after, sessionId: 'other' }, () => {})).toBe(false)
  })
  it('replaces selected image refs and allocates distinct paste tokens on yank', () => {
    const original = draft('[Image #1]', ['old'])
    const fragment = killFragment(original, 0, original.editor.text.length)
    const current = draft('[Image #1]', ['new'])
    current.editor.selection = { anchor: 0, head: current.editor.text.length }
    const replaced = yankFragment(current, fragment)
    expect(replaced.resources).toEqual(['old'])
    expect(replaced.editor.text).toBe('[Image #1]')
    const doubled = yankFragment(original, fragment)
    expect(doubled.resources).toEqual(['old', 'old'])
    expect(doubled.editor.text).toBe('[Image #1][Image #2]')
    const block = createPastedTextBlock('x'.repeat(1200), 1)
    const pasted = { ...draft(block.token), pasted: [block] }
    const twice = yankFragment(pasted, killFragment(pasted, 0, block.token.length))
    expect(twice.pasted.map(entry => entry.token)).toEqual([block.token, createPastedTextBlock(block.text, 2).token])
  })
  it('bounds unique pasted payload retention as well as visible tokens', () => {
    const undo = new DraftUndo()
    for (let index = 0; index < 4; index++) undo.record({ ...draft(`token${index}`), pasted: [createPastedTextBlock(String(index).repeat(600_000), 1)] })
    expect(undo.restore('undo', draft('now'), () => {})).toBe(true)
    expect(undo.restore('undo', draft('now'), () => {})).toBe(false)
  })
})
