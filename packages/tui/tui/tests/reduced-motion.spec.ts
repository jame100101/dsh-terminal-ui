import { expect, it } from 'vitest'
import { terminalReducedMotion } from '../src/busy-star'
it('honors explicit reduced motion and dumb terminals without conflating color with motion', () => {
  expect(terminalReducedMotion({ DSH_TUI_REDUCED_MOTION: '1' })).toBe(true)
  expect(terminalReducedMotion({ TERM: 'dumb' })).toBe(true)
  expect(terminalReducedMotion({ TERM: 'xterm-256color', NO_COLOR: '1' })).toBe(false)
  expect(terminalReducedMotion({ DSH_TUI_REDUCED_MOTION: '0' })).toBe(false)
})
