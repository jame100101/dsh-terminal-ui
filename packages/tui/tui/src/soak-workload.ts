/**
 * Keyless continuous-session workload for long-task diagnostics. One runner
 * owns one fold, scratch, input parser, and append-only event list for its
 * whole lifetime; advancing it never resets the state being measured.
 * @module @deepseek-ai/dsh-tui/src/soak-workload
 */

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  applyEvent, createScratch, foldResidentChars, initialState, MAX_FOLD_CHARS,
} from './fold'
import type { FoldScratch } from './fold'
import type { FoldState } from './types'
import { wrapComposerRanges } from './viewport'

const require = createRequire(import.meta.url)
const PASTE_START = '\u001B[200~'

/** One cumulative report from a single long-session runner. */
export interface TuiSoakReport {
  readonly rounds: number
  readonly durationMs: number
  readonly foldNodes: number
  readonly foldChars: number
  readonly sessionEvents: number
  readonly sessionBytes: number
  readonly parserPendingPeak: number
  readonly rss: number
  readonly heapUsed: number
  readonly foldCharBudget: number
}

interface InputParser {
  push(chunk: string): unknown[]
  pendingCharacters(): number
  abortPendingPaste(reason?: 'limit' | 'timeout' | 'reset'): boolean
}

/** Stateful workload owner used by the compressed test and wall-clock soak. */
export interface TuiSoakRunner {
  /**
   * Add more turns to the same fold and append-only event list.
   * @param rounds - turns to append.
   * @returns cumulative occupancy after the new turns.
   */
  advance(rounds: number): TuiSoakReport
  /**
   * Read current cumulative occupancy without adding work.
   * @returns current cumulative occupancy.
   */
  report(): TuiSoakReport
}

function event(type: string, data: unknown, seq: number, time: number): SessionEvent {
  return { type, seq, time, data } as SessionEvent
}

const text = (value: string): ContentBlock => ({ type: 'text', text: value })

async function loadInputParser(): Promise<{
  createInputParser(options?: { maxPendingPasteCharacters?: number }): InputParser
}> {
  const inkRoot = dirname(dirname(require.resolve('ink')))
  return import(pathToFileURL(join(inkRoot, 'build/input-parser.js')).href) as Promise<{
    createInputParser(options?: { maxPendingPasteCharacters?: number }): InputParser
  }>
}

interface RunnerState {
  fold: FoldState
  readonly scratch: FoldScratch
  readonly log: SessionEvent[]
  readonly parser: InputParser
  seq: number
  rounds: number
  parserPendingPeak: number
  sessionBytes: number
  readonly startedAt: number
}

function estimateJsonBytes(value: unknown): number {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return 8
  if (typeof value === 'string') return value.length
  if (Array.isArray(value)) return value.reduce<number>((total, item) => total + estimateJsonBytes(item), 2)
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .reduce((total, [key, nested]) => total + key.length + estimateJsonBytes(nested), 2)
  }
  return 0
}

function append(state: RunnerState, type: string, data: unknown, time: number): void {
  const next = event(type, data, state.seq, time)
  state.seq += 1
  state.log.push(next)
  state.sessionBytes += estimateJsonBytes(next)
  state.fold = applyEvent(state.fold, next, state.scratch)
}

function report(state: RunnerState): TuiSoakReport {
  const memory = process.memoryUsage()
  return {
    rounds: state.rounds,
    durationMs: Date.now() - state.startedAt,
    foldNodes: state.fold.nodes.length,
    foldChars: foldResidentChars(state.fold),
    sessionEvents: state.log.length,
    sessionBytes: state.sessionBytes,
    parserPendingPeak: state.parserPendingPeak,
    rss: memory.rss,
    heapUsed: memory.heapUsed,
    foldCharBudget: MAX_FOLD_CHARS,
  }
}

function advance(state: RunnerState, rounds: number): TuiSoakReport {
  const count = Math.max(0, Math.floor(rounds))
  for (let index = 0; index < count; index += 1) {
    const turn = state.rounds + 1
    const base = Date.now()
    const callId = `soak-tool-${turn}`
    const body = `soak-${turn}-${'x'.repeat(96)}`
    append(state, 'turn/start', { turn }, base)
    append(state, 'step/start', { turn, step: 1 }, base + 1)
    append(state, 'user/message', {
      id: `u${turn}`,
      role: 'user',
      content: [text(body)],
      source: { kind: 'user' },
    }, base + 2)
    append(state, 'assistant/chunk', {
      turn,
      step: 1,
      chunk: { type: 'reasoning-delta', index: 0, text: `thinking-${turn}-${'r'.repeat(128)}` },
    }, base + 3)
    append(state, 'tool/call', {
      turn,
      step: 1,
      callId,
      name: 'bash',
      arguments: JSON.stringify({ command: `build-${turn}` }),
    }, base + 4)
    append(state, 'tool/result', {
      turn,
      step: 1,
      message: {
        role: 'user',
        content: [{ type: 'tool-result', toolCallId: callId, content: [text(`output-${turn}-${'o'.repeat(512)}`)] }],
      },
    }, base + 5)
    append(state, 'todo/write', { todos: [
      { content: 'build', status: turn % 3 === 0 ? 'completed' : 'in_progress' },
      { content: 'test', status: turn % 3 === 0 ? 'in_progress' : 'pending' },
    ] }, base + 6)
    append(state, 'goal/change', {
      kind: 'goal/change',
      version: 1,
      operation: turn === 1 ? 'create' : 'update',
      goal: {
        id: 'soak-goal',
        revision: turn,
        objective: 'continuous TUI soak',
        phase: turn % 5 === 0 ? 'paused' : 'active',
        maxGoalRounds: 100_000,
      },
      roundsStarted: turn,
      createdAt: state.startedAt,
      updatedAt: base + 7,
    }, base + 7)
    append(state, 'assistant/message', {
      turn,
      step: 1,
      message: { id: `a${turn}`, role: 'assistant', content: [text(`done-${turn}`)], source: { kind: 'model' } },
    }, base + 8)
    append(state, 'step/end', { turn, step: 1 }, base + 9)
    append(state, 'turn/end', { turn, reason: { kind: 'completed' } }, base + 10)
    state.parser.push(PASTE_START)
    state.parser.push(`pending-${turn}-${'p'.repeat(1024)}`)
    state.parserPendingPeak = Math.max(state.parserPendingPeak, state.parser.pendingCharacters())
    state.parser.abortPendingPaste('timeout')
    wrapComposerRanges(`${body} ${'中'.repeat(turn % 200)}`, 40)
    state.rounds = turn
  }
  return report(state)
}

/**
 * Create one continuous-session runner.
 * @returns a runner whose later advances retain every earlier session event.
 */
export async function createTuiSoakRunner(): Promise<TuiSoakRunner> {
  const parserModule = await loadInputParser()
  const state: RunnerState = {
    fold: initialState(),
    scratch: createScratch(),
    log: [],
    parser: parserModule.createInputParser({ maxPendingPasteCharacters: 1024 * 1024 }),
    seq: 1,
    rounds: 0,
    parserPendingPeak: 0,
    sessionBytes: 0,
    startedAt: Date.now(),
  }
  return {
    advance: rounds => advance(state, rounds),
    report: () => report(state),
  }
}

/**
 * Run a compressed continuous soak for tests.
 * @param rounds - cumulative turns in one runner.
 * @returns the final report.
 */
export async function runTuiSoak(rounds: number): Promise<TuiSoakReport> {
  const runner = await createTuiSoakRunner()
  return runner.advance(rounds)
}
