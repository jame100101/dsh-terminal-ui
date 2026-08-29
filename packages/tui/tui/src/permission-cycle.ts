/**
 * Shift+Tab file-policy cycling. Legacy terminals emit CSI Z without an event
 * phase; Kitty can emit press, repeat, and release reports. Only an accepted
 * press changes policy, and that change completes before a following Enter.
 * @module @deepseek-ai/dsh-tui/src/permission-cycle
 */

/** Ink `Key` fields the gate reads. */
export interface PermissionKey {
  readonly shift: boolean
  readonly tab: boolean
  readonly return: boolean
  readonly eventType?: 'press' | 'repeat' | 'release'
}

/**
 * Whether this event is a permission-cycle Shift+Tab press.
 * Enter/return never counts, even if a terminal batches `\x1b[Z\r`.
 * @param input - Ink's `input` string for the event.
 * @param key - Ink's `key` value.
 * @returns true when the event may rotate file policy.
 */
export function isPermissionCycleKey(input: string, key: PermissionKey): boolean {
  if (key.return || input.includes('\r') || input.includes('\n')) return false
  if (key.eventType === 'release' || key.eventType === 'repeat') return false
  return (key.shift && key.tab) || input === '\x1b[Z'
}

/**
 * One cycle per accepted Shift+Tab press. Kitty release/repeat reports are
 * rejected by {@link isPermissionCycleKey}; each separate legacy CSI-Z is a
 * distinct key press. The action runs synchronously so a following Enter
 * cannot cancel or defer an already accepted permission change.
 */
export class PermissionCycleGate {
  /**
   * Accept a key event and rotate permission before the next input event.
   * @param input - Ink's `input` string.
   * @param key - Ink's `key` value.
   * @param cycle - rotate the session file-policy mode.
   * @returns whether this event performed a cycle.
   */
  request(input: string, key: PermissionKey, cycle: () => void): boolean {
    if (!isPermissionCycleKey(input, key)) return false
    cycle()
    return true
  }
}
