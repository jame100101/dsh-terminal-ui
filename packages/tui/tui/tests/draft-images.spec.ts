import { describe, expect, it } from 'vitest'
import { AttachmentId, type ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { DraftImageRegistry } from '../src/draft-images'
const ref = (id: string): ImageAttachmentRef => ({ attachmentId: AttachmentId(id), bytes: 100, width: 1, height: 1, mediaType: 'image/png' })
describe('host-owned draft image history', () => {
  it('restores exact saved refs in snapshot order including intentional duplicates', () => {
    const registry = new DraftImageRegistry()
    const a = ref('a'); const b = ref('b')
    registry.remember([a, b])
    expect(registry.restore(['b', 'a', 'b'])).toEqual([b, a, b])
    expect(registry.restore(['a'])[0]).toBe(a)
    expect(registry.restore([])).toEqual([])
  })
  it('rejects unknown or path-like resources without changing existing identities', () => {
    const registry = new DraftImageRegistry(); const a = ref('a'); registry.remember([a])
    expect(() => registry.restore(['a', '/etc/passwd'])).toThrow('no longer available')
    expect(registry.restore(['a'])).toEqual([a])
  })
})

it('evicts old history metadata without losing active foreground or resident attachments', () => {
  const registry = new DraftImageRegistry(3)
  const active = ref('active'), resident = ref('resident'), old = ref('old'), next = ref('next')
  registry.remember([active, resident, old])
  registry.remember([next], [active, resident])
  expect(registry.restore(['active', 'resident', 'next'])).toEqual([active, resident, next])
  expect(() => registry.restore(['old'])).toThrow('no longer available')
  expect(() => registry.restore(['active', 'old'])).toThrow()
  expect(registry.restore(['active'])).toEqual([active])
})
