/**
 * TUI-owned fold projection sidecar. Resume can seed its background replay
 * from this cache, fold only the log suffix, then publish the completed fold.
 * Official session JSONL and SQLite stay read-only; a corrupt or
 * version-mismatched file falls back to a full TUI fold.
 * @module @deepseek-ai/dsh-tui/src/projection-sidecar
 */

import { readFile, mkdir, readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { initialState } from './fold'
import type { FoldState, GoalRow, LiveBuffer, PlanState, SessionStats, TodoItem, TraceEntry, TuiNode } from './types'

/** On-disk document version. Raise when the file wrapper changes. */
export const SIDECAR_FORMAT_VERSION = 1
/** Fold projection version. Raise when TuiNode/FoldState fields change. */
export const PROJECTION_VERSION = 1
/** Refuse to persist a sidecar larger than this. */
export const MAX_SIDECAR_BYTES = 4_000_000
/** Oldest projection files dropped after a successful write. */
const MAX_SIDECAR_FILES = 64

/** Callback for a sidecar read or write fault that must not stop the TUI. */
export type ProjectionSidecarErrorReporter = (error: unknown) => void

/** One validated on-disk projection. */
export interface ProjectionSidecarRecord {
  readonly formatVersion: typeof SIDECAR_FORMAT_VERSION
  readonly projectionVersion: typeof PROJECTION_VERSION
  readonly sessionId: string
  readonly createdAt: number
  readonly lastSeq: number
  readonly fold: FoldState
}

interface PendingProjectionWrite {
  readonly header: SessionHeader
  readonly lastSeq: number
  readonly fold: FoldState
}

/**
 * Determine whether a fold has no in-flight live, tool, or compaction work.
 * @param fold - Current TUI fold.
 * @returns Whether it is safe to persist as a replay checkpoint.
 */
export function foldIsIdle(fold: FoldState): boolean {
  if (fold.live !== null || fold.compaction) return false
  return !fold.nodes.some(node => node.kind === 'tool' && node.status === 'running')
}

/**
 * Whether the latest turn in an event prefix has reached `turn/end`.
 * A sidecar resumes with fresh FoldScratch state, so a prefix cut inside a
 * turn would lose step timing, tool starts, and per-turn deliverables.
 * @param events - authoritative session prefix in sequence order.
 * @returns true before the first turn or after the latest turn ended.
 */
export function projectionCheckpointIsComplete(events: readonly SessionEvent[]): boolean {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'turn/end') return true
    if (event?.type === 'turn/start') return false
  }
  return true
}

/**
 * Build a filesystem-safe projection filename from a session id.
 * @param sessionId - Durable session id.
 * @returns A bounded `.json` filename.
 */
export function projectionSidecarFileName(sessionId: string): string {
  const stem = sessionId.replace(/[^A-Za-z0-9._-]/gu, '_').slice(0, 120)
  return `${stem === '' ? 'session' : stem}.json`
}

function isAbsent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

function isSafeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`)
  return value
}

function requireId(value: unknown, label: string): number {
  if (!isSafeInt(value)) throw new TypeError(`${label} must be a safe integer`)
  return value
}

function parseTodo(value: unknown, index: number): TodoItem {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`todo ${index} must be an object`)
  }
  const row = value as { content?: unknown; status?: unknown }
  if (row.status !== 'pending' && row.status !== 'in_progress' && row.status !== 'completed') {
    throw new TypeError(`todo ${index} has an invalid status`)
  }
  return { content: requireString(row.content, `todo ${index} content`), status: row.status }
}

function parseTrace(value: unknown, index: number): TraceEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`trace ${index} must be an object`)
  }
  const row = value as { id?: unknown; text?: unknown }
  return { id: requireId(row.id, `trace ${index} id`), text: requireString(row.text, `trace ${index} text`) }
}

function parsePlan(value: unknown): PlanState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('plan must be an object')
  }
  const row = value as { active?: unknown; pending?: unknown }
  if (typeof row.active !== 'boolean' || typeof row.pending !== 'boolean') {
    throw new TypeError('plan.active and plan.pending must be booleans')
  }
  return { active: row.active, pending: row.pending }
}

function parseTokens(value: unknown): SessionStats['tokens'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('stats.tokens must be an object')
  }
  const row = value as Record<string, unknown>
  const read = (key: string): number => {
    const item = row[key]
    if (!isFiniteNumber(item)) throw new TypeError(`stats.tokens.${key} must be a number`)
    return item
  }
  return {
    input: read('input'),
    output: read('output'),
    cacheRead: read('cacheRead'),
    cacheWrite: read('cacheWrite'),
    reasoning: read('reasoning'),
  }
}

function parseStats(value: unknown): SessionStats {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('stats must be an object')
  }
  const row = value as Record<string, unknown>
  const read = (key: string): number => {
    const item = row[key]
    if (!isFiniteNumber(item)) throw new TypeError(`stats.${key} must be a number`)
    return item
  }
  return {
    turns: read('turns'),
    steps: read('steps'),
    llmMs: read('llmMs'),
    toolMs: read('toolMs'),
    ttftMs: read('ttftMs'),
    stepsWithTtft: read('stepsWithTtft'),
    decodeMs: read('decodeMs'),
    tokens: parseTokens(row.tokens),
    contextWindow: read('contextWindow'),
  }
}

function parseLive(value: unknown): LiveBuffer | null {
  if (value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) throw new TypeError('live must be an object or null')
  const row = value as { text?: unknown; think?: unknown; thinkSince?: unknown }
  if (row.thinkSince !== null && !isFiniteNumber(row.thinkSince)) {
    throw new TypeError('live.thinkSince must be a number or null')
  }
  return {
    text: requireString(row.text, 'live.text'),
    think: requireString(row.think, 'live.think'),
    thinkSince: row.thinkSince === null ? null : row.thinkSince,
  }
}

function parseGoal(value: unknown): GoalRow | null {
  if (value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) throw new TypeError('goal must be an object or null')
  const row = value as Record<string, unknown>
  if (row.phase !== 'active' && row.phase !== 'paused' && row.phase !== 'blocked' && row.phase !== 'complete') {
    throw new TypeError('goal.phase is invalid')
  }
  const goal: GoalRow = {
    objective: requireString(row.objective, 'goal.objective'),
    phase: row.phase,
    revision: requireId(row.revision, 'goal.revision'),
    roundsStarted: requireId(row.roundsStarted, 'goal.roundsStarted'),
    maxGoalRounds: requireId(row.maxGoalRounds, 'goal.maxGoalRounds'),
    createdAt: requireId(row.createdAt, 'goal.createdAt'),
    updatedAt: requireId(row.updatedAt, 'goal.updatedAt'),
  }
  if (row.blockedReason !== undefined) {
    if (typeof row.blockedReason !== 'object' || row.blockedReason === null || Array.isArray(row.blockedReason)) {
      throw new TypeError('goal.blockedReason must be an object')
    }
    const reason = row.blockedReason as { code?: unknown; message?: unknown }
    goal.blockedReason = {
      code: requireString(reason.code, 'goal.blockedReason.code'),
      message: requireString(reason.message, 'goal.blockedReason.message'),
    }
  }
  return goal
}

function parseNode(value: unknown, index: number): TuiNode {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`node ${index} must be an object`)
  }
  const row = value as Record<string, unknown>
  const id = requireId(row.id, `node ${index} id`)
  switch (row.kind) {
    case 'user':
      return { kind: 'user', id, text: requireString(row.text, `node ${index} text`) }
    case 'context':
      return {
        kind: 'context',
        id,
        text: requireString(row.text, `node ${index} text`),
        producer: requireString(row.producer, `node ${index} producer`),
      }
    case 'assistant':
      return {
        kind: 'assistant',
        id,
        text: requireString(row.text, `node ${index} text`),
        messageId: requireString(row.messageId, `node ${index} messageId`),
        ...(row.interrupted === true ? { interrupted: true as const } : {}),
      }
    case 'deliverables': {
      if (!Array.isArray(row.paths) || row.paths.some(path => typeof path !== 'string')) {
        throw new TypeError(`node ${index} paths must be strings`)
      }
      return { kind: 'deliverables', id, paths: row.paths }
    }
    case 'think':
      return {
        kind: 'think',
        id,
        text: requireString(row.text, `node ${index} text`),
        durationMs: requireId(row.durationMs, `node ${index} durationMs`),
      }
    case 'tool':
      if (row.status !== 'running' && row.status !== 'done' && row.status !== 'error') {
        throw new TypeError(`node ${index} tool status is invalid`)
      }
      return {
        kind: 'tool',
        id,
        callId: requireString(row.callId, `node ${index} callId`),
        name: requireString(row.name, `node ${index} name`),
        ...(typeof row.parentCallId === 'string' ? { parentCallId: row.parentCallId } : {}),
        detail: requireString(row.detail, `node ${index} detail`),
        status: row.status,
        text: requireString(row.text, `node ${index} text`),
        args: row.args,
        callCard: row.callCard ?? null,
        resultCard: row.resultCard ?? null,
      }
    case 'retry': {
      if (typeof row.failure !== 'object' || row.failure === null || Array.isArray(row.failure)) {
        throw new TypeError(`node ${index} retry failure must be an object`)
      }
      const failure = row.failure as { code?: unknown; status?: unknown }
      return {
        kind: 'retry',
        id,
        retryId: requireString(row.retryId, `node ${index} retryId`),
        turn: requireId(row.turn, `node ${index} turn`),
        step: requireId(row.step, `node ${index} step`),
        provider: requireString(row.provider, `node ${index} provider`),
        policyKey: requireString(row.policyKey, `node ${index} policyKey`),
        retry: requireId(row.retry, `node ${index} retry`),
        maxRetries: row.maxRetries === null ? null : requireId(row.maxRetries, `node ${index} maxRetries`),
        delayMs: requireId(row.delayMs, `node ${index} delayMs`),
        retryAt: requireId(row.retryAt, `node ${index} retryAt`),
        started: row.started === true,
        failure: {
          code: requireString(failure.code, `node ${index} failure.code`),
          ...(isSafeInt(failure.status) ? { status: failure.status } : {}),
        },
      }
    }
    case 'status':
      if (typeof row.error !== 'boolean') throw new TypeError(`node ${index} status.error must be a boolean`)
      return { kind: 'status', id, text: requireString(row.text, `node ${index} text`), error: row.error }
    default:
      throw new TypeError(`node ${index} has an unknown kind`)
  }
}

function parseFold(value: unknown): FoldState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('fold must be an object')
  }
  const row = value as Record<string, unknown>
  if (!Array.isArray(row.nodes) || !Array.isArray(row.trace) || !Array.isArray(row.todos)) {
    throw new TypeError('fold.nodes, fold.trace, and fold.todos must be arrays')
  }
  if (typeof row.compaction !== 'boolean') throw new TypeError('fold.compaction must be a boolean')
  const empty = initialState()
  return {
    nodes: row.nodes.map(parseNode),
    trace: row.trace.map(parseTrace),
    todos: row.todos.map(parseTodo),
    live: parseLive(row.live),
    stats: parseStats(row.stats ?? empty.stats),
    plan: parsePlan(row.plan ?? empty.plan),
    goal: parseGoal(row.goal ?? null),
    compaction: row.compaction,
  }
}

/**
 * Parse and validate a sidecar document. Throws on any mismatch.
 * @param text - file contents.
 * @returns the record.
 */
export function parseProjectionSidecar(text: string): ProjectionSidecarRecord {
  if (text.length > MAX_SIDECAR_BYTES) throw new TypeError('tui projection sidecar exceeds the size cap')
  const value: unknown = JSON.parse(text)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('tui projection sidecar must be an object')
  }
  const document = value as Record<string, unknown>
  if (document.formatVersion !== SIDECAR_FORMAT_VERSION) {
    throw new TypeError(`tui projection sidecar must use formatVersion ${SIDECAR_FORMAT_VERSION}`)
  }
  if (document.projectionVersion !== PROJECTION_VERSION) {
    throw new TypeError(`tui projection sidecar must use projectionVersion ${PROJECTION_VERSION}`)
  }
  return {
    formatVersion: SIDECAR_FORMAT_VERSION,
    projectionVersion: PROJECTION_VERSION,
    sessionId: requireString(document.sessionId, 'sessionId'),
    createdAt: requireId(document.createdAt, 'createdAt'),
    lastSeq: requireId(document.lastSeq, 'lastSeq'),
    fold: parseFold(document.fold),
  }
}

/**
 * File-backed TUI fold projection cache, one file per session id.
 * Each session keeps at most one pending write in-process. A newer idle fold
 * supersedes an older pending fold for the same session; read failures return
 * null.
 */
export class ProjectionSidecarStore {
  private readonly queued = new Map<string, PendingProjectionWrite>()
  private pending: Promise<void> | null = null

  /**
   * @param directory - absolute directory for projection files.
   * @param reportError - diagnostic sink for recoverable sidecar faults.
   */
  constructor(
    private readonly directory: string,
    private readonly reportError: ProjectionSidecarErrorReporter,
  ) {}

  private filePath(sessionId: string): string {
    return join(this.directory, projectionSidecarFileName(sessionId))
  }

  /**
   * Read a matching projection, or null when absent, corrupt, or stale.
   * @param sessionId - durable session id.
   * @param createdAt - session header creation time.
   * @returns the record, or null.
   */
  async read(sessionId: string, createdAt: number): Promise<ProjectionSidecarRecord | null> {
    await this.drain()
    try {
      const record = parseProjectionSidecar(await readFile(this.filePath(sessionId), 'utf8'))
      if (record.sessionId !== sessionId || record.createdAt !== createdAt) return null
      return record
    } catch (error) {
      if (!isAbsent(error)) this.reportError(error)
      return null
    }
  }

  /**
   * Queue the newest idle-fold snapshot for a session. Running tools or a
   * live buffer skip the write.
   * @param header - active session header.
   * @param lastSeq - last folded event seq.
   * @param fold - idle fold state.
   */
  write(header: SessionHeader, lastSeq: number, fold: FoldState): void {
    if (!foldIsIdle(fold) || !isSafeInt(lastSeq)) return
    const sessionId = String(header.id)
    this.queued.set(sessionId, { header, lastSeq, fold })
    this.startFlush()
  }

  /** Wait until every queued write has either committed or reported its fault. */
  async drain(): Promise<void> {
    while (this.pending !== null || this.queued.size > 0) {
      this.startFlush()
      const pending = this.pending
      if (pending !== null) await pending
    }
  }

  private startFlush(): void {
    if (this.pending !== null || this.queued.size === 0) return
    this.pending = this.flushQueued()
      .catch((error: unknown) => { this.reportError(error) })
      .finally(() => {
        this.pending = null
        this.startFlush()
      })
  }

  private async flushQueued(): Promise<void> {
    while (this.queued.size > 0) {
      const entry = this.queued.entries().next().value
      if (entry === undefined) return
      const [sessionId, pending] = entry
      this.queued.delete(sessionId)
      const document: ProjectionSidecarRecord = {
        formatVersion: SIDECAR_FORMAT_VERSION,
        projectionVersion: PROJECTION_VERSION,
        sessionId,
        createdAt: pending.header.createdAt,
        lastSeq: pending.lastSeq,
        fold: pending.fold,
      }
      const text = `${JSON.stringify(document)}\n`
      if (text.length > MAX_SIDECAR_BYTES) continue
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      await writeFileAtomic(this.filePath(sessionId), text, { mode: 0o600, dirMode: 0o700 })
      await pruneProjectionFiles(this.directory, this.filePath(sessionId))
    }
  }
}

/** Drop oldest projection files once the directory exceeds the cap. */
async function pruneProjectionFiles(directory: string, keepPath: string): Promise<void> {
  let names: string[]
  try {
    names = await readdir(directory)
  } catch (error) {
    if (isAbsent(error)) return
    throw error
  }
  const files = names.filter(name => name.endsWith('.json')).map(name => join(directory, name))
  if (files.length <= MAX_SIDECAR_FILES) return
  const ranked = await Promise.all(files.map(async (path) => {
    try {
      const text = await readFile(path, 'utf8')
      const record = parseProjectionSidecar(text)
      return { path, createdAt: record.createdAt }
    } catch {
      return { path, createdAt: 0 }
    }
  }))
  ranked.sort((left, right) => right.createdAt - left.createdAt)
  for (const entry of ranked.slice(MAX_SIDECAR_FILES)) {
    if (entry.path === keepPath) continue
    try {
      await unlink(entry.path)
    } catch (error) {
      if (!isAbsent(error)) throw error
    }
  }
}
