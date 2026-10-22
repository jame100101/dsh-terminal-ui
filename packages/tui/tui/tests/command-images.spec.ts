import { expect, it, vi } from 'vitest'
import { executeImageCommand } from '../src/controller/command-images'
function fixture() {
  const first = { id: 'first' }; const second = { id: 'second' }
  const source = {}; let owner: object = source; let epoch = 0; let images = [first]
  const state = { owner: () => owner, epoch: () => epoch, images: () => images, replace: (next: typeof images) => { images = next } }
  return { first, second, source, state, lease: { owner: source, epoch, images: [first] }, switch: () => { owner = {}; images = [second] }, append: () => { images.push(second) }, restore: () => { epoch++; images = [first] } }
}
it('refuses execution when session changes during encoding', async () => {
  const f = fixture(); const encoded = Promise.withResolvers<string>(); const execute = vi.fn(async () => 'accepted')
  const pending = executeImageCommand(f.lease, f.state, () => encoded.promise, execute)
  f.switch(); encoded.resolve('encoded')
  await expect(pending).rejects.toThrow('Session changed')
  expect(execute).not.toHaveBeenCalled(); expect(f.state.images()).toEqual([f.second])
})
it('retains appended images after the original command succeeds', async () => {
  const f = fixture(); const accepted = Promise.withResolvers<string>()
  const pending = executeImageCommand(f.lease, f.state, async () => 'encoded', () => accepted.promise)
  await Promise.resolve(); f.append(); accepted.resolve('accepted')
  expect(await pending).toBe('accepted'); expect(f.state.images()).toEqual([f.second])
})
it('does not clear a restored draft which reuses exactly the same attachment ref', async () => {
  const f = fixture(); const accepted = Promise.withResolvers<string>()
  const pending = executeImageCommand(f.lease, f.state, async () => 'encoded', () => accepted.promise)
  await Promise.resolve(); f.restore(); accepted.resolve('accepted')
  expect(await pending).toBe('accepted'); expect(f.state.images()).toEqual([f.first])
})
it('returns accepted once but never mutates the new session on a late acknowledgement', async () => {
  const f = fixture(); const accepted = Promise.withResolvers<string>()
  const pending = executeImageCommand(f.lease, f.state, async () => 'encoded', () => accepted.promise)
  await Promise.resolve(); f.switch(); accepted.resolve('accepted')
  expect(await pending).toBe('accepted'); expect(f.state.images()).toEqual([f.second])
})
it('does not remove images for an unhandled or failed command', async () => {
  const f = fixture()
  expect(await executeImageCommand(f.lease, f.state, async () => 'encoded', async () => undefined)).toBeUndefined()
  await expect(executeImageCommand(f.lease, f.state, async () => 'encoded', async () => { throw new Error('failed') })).rejects.toThrow('failed')
  expect(f.state.images()).toEqual([f.first])
})
