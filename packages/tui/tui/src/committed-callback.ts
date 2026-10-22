import { useLayoutEffect, useRef } from 'react'

/**
 * Event handler with a stable identity and only the latest committed closure.
 * Keep the forwarding closure outside the component's lexical scope: interleaved
 * useCallback dependencies can otherwise chain old render contexts indefinitely.
 * Only use for events, never for values computed during render.
 */
export function useCommittedCallback<Fn extends (...args: any[]) => any>(handler: Fn): Fn {
  const latest = useRef(handler)
  useLayoutEffect(() => { latest.current = handler })
  const forward = useRef<Fn | null>(null)
  if (forward.current === null) forward.current = ((...args: Parameters<Fn>) => latest.current(...args)) as Fn
  return forward.current
}
