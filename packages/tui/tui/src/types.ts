/**
 * Shared transcript-node vocabulary for the dsh terminal surface. The fold in
 * `fold.ts` derives these from the event-sourced session log; renderers (Ink
 * and the linear fallback) consume them without touching the log themselves.
 * @module @deepseek-ai/dsh-tui/src/types
 */

/** Lifecycle status of one tool row, folded from `tool/call` + `tool/result`. */
export type ToolStatus = 'running' | 'done' | 'error'

/** One transcript row. `id` is the seq of the event that created it. */
export type TuiNode =
  | { kind: 'user'; id: number; text: string }
  | { kind: 'context'; id: number; text: string; producer: string }
  | { kind: 'assistant'; id: number; text: string; messageId: string; interrupted?: true }
  | { kind: 'think'; id: number; text: string; durationMs: number }
  | {
    kind: 'tool'
    id: number
    detail: string
    status: ToolStatus
    text: string
    /**
     * Parsed call arguments while the tool is running (`presentResult` reads
     * them). `undefined` after the result settles — the session log keeps the
     * raw `tool/call` arguments.
     */
    args: unknown
    /** Compacted `presentCall` view while running; `null` after the result settles. */
    callCard: unknown
    /** Compacted `presentResult` view (preview-sized fields), or `null` to fall back to `text`. */
    resultCard: unknown
  }
  | {
    /** One folded retry chain: later attempts of the same retryId update this row. */
    kind: 'retry'
    id: number
    retryId: string
    turn: number
    step: number
    provider: string
    policyKey: string
    /** Latest attempt number within the chain. */
    retry: number
    /** Provider-policy maximum; null in `always` mode, rendered as ∞. */
    maxRetries: number | null
    /** Latest scheduled delay; the surface anchors the countdown at retryAt. */
    delayMs: number
    /** Wall-clock ms when the wait ends; 0 until the surface anchors it. */
    retryAt: number
    /** Whether the matching `llm/retry-started` already fired. */
    started: boolean
    /** Failure code and HTTP status only — never the message (credential safety). */
    failure: { code: string; status?: number }
  }
  | { kind: 'status'; id: number; text: string; error: boolean }

/** One structured-trajectory line for the `/trajectory` view. */
export interface TraceEntry {
  /** Seq of the event that produced this line. */
  id: number
  text: string
}

/** The durable whole-list todo snapshot (mirrors dsh-session's TodoItem). */
export interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

/** The live streaming buffer for the current step; never a settled node. */
export interface LiveBuffer {
  text: string
  think: string
  /** Epoch ms when the current thinking run began (for the live timer). */
  thinkSince: number | null
}

/** Per-session plan-mode facts folded from `plan/mode` and `/plan` runs. */
export interface PlanState {
  /** The last committed `plan/mode` value; false before the first. */
  active: boolean
  /** A logged `/plan` selection not yet resolved by a `plan/mode` commit. */
  pending: boolean
}

/** One durable goal row folded from `goal/change` whole values. */
export interface GoalRow {
  objective: string
  phase: 'active' | 'paused' | 'blocked' | 'complete'
  blockedReason?: { code: string; message: string }
  revision: number
  roundsStarted: number
  maxGoalRounds: number
  createdAt: number
  updatedAt: number
}

/** Token accounting sampled from committed-step usage records. */
export interface TokenTotals {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
}

/**
 * The whole-session statistics the Web stats strip shows: turn/step counts,
 * LLM and tool wall times, TTFT, decode throughput, cache hit ratio, token
 * totals, and context occupancy. Folded deterministically from the log.
 */
export interface SessionStats {
  turns: number
  steps: number
  llmMs: number
  toolMs: number
  ttftMs: number
  stepsWithTtft: number
  decodeMs: number
  tokens: TokenTotals
  contextWindow: number
}

/** Everything the fold owns: settled rows, trace lines, todos, live buffer, stats. */
export interface FoldState {
  nodes: TuiNode[]
  trace: TraceEntry[]
  todos: TodoItem[]
  live: LiveBuffer | null
  stats: SessionStats
  plan: PlanState
  goal: GoalRow | null
  /** Whether a compaction run is in flight (drives the live gradient row). */
  compaction: boolean
}
