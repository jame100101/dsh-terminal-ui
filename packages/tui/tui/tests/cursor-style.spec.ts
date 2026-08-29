import { describe, expect, it } from 'vitest'
import { BUSY_CURSOR_STYLE, RESTORE_CURSOR_STYLE, cursorStyleForBusy } from '../src/cursor-style'

describe('cursor style', () => {
  it('uses a steady bar while busy and restores the terminal default when idle', () => {
    expect(cursorStyleForBusy(true)).toBe(BUSY_CURSOR_STYLE)
    expect(cursorStyleForBusy(false)).toBe(RESTORE_CURSOR_STYLE)
    expect(BUSY_CURSOR_STYLE).toBe('\x1b[6 q')
    expect(RESTORE_CURSOR_STYLE).toBe('\x1b[0 q')
  })
})
