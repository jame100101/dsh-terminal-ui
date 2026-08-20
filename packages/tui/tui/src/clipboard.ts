/**
 * Clipboard backend for the TUI surface, kept independent of the renderer:
 * the platform's system clipboard tool first (Windows `clip`, macOS `pbcopy`,
 * Linux `xclip` then `wl-copy`), with an OSC 52 write as the last-resort
 * fallback. Every failure is reported in the result object — nothing here
 * ever throws, so a clipboard hiccup can never take the Session or the TUI
 * down. User text is piped to stdin; it is never concatenated into a shell
 * command string.
 * @module @deepseek-ai/dsh-tui/src/clipboard
 */

import { spawn } from 'node:child_process'
import type { WriteStream } from 'node:tty'

/** One clipboard write attempt's outcome. */
export interface ClipboardOutcome {
  ok: boolean
  /** The backend that carried the text (`system` or `osc52`). */
  via: 'system' | 'osc52'
  /** Present when both backends failed. */
  error?: string
}

/** One platform clipboard command tried in order. */
interface ClipboardCommand {
  command: string
  args: readonly string[]
}

/**
 * System clipboard commands for the current platform. Linux tries `xclip`
 * first unless `WAYLAND_DISPLAY` is set, in which case `wl-copy` is first;
 * the other command is the fallback. Unknown platforms have no system tool.
 * @returns the commands to try, in order.
 */
function systemClipboardCommands(): readonly ClipboardCommand[] {
  switch (process.platform) {
    case 'win32':
      return [{ command: 'clip', args: [] }]
    case 'darwin':
      return [{ command: 'pbcopy', args: [] }]
    case 'linux': {
      const xclip: ClipboardCommand = { command: 'xclip', args: ['-selection', 'clipboard'] }
      const wlCopy: ClipboardCommand = { command: 'wl-copy', args: [] }
      return process.env.WAYLAND_DISPLAY !== undefined && process.env.WAYLAND_DISPLAY !== ''
        ? [wlCopy, xclip]
        : [xclip, wlCopy]
    }
    default:
      return []
  }
}

/**
 * Copy one text through a single clipboard executable by piping it to stdin.
 * @param command - the executable name.
 * @param args - argv after the executable (never includes user text).
 * @param text - the exact text to copy.
 * @returns the attempt's outcome.
 */
function copyViaCommand(command: string, args: readonly string[], text: string): Promise<ClipboardOutcome> {
  return new Promise((resolve) => {
    let settled = false
    const settle = (outcome: ClipboardOutcome): void => {
      if (settled) return
      settled = true
      resolve(outcome)
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(command, [...args], { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true })
    } catch (error) {
      settle({ ok: false, via: 'system', error: error instanceof Error ? error.message : String(error) })
      return
    }
    child.once('error', (error) => {
      settle({ ok: false, via: 'system', error: error.message })
    })
    child.once('close', (code) => {
      settle(code === 0 ? { ok: true, via: 'system' } : { ok: false, via: 'system', error: `clipboard tool exited ${code ?? 'unknown'}` })
    })
    try {
      child.stdin?.end(text)
    } catch (error) {
      settle({ ok: false, via: 'system', error: error instanceof Error ? error.message : String(error) })
    }
  })
}

/**
 * Copy one text through the platform's system clipboard tool by piping it to
 * the tool's stdin. Resolves with the outcome; a spawn/pipe failure is an
 * `ok: false` system attempt, letting the caller fall back to OSC 52.
 * @param text - the exact text to copy (no trimming, no re-encoding).
 * @returns the system attempt's outcome.
 */
async function copyViaSystem(text: string): Promise<ClipboardOutcome> {
  const commands = systemClipboardCommands()
  if (commands.length === 0) {
    return { ok: false, via: 'system', error: `no system clipboard tool for ${process.platform}` }
  }
  let lastError = 'system clipboard unavailable'
  for (const entry of commands) {
    const outcome = await copyViaCommand(entry.command, entry.args, text)
    if (outcome.ok) return outcome
    lastError = outcome.error ?? lastError
  }
  return { ok: false, via: 'system', error: lastError }
}

/**
 * Copy one text through an OSC 52 escape (`ESC]52;c;<base64>BEL`), which the
 * host terminal forwards to the desktop clipboard. Terminals without OSC 52
 * support ignore the sequence silently — the outcome reports success for the
 * WRITE, which is all a TUI can verify.
 * @param text - the exact text to copy.
 * @param stdout - the surface's output stream.
 * @returns the OSC 52 attempt's outcome.
 */
export function copyViaOsc52(text: string, stdout: NodeJS.WriteStream): ClipboardOutcome {
  try {
    const encoded = Buffer.from(text, 'utf8').toString('base64')
    stdout.write(`\x1b]52;c;${encoded}\x07`)
    return { ok: true, via: 'osc52' }
  } catch (error) {
    return { ok: false, via: 'osc52', error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Copy one text to the desktop clipboard: system tool first, OSC 52 as the
 * fallback. Never throws.
 * @param text - the exact text to copy.
 * @param stdout - the surface's output stream (defaults to `process.stdout`).
 * @returns the final outcome.
 */
export async function copyToClipboard(
  text: string,
  stdout: NodeJS.WriteStream = process.stdout,
): Promise<ClipboardOutcome> {
  const system = await copyViaSystem(text)
  if (system.ok) return system
  const osc52 = copyViaOsc52(text, stdout)
  if (osc52.ok) return osc52
  return { ok: false, via: 'osc52', error: `${system.error ?? 'system clipboard unavailable'}；${osc52.error ?? 'OSC 52 write failed'}` }
}

export type { WriteStream }
