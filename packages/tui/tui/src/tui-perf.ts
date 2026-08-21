/**
 * Optional stderr counters for busy-turn UI cost. Silent unless `TUI_PERF=1`.
 * Each one-second window reports publish/s, render/s, V8 `heapUsed`, wheel
 * handler delay, and one event-loop lag sample.
 * @module @deepseek-ai/dsh-tui/src/tui-perf
 */

const WINDOW_MS = 1_000

let publishCount = 0
let renderCount = 0
let windowStart = 0
let wheelCount = 0
let wheelMsTotal = 0
let wheelMsMax = 0
let lagMs = 0

/** True when the process asked for TUI performance counters. */
export function tuiPerfEnabled(): boolean {
  return process.env.TUI_PERF === '1'
}

/** Drop accumulated counters (tests). */
export function resetTuiPerf(): void {
  publishCount = 0
  renderCount = 0
  windowStart = 0
  wheelCount = 0
  wheelMsTotal = 0
  wheelMsMax = 0
  lagMs = 0
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

/**
 * Record one wheel/page handler's wall time (input parse through offset write).
 * @param ms - elapsed milliseconds.
 */
export function countUiInputDelay(ms: number): void {
  if (!tuiPerfEnabled()) return
  const delay = Number.isFinite(ms) && ms > 0 ? ms : 0
  wheelCount += 1
  wheelMsTotal += delay
  if (delay > wheelMsMax) wheelMsMax = delay
}

function wheelField(): string {
  if (wheelCount === 0) return 'wheel=n/a'
  return `wheel_avg=${(wheelMsTotal / wheelCount).toFixed(2)}ms wheel_max=${wheelMsMax.toFixed(2)}ms`
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
  const heapMb = process.memoryUsage().heapUsed / (1024 * 1024)
  process.stderr.write(
    `[dsh-perf] publish=${(publishCount / seconds).toFixed(0)}/s render=${(renderCount / seconds).toFixed(0)}/s heap=${heapMb.toFixed(1)}MB ${wheelField()} lag=${lagMs.toFixed(0)}ms\n`,
  )
  publishCount = 0
  renderCount = 0
  wheelCount = 0
  wheelMsTotal = 0
  wheelMsMax = 0
  windowStart = now
  const started = now
  setImmediate(() => {
    if (!tuiPerfEnabled()) return
    lagMs = Date.now() - started
  })
}
