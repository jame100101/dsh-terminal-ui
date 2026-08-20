/**
 * Claude Code-style busy glyph for the status bar: a cycling star, not a
 * static circle and not the Thinking-row braille spinner.
 * @module @deepseek-ai/dsh-tui/src/busy-star
 */

/** Star frames (one terminal cell each). */
export const BUSY_STAR_FRAMES = ['✶', '✸', '✹', '✺', '✹', '✸'] as const

/**
 * Pick the star glyph for one animation frame. Color is a stable named
 * Ink color: the status bar must not pulse hues, only the glyph.
 * @param tick - monotonic frame counter (increments ~100ms while busy).
 * @returns the glyph and a fixed Ink color name.
 */
export function busyStarFrame(tick: number): { glyph: string; color: string } {
  const index = tick < 0 ? 0 : tick
  return {
    glyph: BUSY_STAR_FRAMES[index % BUSY_STAR_FRAMES.length] ?? '✶',
    color: 'yellow',
  }
}
