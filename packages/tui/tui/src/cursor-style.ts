/**
 * Terminal cursor-style control used by the interactive composer.
 * @module @deepseek-ai/dsh-tui/src/cursor-style
 */

/** Restore the terminal profile's cursor shape and blink preference. */
export const RESTORE_CURSOR_STYLE = '\x1b[0 q'

/** Use a steady bar while an agent turn is active so IME input does not blink. */
export const BUSY_CURSOR_STYLE = '\x1b[6 q'

/**
 * Select the cursor-style sequence for one activity state.
 * @param busy - Whether the current session is running a turn.
 * @returns DECSCUSR for a steady busy bar or the terminal default.
 */
export function cursorStyleForBusy(busy: boolean): string {
  return busy ? BUSY_CURSOR_STYLE : RESTORE_CURSOR_STYLE
}
