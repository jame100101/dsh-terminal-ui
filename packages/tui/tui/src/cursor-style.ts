/**
 * Terminal cursor-style control used by the interactive composer.
 * @module @deepseek-ai/dsh-tui/src/cursor-style
 */

/** Release the application cursor override using DECSCUSR default (0). */
export const RESTORE_CURSOR_STYLE = '\x1b[0 q'

/** Use a steady block instead of a terminal-specific capped bar cursor. */
export const BUSY_CURSOR_STYLE = '\x1b[2 q'

/**
 * Select the cursor-style sequence for one activity state.
 * @param busy - Whether the current session is running a turn.
 * @param stableComposer - Keep the Claude composer caret shape stable across busy/idle.
 * @returns DECSCUSR for the active composer or the terminal default.
 */
export function cursorStyleForBusy(busy: boolean, stableComposer = false): string {
  return busy || stableComposer ? BUSY_CURSOR_STYLE : RESTORE_CURSOR_STYLE
}
