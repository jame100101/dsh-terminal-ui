import { expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { loadSessionRows, SessionTitleCache, MAX_CACHED_SESSION_TITLES } from '../src/harness/session-panel'

function fixture(count = 60) {
  const records = Array.from({ length: count }, (_, index) => ({
    header: { id: SessionId(`s${index}`), createdAt: count - index }, live: index === 0, persisted: true,
  }))
  const readTitleSnapshots = vi.fn(async (ids: readonly string[], signal?: AbortSignal) => {
    signal?.throwIfAborted()
    // Host result order is not the UI row order, and one cold log may fail.
    return [...ids].reverse().map(id => id === 's3'
      ? { sessionId: id, status: 'rejected', reason: new Error('unreadable') }
      : { sessionId: id, status: 'fulfilled', value: { session: { id }, title: { title: `title-${id}` } } })
  })
  return { listSessions: vi.fn(async () => records), readTitleSnapshots }
}

it('bounds cold title replay while retaining the newest 50, live rows and identity-based titles', async () => {
  const query = fixture()
  const rows = await loadSessionRows(query as any, [{ id: 's0', model: 'fixture', status: 'idle' }])
  expect(rows).toHaveLength(50)
  expect(rows[0]).toMatchObject({ id: 's0', title: 'title-s0', model: 'fixture' })
  expect(rows[1]).toMatchObject({ id: 's1', title: 'title-s1' })
  expect(rows[3]?.title).toBeUndefined()
  expect(rows.at(-1)?.id).toBe('s49')
  expect(query.readTitleSnapshots.mock.calls.every(([ids]) => ids.length <= 4)).toBe(true)
  expect(query.readTitleSnapshots.mock.calls.flatMap(([ids]) => ids)).toEqual(Array.from({ length: 50 }, (_, i) => `s${i}`))
})

it('stops admitting cold reads after cancellation, even when an in-flight provider ignores abort', async () => {
  const query = fixture()
  const controller = new AbortController()
  const first = Promise.withResolvers<any>()
  query.readTitleSnapshots.mockImplementationOnce(() => first.promise)
  const result = loadSessionRows(query as any, [], controller.signal)
  await vi.waitFor(() => expect(query.readTitleSnapshots).toHaveBeenCalledTimes(1))
  controller.abort()
  first.resolve([])
  await expect(result).rejects.toThrow()
  expect(query.readTitleSnapshots).toHaveBeenCalledTimes(1)
  expect(query.listSessions).toHaveBeenCalledWith(controller.signal)
})

it('does not cache titles across opens or omit live sessions outside the latest page', async () => {
  const query = fixture()
  const live = [{ id: 's99', model: 'fixture', status: 'idle' }]
  const first = await loadSessionRows(query as any, live)
  expect(first[0]).toMatchObject({ id: 's99', title: 'title-s99' })
  query.readTitleSnapshots.mockImplementation(async ids => ids.map(id => ({ sessionId: id, status: 'fulfilled', value: { session: { id }, title: { title: 'renamed' } } })))
  const next = await loadSessionRows(query as any, live)
  expect(next[0]?.title).toBe('renamed')
  expect(next).toHaveLength(51)
})

it('preserves live rows on an operational query failure', async () => {
  const query = fixture()
  query.listSessions.mockRejectedValue(new Error('disk unavailable'))
  const live = [{ id: 'live', model: 'fixture', status: 'idle' }]
  expect(await loadSessionRows(query as any, live)).toEqual(live)
})

function caching(query: ReturnType<typeof fixture>) {
  const revisions = new Map<string, string>()
  const persistence = {
    identity: Symbol('backend'),
    list: vi.fn(async () => (await query.listSessions()).map(record => ({ header: record.header, revision: revisions.get(record.header.id) ?? 'r1' }))),
  }
  return { cache: new SessionTitleCache(), persistence, isLive: vi.fn((_id: string) => false), revisions }
}

it('reuses only unchanged cold titles and refreshes a renamed revision', async () => {
  const query = fixture(3), options = caching(query)
  await loadSessionRows(query as any, [], undefined, options as any)
  query.readTitleSnapshots.mockClear()
  const unchanged = await loadSessionRows(query as any, [], undefined, options as any)
  expect(query.readTitleSnapshots.mock.calls.flatMap(([ids]) => ids)).toEqual(['s0'])
  expect(unchanged[1]?.title).toBe('title-s1')
  options.revisions.set('s1', 'r2')
  query.readTitleSnapshots.mockImplementation(async ids => ids.map(id => ({ sessionId: id, status: 'fulfilled', value: { session: { id }, title: { title: `renamed-${id}` } } })))
  query.readTitleSnapshots.mockClear()
  const renamed = await loadSessionRows(query as any, [], undefined, options as any)
  expect(renamed[1]?.title).toBe('renamed-s1')
  expect(query.readTitleSnapshots.mock.calls.flatMap(([ids]) => ids)).toEqual(['s0', 's1'])
})

it('invalidates live sessions and backend replacements even if persisted revisions match', async () => {
  const query = fixture(3), options = caching(query)
  await loadSessionRows(query as any, [], undefined, options as any)
  options.isLive.mockImplementation(id => id === 's1')
  query.readTitleSnapshots.mockClear()
  await loadSessionRows(query as any, [], undefined, options as any)
  expect(query.readTitleSnapshots.mock.calls.flatMap(([ids]) => ids)).toEqual(['s0', 's1'])
  options.isLive.mockReturnValue(false)
  options.persistence.identity = Symbol('replacement')
  query.readTitleSnapshots.mockClear()
  await loadSessionRows(query as any, [], undefined, options as any)
  expect(query.readTitleSnapshots.mock.calls.flatMap(([ids]) => ids)).toEqual(['s0', 's1', 's2'])
})

it('never serves stale cached titles when revision metadata is missing or fails', async () => {
  const query = fixture(3), options = caching(query)
  await loadSessionRows(query as any, [], undefined, options as any)
  for (const missing of [false, true]) {
    if (missing) options.persistence.list.mockResolvedValueOnce([])
    else options.persistence.list.mockRejectedValueOnce(new Error('metadata unavailable'))
    query.readTitleSnapshots.mockClear()
    await loadSessionRows(query as any, [], undefined, options as any)
    expect(query.readTitleSnapshots.mock.calls.flatMap(([ids]) => ids)).toEqual(['s0', 's1', 's2'])
  }
})

it('bounds retained titles across disjoint pages and retries failed titles', async () => {
  const query = fixture(), options = caching(query)
  await loadSessionRows(query as any, [], undefined, options as any)
  query.readTitleSnapshots.mockClear()
  await loadSessionRows(query as any, [], undefined, options as any)
  expect(query.readTitleSnapshots.mock.calls.flatMap(([ids]) => ids)).toEqual(['s0', 's3'])
  const original = await query.listSessions()
  query.listSessions.mockResolvedValue(original.map(row => ({ ...row, header: { ...row.header, id: SessionId(`new-${row.header.id}`) } })))
  await loadSessionRows(query as any, [], undefined, options as any)
  expect(options.cache.size).toBe(MAX_CACHED_SESSION_TITLES)
  query.listSessions.mockResolvedValue(original)
  query.readTitleSnapshots.mockClear()
  await loadSessionRows(query as any, [], undefined, options as any)
  expect(query.readTitleSnapshots.mock.calls.flatMap(([ids]) => ids)).toContain('s1')
  expect(options.cache.size).toBeLessThanOrEqual(MAX_CACHED_SESSION_TITLES)
})

it('does not cache an aborted title batch or let an old backend overwrite new entries', async () => {
  const query = fixture(3), options = caching(query), controller = new AbortController()
  const first = Promise.withResolvers<any>()
  query.readTitleSnapshots.mockImplementationOnce(() => first.promise)
  const aborted = loadSessionRows(query as any, [], controller.signal, options as any)
  await vi.waitFor(() => expect(query.readTitleSnapshots).toHaveBeenCalledTimes(1))
  controller.abort()
  first.resolve([{ sessionId: 's1', status: 'fulfilled', value: { session: { id: 's1' }, title: { title: 'old' } } }])
  await expect(aborted).rejects.toThrow()
  expect(options.cache.size).toBe(0)
  const old = options.persistence.identity
  options.cache.bind(Symbol('replacement'))
  options.cache.set(old, 's1', 'r1', 'old')
  expect(options.cache.size).toBe(0)
})


it('caches a confirmed absence of title without inventing a fallback label', async () => {
  const query = fixture(3), options = caching(query)
  query.readTitleSnapshots.mockImplementation(async ids => ids.map(id => ({ sessionId: id, status: 'fulfilled', value: { session: { id } } })) as any)
  await loadSessionRows(query as any, [], undefined, options as any)
  query.readTitleSnapshots.mockClear()
  const rows = await loadSessionRows(query as any, [], undefined, options as any)
  expect(query.readTitleSnapshots.mock.calls.flatMap(([ids]) => ids)).toEqual(['s0'])
  expect(rows.every(row => row.title === undefined)).toBe(true)
})
