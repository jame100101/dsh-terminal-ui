import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'

/** UI history holds opaque ids; only the adapter retains official immutable refs. */
export class DraftImageRegistry {
  private readonly refs = new Map<string, ImageAttachmentRef>()

  constructor(private readonly capacity = 4096) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError('Invalid draft image registry capacity')
  }

  remember(refs: readonly ImageAttachmentRef[], protectedRefs: readonly ImageAttachmentRef[] = []): void {
    const pinned = new Set([...refs, ...protectedRefs].map(ref => String(ref.attachmentId)))
    for (const ref of refs) { const id = String(ref.attachmentId); this.refs.delete(id); this.refs.set(id, ref) }
    for (const id of this.refs.keys()) {
      if (this.refs.size <= this.capacity) break
      if (!pinned.has(id)) this.refs.delete(id)
    }
  }

  /** Resolve all entries before the caller replaces its pending attachments. */
  restore(resources: readonly string[]): ImageAttachmentRef[] {
    const restored = resources.map(resource => {
      const ref = this.refs.get(resource)
      if (ref === undefined) throw new Error('Draft image is no longer available; the current draft was retained')
      return ref
    })
    // Resolve the entire snapshot before touching LRU order or caller state.
    for (const ref of restored) { const id = String(ref.attachmentId); this.refs.delete(id); this.refs.set(id, ref) }
    return restored
  }
}
