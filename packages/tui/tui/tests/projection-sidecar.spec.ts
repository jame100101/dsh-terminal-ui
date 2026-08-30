import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { initialState } from '../src/fold'
import type { FoldState } from '../src/types'
import {
  MAX_SIDECAR_BYTES, PROJECTION_VERSION, ProjectionSidecarStore, foldIsIdle, parseProjectionSidecar,
  projectionCheckpointIsComplete, projectionSidecarFileName,
} from '../src/projection-sidecar'

async function withDir(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-tui-projection-'))
  try {
    await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function header(id: string, createdAt: number): SessionHeader {
  return { version: 0, id: SessionId(id), createdAt, cwd: '/work' }
}

function idleFold(nodes: FoldState['nodes'] = []): FoldState {
  return { ...initialState(), nodes }
}

describe('projection sidecar', () => {
  it('accepts only prefixes outside an active turn', () => {
    const turnStart = { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } } as SessionEvent
    const todo = { type: 'todo/write', seq: 2, time: 2, data: { todos: [] } } as SessionEvent
    const turnEnd = { type: 'turn/end', seq: 3, time: 3, data: { turn: 1, reason: { kind: 'completed' } } } as SessionEvent
    expect(projectionCheckpointIsComplete([])).toBe(true)
    expect(projectionCheckpointIsComplete([turnStart, todo])).toBe(false)
    expect(projectionCheckpointIsComplete([turnStart, todo, turnEnd])).toBe(true)
  })

  it('round-trips an idle fold and rejects a mismatched lifecycle', async () => {
    await withDir(async (directory) => {
      const store = new ProjectionSidecarStore(directory, () => {})
      const fold = idleFold([{ kind: 'user', id: 3, text: 'hello' }])
      store.write(header('sess-1', 10), 3, fold)
      await store.drain()
      const hit = await store.read('sess-1', 10)
      expect(hit?.lastSeq).toBe(3)
      expect(hit?.fold.nodes).toEqual(fold.nodes)
      expect(await store.read('sess-1', 99)).toBeNull()
      expect(projectionSidecarFileName('sess/1')).toBe('sess_1.json')
    })
  })

  it('skips writes while a tool is running', async () => {
    await withDir(async (directory) => {
      const store = new ProjectionSidecarStore(directory, () => {})
      const running: FoldState = idleFold([{
        kind: 'tool',
        id: 1,
        callId: 'c1',
        name: 'bash',
        detail: 'bash',
        status: 'running',
        text: '',
        args: {},
        callCard: null,
        resultCard: null,
      }])
      expect(foldIsIdle(running)).toBe(false)
      store.write(header('sess-1', 10), 1, running)
      await store.drain()
      expect(await store.read('sess-1', 10)).toBeNull()
    })
  })

  it('reports a corrupt file and returns null', async () => {
    await withDir(async (directory) => {
      const path = join(directory, projectionSidecarFileName('sess-1'))
      await writeFile(path, '{broken', 'utf8')
      const faults: unknown[] = []
      const store = new ProjectionSidecarStore(directory, error => faults.push(error))
      expect(await store.read('sess-1', 10)).toBeNull()
      expect(faults.length).toBeGreaterThan(0)
    })
  })

  it('rejects an oversized document', () => {
    expect(() => parseProjectionSidecar('x'.repeat(MAX_SIDECAR_BYTES + 1))).toThrow(/size cap/u)
  })

  it('rejects a projection written before cost entered the persisted fold', () => {
    expect(() => parseProjectionSidecar(JSON.stringify({
      formatVersion: 1,
      projectionVersion: PROJECTION_VERSION - 1,
      sessionId: 'sess-1',
      createdAt: 10,
      lastSeq: 0,
      fold: initialState(),
    }))).toThrow(`projectionVersion ${PROJECTION_VERSION}`)
  })

  it('writes the current projection version', async () => {
    await withDir(async (directory) => {
      const store = new ProjectionSidecarStore(directory, () => {})
      store.write(header('sess-1', 10), 0, idleFold())
      await store.drain()
      const raw = JSON.parse(await readFile(join(directory, 'sess-1.json'), 'utf8')) as { projectionVersion: number }
      expect(raw.projectionVersion).toBe(PROJECTION_VERSION)
    })
  })
})
