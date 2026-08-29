import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader, TurnEndReason } from '@deepseek-ai/dsh-session'
import { renderAssistantResultPlain } from '../src/plain'
import type { TuiNode } from '../src/types'
import {
  EXIT_FAILURE, EXIT_INTERRUPT, EXIT_OK, EXIT_USAGE, forkCutPoint, lastTurnNumber, mapTurnEndToExitCode,
  normalizeCwd, resolveContinueSession, resolveResumeTarget, turnEndReasonAfter,
} from '../src/startup'
import type { ResumeQueryPort, SessionRecordLike } from '../src/startup'
import type { SessionRecencyRecord } from '../src/session-recency'

/** A minimal session header fixture. */
function header(id: string, createdAt: number, cwd?: string): SessionHeader {
  return { version: 0, id: SessionId(id), createdAt, ...(cwd === undefined ? {} : { cwd }) }
}

/** A minimal corpus record fixture. */
function record(
  id: string,
  createdAt: number,
  cwd?: string,
  flags: { live?: boolean; persisted?: boolean; origin?: 'subagent' } = {},
): SessionRecordLike {
  return {
    header: { ...header(id, createdAt, cwd), ...(flags.origin === undefined ? {} : { origin: flags.origin }) },
    live: flags.live ?? false,
    persisted: flags.persisted ?? true,
  }
}

/** One TUI foreground-use fixture. */
function used(id: string, createdAt: number, cwd: string, lastUsedAt: number): SessionRecencyRecord {
  return { sessionId: id, createdAt, cwd: normalizeCwd(cwd), lastUsedAt }
}

/**
 * A fake query port: `records` feed `listSessions` (titles are `title-<i>`),
 * `extras` exist only for `readSession` — they model persisted sessions
 * older than any UI listing page, which exact-id resume must still reach.
 */
function fakeQuery(records: readonly SessionRecordLike[], extras: readonly SessionRecordLike[] = []): ResumeQueryPort {
  const titles = new Map(records.map((entry, index) => [String(entry.header.id), `title-${index}`]))
  const readable = [...records, ...extras]
  return {
    async readSession(id) {
      const found = readable.find(entry => entry.header.id === id)
      if (found === undefined) throw new Error(`not found: ${String(id)}`)
      return { session: found.header, events: [] }
    },
    async listSessions() {
      return records
    },
    async readTitleSnapshots(ids) {
      return ids.map(id => ({
        sessionId: String(id),
        status: 'fulfilled' as const,
        value: { title: { title: titles.get(String(id)) ?? '' } },
      }))
    },
  }
}

/** A minimal turn/end event fixture (seq is the 0-based index). */
function endEvent(turn: number, reason: TurnEndReason): SessionEvent {
  return { type: 'turn/end', data: { turn, reason } } as unknown as SessionEvent
}

/** A minimal typed event fixture for fork-cut arithmetic. */
function typedEvent(seq: number, type: string): SessionEvent {
  return { seq, type } as unknown as SessionEvent
}

describe('normalizeCwd', () => {
  it('resolves relative paths and strips trailing separators', () => {
    expect(normalizeCwd('a/b/')).toBe(normalizeCwd('a/b'))
    expect(normalizeCwd('.')).toBe(normalizeCwd(normalizeCwd('.')))
  })

  it.skipIf(process.platform !== 'win32')('folds Windows path case', () => {
    expect(normalizeCwd('C:\\Work\\Project')).toBe(normalizeCwd('c:\\work\\project'))
  })
})

describe('mapTurnEndToExitCode', () => {
  it('maps completed to success and user aborts to the SIGINT convention', () => {
    expect(mapTurnEndToExitCode({ kind: 'completed' })).toBe(EXIT_OK)
    expect(mapTurnEndToExitCode({ kind: 'aborted', reason: { kind: 'user' } })).toBe(EXIT_INTERRUPT)
  })

  it('maps non-user aborts and every failure to the failure code', () => {
    expect(mapTurnEndToExitCode({ kind: 'aborted', reason: { kind: 'parent' } })).toBe(EXIT_FAILURE)
    expect(mapTurnEndToExitCode({ kind: 'error', error: { message: 'x', code: 'UNKNOWN' } })).toBe(EXIT_FAILURE)
    expect(mapTurnEndToExitCode({ kind: 'blocked' })).toBe(EXIT_FAILURE)
    expect(mapTurnEndToExitCode({ kind: 'max-tokens' })).toBe(EXIT_FAILURE)
    expect(mapTurnEndToExitCode({ kind: 'interrupted' })).toBe(EXIT_FAILURE)
  })

  it('falls through plugin-extended reasons to the failure code', () => {
    expect(mapTurnEndToExitCode({ kind: 'quota-exceeded' } as unknown as TurnEndReason)).toBe(EXIT_FAILURE)
  })
})

describe('turn boundary helpers', () => {
  it('lastTurnNumber reads the last closed turn or -1 for an empty log', () => {
    expect(lastTurnNumber([])).toBe(-1)
    expect(lastTurnNumber([endEvent(1, { kind: 'completed' }), endEvent(2, { kind: 'completed' })])).toBe(2)
  })

  it('turnEndReasonAfter finds the first turn closed after the anchor', () => {
    const events = [
      endEvent(1, { kind: 'completed' }),
      endEvent(2, { kind: 'error', error: { message: 'x', code: 'UNKNOWN' } }),
    ]
    expect(turnEndReasonAfter(events, 1)?.kind).toBe('error')
    expect(turnEndReasonAfter(events, 2)).toBeUndefined()
    expect(turnEndReasonAfter([], -1)).toBeUndefined()
  })
})

describe('forkCutPoint', () => {
  it('cuts at the log end when it ends on a completed turn', () => {
    const events = [typedEvent(0, 'turn/start'), typedEvent(1, 'turn/end')]
    expect(forkCutPoint(events)).toBe(2)
  })

  it('stops before the next turn/start after the boundary', () => {
    const events = [typedEvent(0, 'turn/start'), typedEvent(1, 'turn/end'), typedEvent(2, 'turn/start')]
    expect(forkCutPoint(events)).toBe(2)
  })

  it('includes trailing non-turn events after the boundary', () => {
    const events = [typedEvent(0, 'turn/start'), typedEvent(1, 'turn/end'), typedEvent(2, 'status'), typedEvent(3, 'turn/start')]
    expect(forkCutPoint(events)).toBe(3)
  })

  it('returns null when no completed turn exists', () => {
    expect(forkCutPoint([typedEvent(0, 'turn/start')])).toBeNull()
    expect(forkCutPoint([])).toBeNull()
  })

  it('anchors atSeq to the turn containing it', () => {
    const events = [
      typedEvent(0, 'turn/start'), typedEvent(1, 'turn/end'),
      typedEvent(2, 'turn/start'), typedEvent(3, 'turn/end'),
    ]
    expect(forkCutPoint(events, 2)).toBe(4)
    expect(forkCutPoint(events, 1)).toBe(2)
  })

  it('treats an atSeq beyond the log as the last completed turn', () => {
    const events = [typedEvent(0, 'turn/start'), typedEvent(1, 'turn/end')]
    expect(forkCutPoint(events, 99)).toBe(2)
  })
})

describe('resolveResumeTarget', () => {
  it('resolves an exact full id even when the listing does not include it', async () => {
    const query = fakeQuery([record('session-recent', 3, '/recent')], [record('session-old', 1, '/old')])
    expect(await resolveResumeTarget(query, 'session-old')).toEqual({ kind: 'unique', id: SessionId('session-old') })
  })

  it('resolves a unique id prefix', async () => {
    const query = fakeQuery([record('session-aaa', 1, '/a'), record('other-1', 2, '/b')])
    expect(await resolveResumeTarget(query, 'session-a')).toEqual({ kind: 'unique', id: SessionId('session-aaa') })
  })

  it('reports ambiguous id prefixes newest-first with display facts', async () => {
    const query = fakeQuery([record('session-aaa', 1, '/a'), record('session-aab', 3, '/b'), record('other-1', 2, '/c')])
    expect(await resolveResumeTarget(query, 'session-a')).toEqual({
      kind: 'ambiguous',
      candidates: [
        { id: SessionId('session-aab'), title: 'title-1', cwd: '/b', createdAt: 3 },
        { id: SessionId('session-aaa'), title: 'title-0', cwd: '/a', createdAt: 1 },
      ],
    })
  })

  it('falls through to a unique case-insensitive title match', async () => {
    const query = fakeQuery([record('session-aaa', 1, '/a'), record('session-bbb', 2, '/b')])
    expect(await resolveResumeTarget(query, 'TITLE-0')).toEqual({ kind: 'unique', id: SessionId('session-aaa') })
  })

  it('reports ambiguous title matches', async () => {
    const query = fakeQuery([record('session-aaa', 1, '/a'), record('session-bbb', 2, '/b')])
    const resolution = await resolveResumeTarget(query, 'title')
    expect(resolution.kind).toBe('ambiguous')
    if (resolution.kind === 'ambiguous') expect(resolution.candidates).toHaveLength(2)
  })

  it('reports none for an unmatched query', async () => {
    expect(await resolveResumeTarget(fakeQuery([record('session-aaa', 1, '/a')]), 'nothing')).toEqual({ kind: 'none' })
  })

  it('never treats live sessions or non-persisted records as candidates', async () => {
    const query = fakeQuery([
      record('session-live', 9, '/a', { live: true }),
      record('session-gone', 8, '/a', { persisted: false }),
      record('session-aaa', 1, '/a'),
    ])
    expect(await resolveResumeTarget(query, 'session')).toEqual({ kind: 'unique', id: SessionId('session-aaa') })
  })
})

describe('resolveContinueSession', () => {
  it('migrates an untracked directory by newest top-level creation time', async () => {
    const query = fakeQuery([
      record('a-old', 100, '/work'),
      record('a-new', 200, '/work'),
      record('b-newest', 300, '/other'),
    ])
    expect(await resolveContinueSession(query, '/work')).toBe(SessionId('a-new'))
  })

  it('prefers last foreground use over creation time', async () => {
    const query = fakeQuery([
      record('older-used-last', 100, '/work'),
      record('newer-used-first', 200, '/work'),
      record('untracked-newest', 300, '/work'),
    ])
    const recency = [
      used('newer-used-first', 200, '/work', 400),
      used('older-used-last', 100, '/work', 500),
    ]
    expect(await resolveContinueSession(query, '/work', recency)).toBe(SessionId('older-used-last'))
  })

  it('ignores stale lifecycle and other-directory observations', async () => {
    const query = fakeQuery([
      record('same-id', 200, '/work'),
      record('fallback', 100, '/work'),
    ])
    const recency = [
      used('same-id', 199, '/work', 900),
      used('same-id', 200, '/other', 800),
    ]
    expect(await resolveContinueSession(query, '/work', recency)).toBe(SessionId('same-id'))
  })

  it('excludes untouched subagents from migration fallback', async () => {
    const query = fakeQuery([
      record('child-newest', 300, '/work', { origin: 'subagent' }),
      record('foreground', 100, '/work'),
    ])
    expect(await resolveContinueSession(query, '/work')).toBe(SessionId('foreground'))
    expect(await resolveContinueSession(fakeQuery([
      record('child-only', 300, '/work', { origin: 'subagent' }),
    ]), '/work')).toBeNull()
  })

  it('includes a subagent after the user explicitly foregrounded it', async () => {
    const query = fakeQuery([
      record('child', 100, '/work', { origin: 'subagent' }),
      record('ordinary', 200, '/work'),
    ])
    expect(await resolveContinueSession(query, '/work', [used('child', 100, '/work', 500)]))
      .toBe(SessionId('child'))
  })

  it('returns null when no session matches the cwd', async () => {
    expect(await resolveContinueSession(fakeQuery([record('b', 300, '/other')]), '/work')).toBeNull()
  })

  it('skips sessions without a recorded cwd and live sessions', async () => {
    const query = fakeQuery([
      record('no-cwd', 500),
      record('live', 600, '/work', { live: true }),
      record('wanted', 100, '/work'),
    ])
    expect(await resolveContinueSession(query, '/work')).toBe(SessionId('wanted'))
  })

  it('matches trailing separators through normalization', async () => {
    const query = fakeQuery([record('wanted', 100, '/work/')])
    expect(await resolveContinueSession(query, '/work')).toBe(SessionId('wanted'))
  })

  it.skipIf(process.platform !== 'win32')('matches Windows paths case-insensitively', async () => {
    const query = fakeQuery([record('wanted', 100, 'C:\\Work\\Project')])
    expect(await resolveContinueSession(query, 'c:\\work\\project')).toBe(SessionId('wanted'))
  })
})

describe('renderAssistantResultPlain', () => {
  it('joins only non-empty assistant texts with no glyphs', () => {
    const nodes: TuiNode[] = [
      { kind: 'user', id: 0, text: 'prompt' },
      { kind: 'assistant', id: 1, text: 'first', messageId: 'm1' },
      { kind: 'think', id: 2, text: 'hidden', durationMs: 100 },
      { kind: 'tool', id: 3, callId: 'c3', name: 'bash', text: 'tool output', detail: 'bash', status: 'done', args: {}, callCard: null, resultCard: null },
      { kind: 'assistant', id: 4, text: '', messageId: 'm2' },
      { kind: 'assistant', id: 5, text: 'second', messageId: 'm3' },
    ]
    expect(renderAssistantResultPlain(nodes)).toBe('first\nsecond')
  })

  it('returns an empty string when the run produced no assistant messages', () => {
    expect(renderAssistantResultPlain([])).toBe('')
    expect(renderAssistantResultPlain([{ kind: 'user', id: 0, text: 'prompt' }])).toBe('')
  })
})

describe('exit code constants', () => {
  it('keep the CLI convention stable', () => {
    expect(EXIT_OK).toBe(0)
    expect(EXIT_FAILURE).toBe(1)
    expect(EXIT_USAGE).toBe(2)
    expect(EXIT_INTERRUPT).toBe(130)
  })
})
