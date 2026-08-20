/**
 * Optional stderr counters for busy-turn UI cost. Silent unless `TUI_PERF=1`.
 * @module @deepseek-ai/dsh-tui/src/tui-perf
 */

const WINDOW_MS = 1_000

let publishCount = 0
let renderCount = 0
let windowStart = 0

/** True when the process asked for TUI performance counters. */
export function tuiPerfEnabled(): boolean {
  return process.env.TUI_PERF === '1'
}

/** Count one store publish that wakes the Ink tree. */
export function countUiPublish(): void {
  if (!tuiPerfEnabled()) return
  publishCount += 1
  maybeReport()
}

/** Count one React render of the fullscreen app. */
export function countUiRender(): void {
  if (!tuiPerfEnabled()) return
  renderCount += 1
  maybeReport()
}

function maybeReport(): void {
  const now = Date.now()
  if (windowStart === 0) {
    windowStart = now
    return
  }
  const elapsed = now - windowStart
  if (elapsed < WINDOW_MS) return
  const seconds = elapsed / 1_000
  process.stderr.write(
    `[dsh-perf] publish=${(publishCount / seconds).toFixed(0)}/s render=${(renderCount / seconds).toFixed(0)}/s\n`,
  )
  publishCount = 0
  renderCount = 0
  windowStart = now
}
