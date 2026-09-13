import { expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { readTuiSession } from '../src/session-read'

it('copies a fork observation and releases its lease exactly once', async () => {
  const dispose = vi.fn()
  const cut = { header: { id: 'fork', isSeeded: true }, inheritedEventCount: 2, events: [{ seq: 0 }, { seq: 1 }, { seq: 2 }], [Symbol.dispose]: dispose }
  const observeSession = vi.fn().mockResolvedValue(cut)
  const result = await readTuiSession({ observeSession }, SessionId('fork'))
  expect(observeSession).toHaveBeenCalledWith('fork', { projectionMode: 'none' })
  expect(result.events).toEqual(cut.events)
  expect(result.events).not.toBe(cut.events)
  expect(result.session).not.toBe(cut.header)
  expect(result.inheritedEventCount).toBe(2)
  expect(dispose).toHaveBeenCalledTimes(1)
})
it('releases the lease even if copying the observation fails', async () => {
  const dispose = vi.fn()
  const observeSession = vi.fn().mockResolvedValue({ get header() { throw new Error('bad observation') }, [Symbol.dispose]: dispose })
  await expect(readTuiSession({ observeSession }, SessionId('fork'))).rejects.toThrow('bad observation')
  expect(dispose).toHaveBeenCalledTimes(1)
})
