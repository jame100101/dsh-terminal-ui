/**
 * Startup resolution helpers for the TUI: exit-code mapping, cwd
 * normalization, turn-boundary reads, and the resume/continue resolvers.
 *
 * Everything here is pure or takes its session corpus as an explicit
 * dependency ({@link ResumeQueryPort}), so the logic is unit-testable without
 * a Cordis context or a real persistence backend. Side effects (exit
 * requests, agent creation, submission) stay in the boot executor in
 * `index.ts`.
 *
 * @module @deepseek-ai/dsh-tui/src/startup
 */

import { resolve, sep } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader, TurnEndReason } from '@deepseek-ai/dsh-session'
import { sessionTitlesById } from './settings-data'
import type { TitleObservationResult } from './settings-data'

/** Exit code for a completed run. */
export const EXIT_OK = 0
/** Exit code for an ordinary execution failure. */
export const EXIT_FAILURE = 1
/** Exit code for a CLI usage error (conflicting flags, unknown target). */
export const EXIT_USAGE = 2
/** Exit code for a user interrupt (SIGINT convention; the launcher owns the signal path). */
export const EXIT_INTERRUPT = 130

/** The session-query surface the resolvers need — a structural port over the real engine for test fakes. */
export interface ResumeQueryPort {
  /** Read one session's validated raw log by exact id; rejects when the id is unknown or unreadable. */
  readSession(id: SessionId): Promise<{ session: SessionHeader; events: readonly SessionEvent[] }>
  /** List the corpus records, newest-aware ordering unspecified. */
  listSessions(): Promise<readonly SessionRecordLike[]>
  /** Read the folded titles for the given ids, one observation per id in input order. */
  readTitleSnapshots(ids: readonly SessionId[]): Promise<readonly TitleObservationResult[]>
}

/** The session-query record fields the resolvers read. */
export interface SessionRecordLike {
  /** The session's creation header (id, cwd, createdAt, lineage). */
  header: SessionHeader
  /** Whether the id currently exists in `ctx.sessions`. */
  live: boolean
  /** Whether the persistence backend currently materializes the id. */
  persisted: boolean
}

/** One resume candidate shown when a query matches more than one session. */
export interface ResumeCandidate {
  /** The session id to resume. */
  id: SessionId
  /** The folded title, when the corpus has one. */
  title?: string
  /** The session's working directory, when recorded. */
  cwd?: string
  /** Session creation time, Unix epoch milliseconds. */
  createdAt: number
}

/** The outcome of resolving a resume query. */
export type ResumeResolution =
  | { kind: 'unique'; id: SessionId }
  | { kind: 'none' }
  | { kind: 'ambiguous'; candidates: readonly ResumeCandidate[] }

/**
 * Normalize a working-directory path for equality: resolve it, strip one
 * trailing separator, and fold case on Windows (drive letters and path case
 * are cosmetic there). Both sides of every cwd comparison must pass through
 * this function.
 * @param path - the path to normalize (a session header cwd or `process.cwd()`).
 * @returns the comparable form.
 */
export function normalizeCwd(path: string): string {
  let normalized = resolve(path)
  if (normalized.length > 1 && normalized.endsWith(sep)) normalized = normalized.slice(0, -1)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

/**
 * Map one turn end reason to a process exit code. `completed` succeeds; a
 * user-initiated cancel reports the SIGINT convention; every other reason —
 * including plugin-extended ones — is an ordinary failure. The launcher
 * still owns real signal exit codes.
 * @param reason - the `turn/end` reason.
 * @returns the exit code.
 */
export function mapTurnEndToExitCode(reason: TurnEndReason): number {
  switch (reason.kind) {
    case 'completed': return EXIT_OK
    case 'aborted': return reason.reason.kind === 'user' ? EXIT_INTERRUPT : EXIT_FAILURE
    default: return EXIT_FAILURE
  }
}

/**
 * Read the turn counter of the last closed turn.
 * @param events - session events in log order.
 * @returns the last closed turn, or -1 when none exists.
 */
export function lastTurnNumber(events: readonly SessionEvent[]): number {
  const last = events.findLast(event => event.type === 'turn/end')
  return last === undefined ? -1 : last.data.turn
}

/**
 * The end reason of the first turn closed after `turn`, if any. Print mode
 * submits one task, then reads the new turn's reason to pick its exit code —
 * host-command prompts run no turn and yield `undefined` (success).
 * @param events - the session log after the run settled.
 * @param turn - the turn counter to look past.
 * @returns the new turn's end reason, or undefined when no turn ran.
 */
export function turnEndReasonAfter(events: readonly SessionEvent[], turn: number): TurnEndReason | undefined {
  const found = events.find(event => event.type === 'turn/end' && event.data.turn > turn)
  if (found === undefined || found.type !== 'turn/end') return undefined
  return found.data.reason
}

/**
 * Resolve one `--resume` query against the corpus, newest-first on ties. The
 * priority ladder is exact full id (through the authoritative `readSession`,
 * which is NOT limited to any listing page size), then id prefix, then
 * case-insensitive title substring. Live sessions are never candidates:
 * they are the current surface's own agents, and resuming one would fork the
 * live state instead of continuing the persisted log.
 * @param query - the session corpus port.
 * @param text - the user's query (id, prefix, or title fragment).
 * @returns the unique target, an ambiguity with display candidates, or none.
 */
export async function resolveResumeTarget(query: ResumeQueryPort, text: string): Promise<ResumeResolution> {
  try {
    await query.readSession(SessionId(text))
    return { kind: 'unique', id: SessionId(text) }
  } catch {
    // Not a readable full id — fall through to prefix and title matching.
  }
  const records = await query.listSessions()
  const persisted = records.filter(record => record.persisted && !record.live)
  const titles = sessionTitlesById(await query.readTitleSnapshots(persisted.map(record => record.header.id)))
  const candidate = (record: SessionRecordLike): ResumeCandidate => {
    const title = titles.get(String(record.header.id))
    return {
      id: record.header.id,
      createdAt: record.header.createdAt,
      ...(record.header.cwd === undefined ? {} : { cwd: record.header.cwd }),
      ...(title === undefined ? {} : { title }),
    }
  }
  const byPrefix = persisted.filter(record => String(record.header.id).startsWith(text))
  const firstPrefix = byPrefix[0]
  if (byPrefix.length === 1 && firstPrefix !== undefined) return { kind: 'unique', id: firstPrefix.header.id }
  if (byPrefix.length > 1) return { kind: 'ambiguous', candidates: byPrefix.map(candidate).toSorted((a, b) => b.createdAt - a.createdAt) }
  const needle = text.toLowerCase()
  const byTitle = persisted.filter(record => (titles.get(String(record.header.id)) ?? '').toLowerCase().includes(needle))
  const firstTitle = byTitle[0]
  if (byTitle.length === 1 && firstTitle !== undefined) return { kind: 'unique', id: firstTitle.header.id }
  if (byTitle.length > 1) return { kind: 'ambiguous', candidates: byTitle.map(candidate).toSorted((a, b) => b.createdAt - a.createdAt) }
  return { kind: 'none' }
}

/**
 * Compute the fork cut for a session log: the seed length a fork inherits —
 * everything up to and including the anchored turn's closing `turn/end` and
 * any trailing non-turn events, ending before the next `turn/start`. The
 * cut index doubles as the seed's event count because sequence numbers are
 * contiguous from 1. Null when no completed turn exists to fork from.
 * @param events - the session log, oldest first.
 * @param atSeq - anchor the cut to the turn containing this event seq; beyond the log means "the last completed turn".
 * @returns the seed length (`events.slice(0, cut)`), or null.
 */
export function forkCutPoint(events: readonly SessionEvent[], atSeq?: number): number | null {
  const lastSeq = events.at(-1)?.seq ?? -1
  const anchored = atSeq === undefined ? undefined : events.find(event => event.type === 'turn/end' && event.seq >= atSeq)
  const boundary = anchored ?? (atSeq === undefined || atSeq > lastSeq ? events.findLast(event => event.type === 'turn/end') : undefined)
  if (boundary === undefined) return null
  let cut = boundary.seq + 1
  while (cut < events.length && events[cut]?.type !== 'turn/start') cut++
  return cut
}

/**
 * Find the newest resumable persisted session created in `cwd`. Falling
 * back to a session from another directory would silently resume the wrong
 * project, so no match yields `null` and the caller fails loud.
 * @param query - the session corpus port.
 * @param cwd - the current working directory to match.
 * @returns the newest matching session id, or null when none matches.
 */
export async function resolveContinueSession(query: ResumeQueryPort, cwd: string): Promise<SessionId | null> {
  const records = await query.listSessions()
  const target = normalizeCwd(cwd)
  const matches = records
    .filter(record => record.persisted && !record.live && record.header.cwd !== undefined && normalizeCwd(record.header.cwd) === target)
    .toSorted((left, right) => right.header.createdAt - left.header.createdAt)
  return matches[0]?.header.id ?? null
}
