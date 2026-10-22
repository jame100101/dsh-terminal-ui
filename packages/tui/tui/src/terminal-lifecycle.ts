/** POSIX job control through Ink's public terminal-ownership API. */
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useApp, useInput } from 'ink'
import { DISABLE_WHEEL_MOUSE, ENABLE_WHEEL_MOUSE } from './mouse'
import { RESTORE_CURSOR_STYLE } from './cursor-style'

type SuspendTerminal = ReturnType<typeof useApp>['suspendTerminal']
let resumeRevision = 0
const cursorListeners = new Set<() => void>()
const subscribeCursor = (listener: () => void): (() => void) => { cursorListeners.add(listener); return () => { cursorListeners.delete(listener) } }
/** Notify public cursor owners after any Ink terminal suspension, including redraw. */
export function notifyTerminalResume(): void {
  resumeRevision += 1
  for (const listener of cursorListeners) listener()
}
/** Recommit public useCursor after Ink resets its cache on resume, even beneath memoized composers. */
export function useTerminalResumeCursor(): void {
  useSyncExternalStore(subscribeCursor, () => resumeRevision)
}

/** Restore the shell before stopping, then let Ink reacquire raw input and repaint on SIGCONT.
 * SIGSTOP follows our handled SIGTSTP so orphaned PTY process groups also stop reliably.
 * The terminal shell remains responsible for foreground job control and sending SIGCONT.
 */
export function usePosixTerminalSuspend(suspendTerminal: SuspendTerminal, stdout: NodeJS.WriteStream, cursorStyle: string): void {
  const current = useRef({ suspendTerminal, cursorStyle })
  current.current = { suspendTerminal, cursorStyle }
  const pending = useRef(false)
  const request = useRef<() => void>(() => {})
  useEffect(() => {
    if (process.platform === 'win32' || stdout.isTTY !== true) return
    let mounted = true
    const stop = (): void => {
      if (pending.current || !mounted) return
      pending.current = true
      void current.current.suspendTerminal(async () => {
        await new Promise<void>((resolve, reject) => stdout.write(DISABLE_WHEEL_MOUSE + RESTORE_CURSOR_STYLE,
          error => error ? reject(error) : resolve()))
        await new Promise<void>((resolve, reject) => {
          // Raw-input suspension may remove Node's last referenced handle. Keep
          // ownership alive until SIGCONT, without reading the shell's input.
          const keepAlive = setInterval(() => {}, 2_147_483_647)
          const continued = (): void => { clearInterval(keepAlive); process.removeListener('SIGCONT', continued); resolve() }
          process.once('SIGCONT', continued)
          try { process.kill(process.pid, 'SIGSTOP') }
          catch (error) { clearInterval(keepAlive); process.removeListener('SIGCONT', continued); reject(error) }
        })
      }).then(() => {
        if (mounted) {
          stdout.write(ENABLE_WHEEL_MOUSE + current.current.cursorStyle)
          // The public suspension reset clears Ink's cursor cache. A React commit
          // re-registers the existing useCursor position without moving the draft.
          notifyTerminalResume()
        }
      }).catch((error: unknown) => {
        // Preserve the app and draft if terminal suspension itself is unavailable.
        if (mounted) process.stderr.write(`Terminal suspend failed: ${error instanceof Error ? error.message : String(error)}\n`)
      }).finally(() => { pending.current = false })
    }
    request.current = stop
    process.on('SIGTSTP', stop)
    return () => { mounted = false; request.current = () => {}; process.removeListener('SIGTSTP', stop) }
  }, [stdout])
  useInput((input, key) => {
    if (key.ctrl && input.toLowerCase() === 'z') request.current()
  }, { isActive: process.platform !== 'win32' && stdout.isTTY === true })
}
