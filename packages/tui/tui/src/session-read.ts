/** Read a restored immutable cut through the public observation API. */
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionQueryEngine, SessionLogSnapshot } from '@deepseek-ai/dsh-session-query'

/** A cold fork includes both its inherited prefix and its own subsequent events.
 * observeSession restores that boundary; readSession in Harness 0.1.5 invokes
 * the seed-construction path, which rejects a fork with subsequent events.
 * Clone before disposing the lease; never mutate or retain host-owned storage.
 */
export async function readTuiSession(query: Pick<SessionQueryEngine, 'observeSession'>, id: SessionId): Promise<SessionLogSnapshot> {
  const cut = await query.observeSession(id, { projectionMode: 'none' })
  try {
    return { session: structuredClone(cut.header), events: structuredClone([...cut.events]), inheritedEventCount: cut.inheritedEventCount }
  } finally {
    cut[Symbol.dispose]()
  }
}
