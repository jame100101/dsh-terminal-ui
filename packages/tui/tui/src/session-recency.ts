/**
 * TUI-owned most-recently-used session navigation state.
 *
 * The sidecar is separate from the authoritative session log: opening a
 * session is a surface action, not model-visible history. Atomic replacement
 * keeps readers lock-free, while a writer lock protects cross-process
 * read-modify-write updates.
 *
 * @module @deepseek-ai/dsh-tui/src/session-recency
 */

import { readFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import { normalizeCwd } from './startup'

/** Current on-disk format of the disposable TUI navigation sidecar. */
const FORMAT_VERSION = 1

/** One exact session lifecycle's last foreground-use observation. */
export interface SessionRecencyRecord {
  /** Durable session id. */
  readonly sessionId: string
  /** Session creation time, which disambiguates a reused id. */
  readonly createdAt: number
  /** Normalized creation working directory used by `--continue`. */
  readonly cwd: string
  /** Monotonic wall-clock-derived foreground-use order. */
  readonly lastUsedAt: number
}

interface SessionRecencyDocument {
  readonly formatVersion: typeof FORMAT_VERSION
  readonly entries: readonly SessionRecencyRecord[]
}

/** Callback for a sidecar read or write fault that must not stop the TUI. */
export type SessionRecencyErrorReporter = (error: unknown) => void

/** Whether one filesystem failure means the sidecar has not been created yet. */
function isAbsent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

/** Whether a value is a non-negative safe integer timestamp. */
function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/**
 * Encode the exact identity of one persisted session lifecycle.
 * @param record - session id, creation time, and normalized cwd.
 * @returns a collision-safe map key for those three fields.
 */
export function sessionRecencyKey(record: Pick<SessionRecencyRecord, 'sessionId' | 'createdAt' | 'cwd'>): string {
  return JSON.stringify([record.sessionId, record.createdAt, record.cwd])
}

/** Normalize, deduplicate, and newest-sort validated records. */
function normalizeEntries(entries: readonly SessionRecencyRecord[]): SessionRecencyRecord[] {
  const byLifecycle = new Map<string, SessionRecencyRecord>()
  for (const entry of entries) {
    const normalized = { ...entry, cwd: normalizeCwd(entry.cwd) }
    const key = sessionRecencyKey(normalized)
    const previous = byLifecycle.get(key)
    if (previous === undefined || normalized.lastUsedAt > previous.lastUsedAt) byLifecycle.set(key, normalized)
  }
  return [...byLifecycle.values()].toSorted((left, right) => (
    right.lastUsedAt - left.lastUsedAt
    || right.createdAt - left.createdAt
    || left.sessionId.localeCompare(right.sessionId)
  ))
}

/** Parse and validate the complete sidecar document. */
function parseDocument(text: string): SessionRecencyDocument {
  const value: unknown = JSON.parse(text)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('tui session recency document must be an object')
  }
  const document = value as { formatVersion?: unknown; entries?: unknown }
  if (document.formatVersion !== FORMAT_VERSION || !Array.isArray(document.entries)) {
    throw new TypeError(`tui session recency document must use formatVersion ${FORMAT_VERSION}`)
  }
  const entries = document.entries.map((entry, index): SessionRecencyRecord => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new TypeError(`tui session recency entry ${index} must be an object`)
    }
    const record = entry as { sessionId?: unknown; createdAt?: unknown; cwd?: unknown; lastUsedAt?: unknown }
    if (typeof record.sessionId !== 'string' || record.sessionId.length === 0
      || typeof record.cwd !== 'string' || record.cwd.length === 0
      || !isTimestamp(record.createdAt) || !isTimestamp(record.lastUsedAt)) {
      throw new TypeError(`tui session recency entry ${index} has invalid fields`)
    }
    return {
      sessionId: record.sessionId,
      createdAt: record.createdAt,
      cwd: record.cwd,
      lastUsedAt: record.lastUsedAt,
    }
  })
  return { formatVersion: FORMAT_VERSION, entries: normalizeEntries(entries) }
}

/**
 * Bounded file-backed recency index for foreground TUI sessions.
 *
 * Read failures degrade only navigation order. Writes are queued in-process
 * and serialized across processes; each commit re-reads the current file
 * while holding its writer lock, merges one lifecycle, prunes oldest records,
 * and atomically replaces the document. A malformed file is reported and
 * rebuilt on the next successful touch because this index is derived UI state.
 */
export class SessionRecencyStore {
  private pending: Promise<void> = Promise.resolve()

  /**
   * @param path - absolute sidecar filename.
   * @param maxEntries - maximum lifecycle observations retained after a write.
   * @param reportError - diagnostic sink for recoverable sidecar faults.
   */
  constructor(
    private readonly path: string,
    private readonly maxEntries: number,
    private readonly reportError: SessionRecencyErrorReporter,
  ) {}

  /** Read the newest complete sidecar without taking the writer lock. */
  private async load(): Promise<readonly SessionRecencyRecord[]> {
    try {
      return parseDocument(await readFile(this.path, 'utf8')).entries
    } catch (error) {
      if (isAbsent(error)) return []
      throw error
    }
  }

  /**
   * Read the last committed records; a broken sidecar contributes no ordering evidence.
   * @returns validated lifecycle observations in newest-first order.
   */
  async read(): Promise<readonly SessionRecencyRecord[]> {
    await this.pending
    try {
      return await this.load()
    } catch (error) {
      this.reportError(error)
      return []
    }
  }

  /**
   * Queue a foreground-use observation. Headers without a cwd cannot
   * participate in cwd-scoped continuation and therefore add no record.
   * @param header - active session header after a successful foreground action.
   * @param observedAt - wall-clock observation used as the lower bound for ordering.
   */
  touch(header: SessionHeader, observedAt: number = Date.now()): void {
    if (header.cwd === undefined) return
    const candidate = {
      sessionId: String(header.id),
      createdAt: header.createdAt,
      cwd: normalizeCwd(header.cwd),
    }
    this.pending = this.pending.then(async () => {
      if (!isTimestamp(observedAt)) throw new TypeError('tui session recency observation must be a non-negative safe integer')
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
      await withFileLock(this.path, async () => {
        let entries: readonly SessionRecencyRecord[]
        try {
          entries = await this.load()
        } catch (error) {
          this.reportError(error)
          entries = []
        }
        const previousMaximum = entries[0]?.lastUsedAt ?? -1
        const lastUsedAt = Math.max(observedAt, previousMaximum + 1)
        const key = sessionRecencyKey(candidate)
        const merged = normalizeEntries([
          { ...candidate, lastUsedAt },
          ...entries.filter(entry => sessionRecencyKey(entry) !== key),
        ]).slice(0, this.maxEntries)
        const document: SessionRecencyDocument = { formatVersion: FORMAT_VERSION, entries: merged }
        await writeFileAtomic(this.path, `${JSON.stringify(document, undefined, 2)}\n`, {
          mode: 0o600,
          dirMode: 0o700,
        })
      })
    }).catch((error: unknown) => { this.reportError(error) })
  }

  /** Wait until every queued write has either committed or reported its fault. */
  async drain(): Promise<void> {
    await this.pending
  }
}
