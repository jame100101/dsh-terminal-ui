import { describe, expect, it } from 'vitest'
import { BUSY_CURSOR_STYLE, RESTORE_CURSOR_STYLE, cursorStyleForBusy } from '../src/cursor-style'

describe('cursor style', () => {
  it('keeps the Claude composer cursor stable across activity transitions', () => {
    expect(cursorStyleForBusy(false, true)).toBe('\x1b[2 q')
    expect(cursorStyleForBusy(true, true)).toBe('\x1b[2 q')
  })
  it('uses a steady block while busy and restores the terminal default when idle', () => {
    expect(cursorStyleForBusy(true)).toBe(BUSY_CURSOR_STYLE)
    expect(cursorStyleForBusy(false)).toBe(RESTORE_CURSOR_STYLE)
    expect(BUSY_CURSOR_STYLE).toBe('\x1b[2 q')
    expect(RESTORE_CURSOR_STYLE).toBe('\x1b[0 q')
  })
})
