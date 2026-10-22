import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionQueryEngine } from '@deepseek-ai/dsh-session-query'
import type { SessionEntry } from '../store'
import { sessionTitlesById } from '../settings-data'

type SessionPanelQuery = Pick<SessionQueryEngine, 'listSessions' | 'readTitleSnapshots'>

type TitlePersistence = Pick<Context['sessionPersistence'], 'identity' | 'list'>
export const MAX_CACHED_SESSION_TITLES = 50

/** Only detached titles are retained, never logs, Sessions or observation leases. */
export class SessionTitleCache {
  private identity: symbol | undefined
  private readonly entries = new Map<string, { revision: string; title: string | undefined }>()
  get size(): number { return this.entries.size }
  bind(identity: symbol | undefined): void {
    if (this.identity !== identity) { this.entries.clear(); this.identity = identity }
  }
  forget(id: string): void { this.entries.delete(id) }
  get(identity: symbol, id: string, revision: string): { title: string | undefined } | undefined {
    const entry = this.identity === identity ? this.entries.get(id) : undefined
    return entry?.revision === revision ? entry : undefined
  }
  set(identity: symbol, id: string, revision: string, title: string | undefined): void {
    // A replaced backend or superseded read must not repopulate an old cache.
    if (this.identity !== identity) return
    this.entries.delete(id)
    this.entries.set(id, { revision, title })
    while (this.entries.size > MAX_CACHED_SESSION_TITLES) this.entries.delete(this.entries.keys().next().value!)
  }
}

type TitleCacheOptions = {
  cache: SessionTitleCache
  persistence: TitlePersistence | undefined
  isLive(id: SessionId): boolean
}

/**
 * Load the /sessions rows: live agents plus the newest 50 persisted-corpus
 * records with their latest folded titles. Fails soft to the live list when
 * the query service or any title read rejects.
 */
export async function loadSessionRows(query: SessionPanelQuery | undefined, liveRows: readonly SessionEntry[], signal?: AbortSignal, titleCache?: TitleCacheOptions): Promise<SessionEntry[]> {
  if (query === undefined) return [...liveRows]
  try {
    const records = await query.listSessions(signal)
    const newest = records.slice(0, 50)
    // Titles fold once for every requested session. The live rows are usually
    // already among `newest`, and the corpus filter below drops live ids from
    // `newest` afterwards — so titles must be keyed BY SESSION ID, never read
    // by position: index-aligned lookups shifted by one for every corpus row
    // after a live record (the first-open bug where Enter resumed the NEXT
    // session below the selected one).
    const liveIds = liveRows.map(row => SessionId(row.id))
    // rc.2 revisions explicitly permit derived caches on the same backend/id.
    // Missing metadata and live sessions always use a fresh official title fold.
    const ids = [...new Set([...newest.map(record => record.header.id), ...liveIds])]
    const liveSet = new Set([...liveIds, ...records.filter(record => record.live).map(record => record.header.id)])
    const isLive = (id: SessionId): boolean => liveSet.has(id) || titleCache?.isLive(id) === true
    const persistence = titleCache?.persistence
    const identity = persistence?.identity
    titleCache?.cache.bind(identity)
    const revisions = new Map<string, string>()
    if (persistence !== undefined) {
      try {
        const wanted = new Set(ids)
        const metadata = await persistence.list(signal === undefined ? undefined : { signal })
        signal?.throwIfAborted()
        for (const item of metadata) {
          if (wanted.has(item.header.id) && typeof item.revision === 'string' && item.revision.length > 0) revisions.set(item.header.id, item.revision)
        }
      } catch { signal?.throwIfAborted() }
    }
    const titles = new Map<string, string>()
    const missing: SessionId[] = []
    for (const id of ids) {
      if (isLive(id)) titleCache?.cache.forget(id)
      const revision = revisions.get(id)
      const cached = identity === undefined || revision === undefined || isLive(id)
        ? undefined : titleCache?.cache.get(identity, id, revision)
      if (cached === undefined) missing.push(id)
      else if (cached.title !== undefined) titles.set(id, cached.title)
    }
    // Official reads already cap concurrency; small batches also bound each
    // admission interval and check cancellation before replaying more logs.
    for (let offset = 0; offset < missing.length; offset += 4) {
      signal?.throwIfAborted()
      const batch = await query.readTitleSnapshots(missing.slice(offset, offset + 4), signal)
      signal?.throwIfAborted()
      const folded = sessionTitlesById(batch)
      for (const [id, title] of folded) titles.set(id, title)
      for (const result of batch) {
        const revision = revisions.get(result.sessionId)
        if (result.status === 'fulfilled' && identity !== undefined && revision !== undefined && !isLive(result.sessionId)) {
          titleCache?.cache.set(identity, result.sessionId, revision, folded.get(result.sessionId))
        }
      }
    }
    const live = liveRows.map((row) => {
      const title = titles.get(row.id)
      return title === undefined ? row : { ...row, title }
    })
    const corpus: SessionEntry[] = newest
      .filter(record => !liveIds.includes(record.header.id))
      .map((record) => {
        const title = titles.get(record.header.id)
        return {
          id: record.header.id,
          model: '',
          status: record.live ? 'running' : 'persisted',
          ...(title === undefined ? {} : { title }),
          live: record.live,
          persisted: record.persisted,
          createdAt: record.header.createdAt,
        }
      })
    return [...live, ...corpus]
  } catch {
    signal?.throwIfAborted()
    return [...liveRows]
  }
}
