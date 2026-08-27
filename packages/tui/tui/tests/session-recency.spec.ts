import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import { SessionRecencyStore } from '../src/session-recency'
import { normalizeCwd } from '../src/startup'

/** Run one assertion against an isolated recency sidecar path. */
async function withSidecar(
  run: (path: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-tui-recency-'))
  try {
    await run(join(directory, 'tui', 'session-recency.json'))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

/** Minimal session lifecycle header. */
function header(id: string, createdAt: number, cwd?: string): SessionHeader {
  return { version: 0, id: SessionId(id), createdAt, ...(cwd === undefined ? {} : { cwd }) }
}

describe('SessionRecencyStore', () => {
  it('treats a missing sidecar as an empty index', async () => {
    await withSidecar(async (path) => {
      const faults: unknown[] = []
      const store = new SessionRecencyStore(path, 10, error => faults.push(error))
      expect(await store.read()).toEqual([])
      expect(faults).toEqual([])
    })
  })

  it('writes normalized lifecycle records and moves a retouched session to the front', async () => {
    await withSidecar(async (path) => {
      const store = new SessionRecencyStore(path, 10, () => {})
      store.touch(header('first', 1, join('work', 'first')), 100)
      store.touch(header('second', 2, join('work', 'second')), 100)
      store.touch(header('first', 1, join('work', 'first')), 100)
      await store.drain()

      expect(await store.read()).toEqual([
        { sessionId: 'first', createdAt: 1, cwd: normalizeCwd(join('work', 'first')), lastUsedAt: 102 },
        { sessionId: 'second', createdAt: 2, cwd: normalizeCwd(join('work', 'second')), lastUsedAt: 101 },
      ])
      expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ formatVersion: 1 })
    })
  })

  it('merges writers through the shared file lock and retains a bounded newest set', async () => {
    await withSidecar(async (path) => {
      const first = new SessionRecencyStore(path, 2, () => {})
      const second = new SessionRecencyStore(path, 2, () => {})
      first.touch(header('one', 1, '/work'), 100)
      await first.drain()
      second.touch(header('two', 2, '/work'), 200)
      await second.drain()
      first.touch(header('three', 3, '/work'), 300)
      await first.drain()

      expect((await second.read()).map(entry => entry.sessionId)).toEqual(['three', 'two'])
    })
  })

  it('reports malformed content and rebuilds the disposable index on touch', async () => {
    await withSidecar(async (path) => {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, '{broken', 'utf8')
      const faults: unknown[] = []
      const store = new SessionRecencyStore(path, 10, error => faults.push(error))
      expect(await store.read()).toEqual([])
      store.touch(header('recovered', 1, '/work'), 100)
      await store.drain()
      expect((await store.read()).map(entry => entry.sessionId)).toEqual(['recovered'])
      expect(faults).toHaveLength(2)
    })
  })

  it('does not persist a header that has no cwd', async () => {
    await withSidecar(async (path) => {
      const store = new SessionRecencyStore(path, 10, () => {})
      store.touch(header('locationless', 1), 100)
      await store.drain()
      expect(await store.read()).toEqual([])
    })
  })
})
