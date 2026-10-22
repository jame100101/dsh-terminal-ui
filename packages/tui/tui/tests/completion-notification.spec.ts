import { expect, it } from 'vitest'
import { CompletionNotification, completionSequence } from '../src/completion-notification'
it('only notifies once after a live successful turn settles with no work remaining', () => {
  const latch = new CompletionNotification()
  latch.end('completed')
  expect(latch.idle(false, true)).toBe(false)
  for (const reason of ['error', 'aborted']) { latch.start(); latch.end(reason); expect(latch.idle(false, true)).toBe(false) }
  latch.start(); latch.end('completed'); expect(latch.idle(true, true)).toBe(false)
  expect(latch.idle(false, true)).toBe(false)
  latch.start(); latch.end('completed'); expect(latch.idle(false, false)).toBe(false)
  latch.start(); latch.end('completed'); expect(latch.idle(false, true)).toBe(true)
  expect(latch.idle(false, true)).toBe(false)
})
it('uses fixed bounded notification text and a bell fallback without enabling tmux passthrough', () => {
  expect(completionSequence('iTerm.app', false)).toBe('\x1b]9;DSH-TUI: Task complete\x07')
  expect(completionSequence('ghostty', false)).toContain('777;notify;DSH-TUI;Task complete')
  expect(completionSequence('Apple_Terminal', false)).toBe('\x07')
  expect(completionSequence('ghostty', true)).toBe('\x07')
})
