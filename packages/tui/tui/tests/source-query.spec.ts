import { readFile, stat, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { SourceInspectionCache, readSessionSource, readToolSource, pageToolSource, exportToolSource } from '../src/source-query'
import { applyEvent, createScratch, initialState } from '../src/fold'
const identity = { sessionId: SessionId('fork'), callId: 'a' }
const event = (type: string, data: unknown, seq: number): SessionEvent => ({ type, data, seq, time: seq } as SessionEvent)
const call = (id = 'a', args = '{}') => event('tool/call', { callId: id, name: 'edit', arguments: args }, 1)
const result = (text: string, id = 'a') => event('tool/result', { message: { role: 'tool', toolCallId: id, content: [{ type: 'text', text }] }, meta: { diffs: [{ path: 'a.ts', oldText: 'old\r\n', newText: text }] } }, 2)
function fixture(events: SessionEvent[], source: 'live' | 'prepared' = 'prepared') {
  const dispose = vi.fn()
  const observeSession = vi.fn().mockResolvedValue({ header: { id: 'fork' }, source, cursor: 2, events, [Symbol.dispose]: dispose })
  return { observeSession, dispose }
}
it('recovers all text after display compaction and preserves long lines in pages', async () => {
  const long = '开头' + 'x'.repeat(90000) + '👩🏽‍💻末尾'
  const events = [call(), result(long)]
  const scratch = createScratch()
  const folded = events.reduce((state, entry) => applyEvent(state, entry, scratch), initialState())
  expect(folded.nodes.find(n => n.kind === 'tool')).not.toMatchObject({ text: long })
  const query = fixture(events)
  const document = await readToolSource(query, identity)
  expect(document.status).toBe('complete')
  expect(document.text).toContain(long)
  let joined = ''; let offset: number | null = 0
  while (offset !== null) { const page = pageToolSource(document, offset, 101); joined += page.text; offset = page.nextOffset }
  expect(joined).toBe(document.text)
  expect(query.dispose).toHaveBeenCalledTimes(1)
  expect(query.observeSession).toHaveBeenCalledWith('fork', { projectionMode: 'none' })
})
it('reads exact call identity, exposes full diff snapshots and never mutates stored events', async () => {
  const events = [call('b'), result('unrelated', 'b'), call('a', '{"path":"a.ts"}'), result('new\r\n')]
  const before = structuredClone(events)
  const present = vi.fn((_name, args, output) => ({ args, diffs: output.meta.diffs }))
  const document = await readToolSource(fixture(events), identity, { present })
  expect(document.text).not.toContain('unrelated')
  expect(document.text).toContain('old\\n')
  expect(document.text).toContain('new\\n')
  expect(present).toHaveBeenCalledWith('edit', { path: 'a.ts' }, expect.objectContaining({ meta: expect.anything() }))
  expect(events).toEqual(before)
})
it('supports PTC sub-call metadata without confusing its root call', async () => {
  const data = { rootCallId: 'root', parentCallId: 'root', subCallId: 'a', name: 'read', arguments: { path: 'x' } }
  const present = vi.fn((_name, _args, output) => output.meta)
  const document = await readToolSource(fixture([call('root'), event('tool/ptc-dispatch-start', data, 1), event('tool/ptc-dispatch', { ...data, content: [{ type: 'text', text: 'nested' }], isError: false, meta: { lines: [1] } }, 2)]), identity, { present })
  expect(document.status).toBe('complete')
  expect(document.text).toContain('nested')
  expect(present.mock.calls[0]?.[2].meta).toEqual({ lines: [1] })
})
it('supports legacy persisted tool results and cold recovery', async () => {
  const legacy = event('tool/result', { message: { role: 'user', content: [{ type: 'tool-result', toolCallId: 'a', content: [{ type: 'text', text: 'legacy full output' }] }] } }, 2)
  const document = await readToolSource(fixture([call(), legacy]), identity)
  expect(document).toMatchObject({ source: 'prepared', status: 'complete' })
  expect(document.text).toContain('legacy full output')
})
it('reports missing/incomplete/duplicate records explicitly and never guesses a duplicate Diff', async () => {
  expect((await readToolSource(fixture([]), identity)).status).toBe('missing')
  expect((await readToolSource(fixture([call()]), identity)).status).toBe('incomplete')
  const present = vi.fn()
  const document = await readToolSource(fixture([call(), call(), result('x')]), identity, { present })
  expect(document.status).toBe('ambiguous'); expect(present).not.toHaveBeenCalled()
})
it('masks before pagination/export without mutating host secrets', async () => {
  const token = 'sk-12345678901234567890'
  const events = [call('a', JSON.stringify({ api_key: token })), result(`token=${token}\nend`)]
  const document = await readToolSource(fixture(events, 'live'), identity)
  expect(document.text).not.toContain(token)
  expect(document.text).toContain('[REDACTED]')
  const path = await exportToolSource(document)
  try {
    expect(await readFile(path, 'utf8')).toBe(document.text)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  } finally { await rm(dirname(path), { recursive: true }) }
  expect(JSON.stringify(events)).toContain(token)
})
it('disposes on wrong identity, abort, and failing presentation', async () => {
  const wrong = fixture([])
  await expect(readToolSource(wrong, { ...identity, sessionId: SessionId('other') })).rejects.toThrow('identity mismatch')
  expect(wrong.dispose).toHaveBeenCalledTimes(1)
  const aborted = fixture([]); const controller = new AbortController(); controller.abort()
  await expect(readToolSource(aborted, identity, { signal: controller.signal })).rejects.toThrow()
  expect(aborted.dispose).toHaveBeenCalledTimes(1)
  const query = fixture([call(), result('recoverable')])
  const doc = await readToolSource(query, identity, { present: () => { throw new Error('bad') } })
  expect(doc.text).toContain('recoverable'); expect(doc.warnings.join()).toContain('Presentation unavailable')
  expect(query.dispose).toHaveBeenCalledTimes(1)
})
it('rejects invalid page windows and does not split emoji', async () => {
  const document = { ...await readToolSource(fixture([]), identity), text: 'a😀b' }
  const first = pageToolSource(document, 0, 2)
  expect(first.text).toBe('a'); expect(first.nextOffset).toBe(1)
  expect(pageToolSource(document, 1, 2).text).toBe('😀')
  expect(() => pageToolSource(document, 2, 2)).toThrow('Unicode')
  expect(() => pageToolSource(document, 0, 0)).toThrow()
  expect(() => pageToolSource(document, -1)).toThrow()
})

it('masks a multiline private key before page boundaries split the block', async () => {
  const entry = event('tool/result', { message: { role: 'tool', toolCallId: 'a', content: [
    { type: 'text', text: '-----BEGIN PRIVATE KEY-----' },
    { type: 'text', text: 'sensitive-key-material' },
    { type: 'text', text: '-----END PRIVATE KEY-----' },
  ] } }, 2)
  const document = await readToolSource(fixture([call(), entry]), identity)
  expect(document.text).not.toContain('sensitive-key-material')
  expect(document.text).toContain('[REDACTED]')
})

it('makes evicted and compacted session history inspectable without mutating the durable cut', async () => {
  const events = Array.from({ length: 3000 }, (_, index) => event('user/message', {
    message: { id: `m-${index}`, role: 'user', content: [{ type: 'text', text: `record-${index} 中文` }] },
  }, index + 1))
  events.push(event('context/compaction', { summary: 'model-context-only' }, 3001))
  const before = structuredClone(events)
  const query = fixture(events)
  const source = await readSessionSource(query, identity.sessionId)
  expect(source.callId).toBe('')
  expect(source.text).toContain('record-0 中文')
  expect(source.text).toContain('record-2999 中文')
  expect(source.text).toContain('model-context-only')
  let text = ''; let offset: number | null = 0
  while (offset !== null) { const page = pageToolSource(source, offset); text += page.text; offset = page.nextOffset }
  expect(text).toBe(source.text)
  expect(events).toEqual(before)
  expect(query.dispose).toHaveBeenCalledTimes(1)
})

it('keeps the newest explicit cut when older reads resolve late, including return to page zero', async () => {
  const cache = new SourceInspectionCache()
  const base = await readToolSource(fixture([call(), result('base')]), identity)
  const older = Promise.withResolvers<typeof base>()
  const newer = Promise.withResolvers<typeof base>()
  const first = cache.read(identity.sessionId, identity.callId, true, () => older.promise)
  const second = cache.read(identity.sessionId, identity.callId, true, () => newer.promise)
  newer.resolve({ ...base, cursor: 4, text: 'new cut' })
  await second
  older.resolve({ ...base, cursor: 2, text: 'old cut' })
  await first
  const load = vi.fn().mockRejectedValue(new Error('must not refresh pagination'))
  const retained = await cache.read(identity.sessionId, identity.callId, false, load)
  expect(pageToolSource(retained, 0).text).toBe('new cut')
  expect(load).not.toHaveBeenCalled()
  const other = await cache.read(SessionId('other'), identity.callId, false, async () => ({ ...base, sessionId: SessionId('other'), text: 'other session' }))
  expect(other.text).toBe('other session')
})
