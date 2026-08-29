/**
 * Coalesce high-frequency assistant-chunk UI publishes so the Ink tree is
 * not redrawn once per token. Fold still applies every session event
 * immediately; only `store.set` is delayed.
 * @module @deepseek-ai/dsh-tui/src/ui-publish
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** Target UI publish interval for coalesced stream chunks (~25 FPS). */
export const STREAM_UI_PUBLISH_MS = 40

/**
 * True when this session event may wait for the coalesced UI flush.
 * Interactive and structural events return false and must publish now.
 * @param event - the session event just folded.
 * @returns whether the UI publish may be delayed.
 */
export function shouldCoalesceSessionEvent(event: SessionEvent): boolean {
  if (event.type !== 'assistant/chunk') return false
  const chunk = event.data.chunk
  return chunk.type === 'text-delta' || chunk.type === 'reasoning-delta'
}

/**
 * Saturated live bodies keep the same `live` and `nodes` references. Those
 * deltas must not schedule a UI publish: the projection did not change.
 * @param previous - fold before this event.
 * @param next - fold after this event.
 * @returns whether the coalesced publisher should run.
 */
export function shouldPublishCoalescedFold(
  previous: { readonly live: unknown; readonly nodes: unknown },
  next: { readonly live: unknown; readonly nodes: unknown },
): boolean {
  return next.live !== previous.live || next.nodes !== previous.nodes
}

/** Schedule/cancel pair used by the scheduler (injectable in tests). */
export interface PublishTimer {
  schedule: (callback: () => void, delayMs: number) => unknown
  cancel: (handle: unknown) => void
}

/**
 * Create a coalescing publisher. `request(false)` collapses to one publish
 * per delay window; `request(true)` cancels the window and publishes now.
 * @param publish - the store write to invoke.
 * @param delayMs - coalescing window; defaults to {@link STREAM_UI_PUBLISH_MS}.
 * @param timer - optional timer pair (defaults to setTimeout/clearTimeout).
 * @returns the scheduler.
 */
export function createUiPublishScheduler(
  publish: () => void,
  delayMs: number = STREAM_UI_PUBLISH_MS,
  timer: PublishTimer = {
    schedule: (callback, delayMs) => setTimeout(callback, delayMs),
    cancel: (handle) => {
      clearTimeout(handle as ReturnType<typeof setTimeout>)
    },
  },
): { request(immediate: boolean): void; flush(): void; dispose(): void } {
  let handle: unknown = null
  const run = (): void => {
    handle = null
    publish()
  }
  return {
    request(immediate) {
      if (immediate) {
        if (handle !== null) {
          timer.cancel(handle)
          handle = null
        }
        publish()
        return
      }
      if (handle !== null) return
      handle = timer.schedule(run, delayMs)
    },
    flush() {
      if (handle === null) return
      timer.cancel(handle)
      handle = null
      publish()
    },
    dispose() {
      if (handle !== null) timer.cancel(handle)
      handle = null
    },
  }
}
