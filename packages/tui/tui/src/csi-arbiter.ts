/**
 * Shared arbiter for Ink's pending-escape flushes. Ink's input parser holds a
 * lone `\x1b` for only 20ms before flushing it as an Escape; a CSI sequence
 * (`\x1b[B`, …) split across two reads with a wider gap arrives as a phantom
 * Escape followed by the bare tail (`[B`) as TEXT. Under a busy stream both
 * symptoms bite at once: the phantom Escape wipes the draft / dismisses the
 * picker, and the tail pollutes the composer. The renderer routes every
 * Escape through a confirmation delay here and, when a CSI tail arrives
 * inside that window, swallows it and re-synthesizes the real key instead.
 *
 * One module-scope arbiter is enough: the Ink app mounts exactly one App and
 * one ImeTextInput per process, and both must agree on the pending state
 * (ImeTextInput's handler runs before App's).
 * @module @deepseek-ai/dsh-tui/src/csi-arbiter
 */

/** How long a lone Escape is held before it counts as real. */
export const ESC_CONFIRM_MS = 60

/** The key names a re-synthesized CSI tail can carry. */
export type TailKey = 'up' | 'down' | 'right' | 'left' | 'home' | 'end' | 'pageup' | 'pagedown' | 'delete' | 'shifttab'

/** CSI tails the arbiter re-synthesizes (the head `\x1b[` was flushed early). */
const CSI_TAILS: Record<string, TailKey> = {
  A: 'up', B: 'down', C: 'right', D: 'left', H: 'home', F: 'end',
  '5~': 'pageup', '6~': 'pagedown', '3~': 'delete', Z: 'shifttab',
  '1~': 'home', '4~': 'end', '7~': 'home', '8~': 'end',
  a: 'up', b: 'down', c: 'right', d: 'left',
}

/**
 * Map a bare CSI tail (`[B`, `[5~`, …) to its key name.
 * @param input - terminal input beginning with `[`.
 * @returns the recognized key name, or null.
 */
export function csiTailKey(input: string): TailKey | null {
  if (!input.startsWith('[')) return null
  return CSI_TAILS[input.slice(1)] ?? null
}

interface Arbiter {
  pending: ReturnType<typeof setTimeout> | null
  /** Schedule the deferred Escape action; replaces any pending one. */
  schedule(onFire: () => void): void
  /** Cancel a pending Escape; true when one was pending. */
  cancel(): boolean
  /** Whether a phantom-Escape window is open right now. */
  hasPending(): boolean
}

/** The module-scope arbiter shared by App and ImeTextInput. */
export const escapeArbiter: Arbiter = {
  pending: null,
  schedule(onFire: () => void): void {
    if (escapeArbiter.pending !== null) clearTimeout(escapeArbiter.pending)
    escapeArbiter.pending = setTimeout(() => {
      escapeArbiter.pending = null
      onFire()
    }, ESC_CONFIRM_MS)
  },
  cancel(): boolean {
    if (escapeArbiter.pending === null) return false
    clearTimeout(escapeArbiter.pending)
    escapeArbiter.pending = null
    return true
  },
  hasPending(): boolean {
    return escapeArbiter.pending !== null
  },
}

/** One synthesized `Key` for a re-parsed CSI tail (the subset the TUI uses). */
export interface SyntheticKey {
  upArrow: boolean
  downArrow: boolean
  leftArrow: boolean
  rightArrow: boolean
  home: boolean
  end: boolean
  pageUp: boolean
  pageDown: boolean
  delete: boolean
  tab: boolean
  shift: boolean
  return: boolean
  escape: boolean
  ctrl: boolean
  meta: boolean
}

/**
 * Build the `Key` object for a re-synthesized CSI tail.
 * @param name - recognized CSI key name.
 * @returns an Ink-compatible key value.
 */
export function syntheticKey(name: TailKey): SyntheticKey {
  return {
    upArrow: name === 'up',
    downArrow: name === 'down',
    leftArrow: name === 'left',
    rightArrow: name === 'right',
    home: name === 'home',
    end: name === 'end',
    pageUp: name === 'pageup',
    pageDown: name === 'pagedown',
    delete: name === 'delete',
    tab: name === 'shifttab',
    shift: name === 'shifttab',
    return: false,
    escape: false,
    ctrl: false,
    meta: false,
  }
}
