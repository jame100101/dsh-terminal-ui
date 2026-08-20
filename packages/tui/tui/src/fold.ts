/**
 * Pure session-log → transcript fold for the dsh terminal surface. Applying
 * the same event prefix always produces the same node/trace/stats sequence
 * (replay determinism), which is what unit tests assert and what resume
 * relies on. The whole-session statistics mirror the Web stats strip:
 * turn/step counts, LLM and tool wall times, TTFT, decode throughput, cache
 * hit ratio, token totals, and context occupancy.
 * @module @deepseek-ai/dsh-tui/src/fold
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
// Empty type imports carry declaration merges: compaction extends the session
// event vocabulary with `compaction/*`, commands with `command/run`/`done`,
// llm-retry with `llm/retry`, plan-mode with `plan/mode`, goal with
// `goal/change`.
import type {} from '@deepseek-ai/dsh-compaction'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-llm-retry'
import type {} from '@deepseek-ai/dsh-plan-mode'
import type {} from '@deepseek-ai/dsh-goal'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { FoldState, GoalRow, SessionStats, TuiNode, ToolStatus } from './types'
import { compactResultCard } from './card-project'
import { formatMs } from './plain'

/** Tool-result text cap: rows stay display-sized even for giant outputs. */
const MAX_TOOL_TEXT = 4000
/** Status-row text cap. */
const MAX_STATUS_TEXT = 400
/** Goal objective preview cap for the status row. */
const MAX_GOAL_PREVIEW = 200
/** Tool-call argument preview cap. */
const MAX_ARGS_PREVIEW = 120

/** Empty fold state. */
export function initialState(): FoldState {
  return {
    nodes: [],
    trace: [],
    todos: [],
    live: null,
    stats: {
      turns: 0,
      steps: 0,
      llmMs: 0,
      toolMs: 0,
      ttftMs: 0,
      stepsWithTtft: 0,
      decodeMs: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
      contextWindow: 0,
    },
    plan: { active: false, pending: false },
    goal: null,
    compaction: false,
  }
}

/**
 * Flatten a content-block list into its visible text. Tool-result blocks
 * recurse into their nested content; reasoning, image, and tool-call blocks
 * contribute nothing (thinking renders through the live buffer instead).
 * @param blocks - the message content to project.
 * @param cap - stop accumulating once the result reaches this many characters (0 = no cap).
 * @returns the joined text.
 */
function blocksText(blocks: readonly ContentBlock[] | undefined, cap: number): string {
  if (blocks === undefined) return ''
  let out = ''
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        out += block.text
        break
      case 'tool-result': {
        out += blocksText(block.content, cap === 0 ? 0 : Math.max(0, cap - out.length))
        break
      }
      case 'image': {
        const label = block.attachment.name ?? 'image'
        out += `${out === '' || out.endsWith('\n') ? '' : '\n'}📎 ${label}`
        break
      }
      // reasoning / tool-call blocks are not visible prose.
      default:
        break
    }
    if (cap > 0 && out.length >= cap) {
      out = out.slice(0, cap)
      break
    }
  }
  return out
}

/** Short single-line preview of a raw tool-call argument string. */
function previewArgs(argumentsJson: string): string {
  const singleLine = argumentsJson.replace(/\s+/g, ' ').trim()
  if (singleLine.length <= MAX_ARGS_PREVIEW) return singleLine
  return `${singleLine.slice(0, MAX_ARGS_PREVIEW)}…`
}

/** Index of the most recent settled tool row, or -1. */
function lastRunningTool(nodes: readonly TuiNode[]): number {
  for (let index = nodes.length - 1; index >= 0; index--) {
    const node = nodes[index]
    if (node !== undefined && node.kind === 'tool' && node.status === 'running') return index
  }
  return -1
}

/** Index of the most recent retry row of one chain, or -1. */
function lastRetryChain(nodes: readonly TuiNode[], retryId: string): number {
  for (let index = nodes.length - 1; index >= 0; index--) {
    const node = nodes[index]
    if (node !== undefined && node.kind === 'retry' && node.retryId === retryId) return index
  }
  return -1
}

/**
 * Append one reasoning segment to the turn's current think node, or start a
 * new one. A new user/assistant message boundary opens a fresh block, so one
 * turn renders ONE collapsible Thinking row no matter how many tool calls
 * split its reasoning stream (the TS DamnatioX displays one thought block per
 * message entry). Durations accumulate across appended segments so the row
 * carries the whole block's thinking time (0.1s display precision).
 */
function flushThink(nodes: TuiNode[], id: number, text: string, durationMs: number): void {
  for (let index = nodes.length - 1; index >= 0; index--) {
    const node = nodes[index]
    if (node === undefined) continue
    if (node.kind === 'user' || node.kind === 'assistant') break
    if (node.kind === 'think') {
      nodes[index] = { ...node, text: node.text + text, id, durationMs: node.durationMs + durationMs }
      return
    }
  }
  nodes.push({ kind: 'think', id, text, durationMs })
}

/** Producer label for a non-user message source. */
function producerOf(source: unknown): string {
  if (typeof source !== 'object' || source === null) return 'context'
  const { kind } = source as { kind?: unknown }
  if (kind === 'plugin' && typeof (source as { plugin?: unknown }).plugin === 'string') {
    return (source as { plugin: string }).plugin
  }
  return kind === undefined ? 'context' : String(kind)
}

/** One trajectory line appended for structural events. */
function trace(id: number, text: string): { id: number; text: string } {
  return { id, text }
}

/** Private per-event stepping state for timing and usage sampling. */
interface StepState {
  startTime: number
  firstChunkTime: number | null
  lastChunkTime: number | null
  usage: TokenUsageSample | null
}

/** The committed-step usage sample folded into the totals. */
interface TokenUsageSample {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
}

/** Fold one step boundary: commit its timing and usage into the stats. */
function commitStep(stats: SessionStats, step: StepState): SessionStats {
  if (step.firstChunkTime === null || step.lastChunkTime === null) return stats
  return {
    ...stats,
    llmMs: stats.llmMs + Math.max(0, step.lastChunkTime - step.startTime),
    ttftMs: stats.ttftMs + Math.max(0, step.firstChunkTime - step.startTime),
    stepsWithTtft: stats.stepsWithTtft + 1,
    decodeMs: stats.decodeMs + Math.max(0, step.lastChunkTime - step.firstChunkTime),
    tokens: step.usage === null ? stats.tokens : {
      input: stats.tokens.input + step.usage.input,
      output: stats.tokens.output + step.usage.output,
      cacheRead: stats.tokens.cacheRead + step.usage.cacheRead,
      cacheWrite: stats.tokens.cacheWrite + step.usage.cacheWrite,
      reasoning: stats.tokens.reasoning + step.usage.reasoning,
    },
  }
}

/** Mutable per-event bookkeeping the fold carries between calls. */
export interface FoldScratch {
  step: StepState | null
  toolStarts: Map<string, number>
  /** Per-turn sums feeding the turn-tail row (`└ turn N · LLM … · 工具 … · TTFT …`). */
  turnNumber: number
  turnLlms: number
  turnTools: number
  turnTtftMs: number
  turnTtftSteps: number
}

/** Fresh scratch for one fold stream (one session's event sequence). */
export function createScratch(): FoldScratch {
  return {
    step: null,
    toolStarts: new Map(),
    turnNumber: 0,
    turnLlms: 0,
    turnTools: 0,
    turnTtftMs: 0,
    turnTtftSteps: 0,
  }
}

/** Scratch instances whose node and trace arrays are private to one replay. */
const batchScratches = new WeakSet<FoldScratch>()

/** Return a writable node array without copying a replay-private buffer. */
function writableNodes(nodes: TuiNode[], scratch: FoldScratch): TuiNode[] {
  return batchScratches.has(scratch) ? nodes : [...nodes]
}

/** Append one node while preserving immutable publication for live folds. */
function appendNode(nodes: TuiNode[], node: TuiNode, scratch: FoldScratch): TuiNode[] {
  const next = writableNodes(nodes, scratch)
  next.push(node)
  return next
}

/** Append one trace while preserving immutable publication for live folds. */
function appendTrace(
  traces: FoldState['trace'],
  entry: FoldState['trace'][number],
  scratch: FoldScratch,
): FoldState['trace'] {
  if (batchScratches.has(scratch)) {
    traces.push(entry)
    return traces
  }
  return [...traces, entry]
}

/**
 * Fold one complete raw event log into transcript state (resume replay).
 * The same prefix contract as {@link applyEvent}: a persisted session's
 * full log folds into exactly the rows the live fold produced.
 * @param events - the session log in seq order.
 * @returns the folded transcript state and its scratch.
 */
export function foldFromLog(events: readonly SessionEvent[]): { fold: FoldState; scratch: FoldScratch } {
  const scratch = createScratch()
  batchScratches.add(scratch)
  let fold = initialState()
  try {
    for (const event of events) fold = applyEvent(fold, event, scratch)
  } finally {
    batchScratches.delete(scratch)
  }
  return { fold, scratch }
}

/**
 * Fold one session event into the transcript state. Pure: the input state is
 * never mutated; unknown and structural events fall through without a row.
 * @param state - the fold state before this event.
 * @param event - the next event in log order.
 * @param scratch - private per-stream bookkeeping (timing, tool starts).
 * @returns the fold state after this event.
 */
export function applyEvent(state: FoldState, event: SessionEvent, scratch: FoldScratch = createScratch()): FoldState {
  // Lazy copy: `nodes`/`trace` keep their identity until an event actually
  // appends or replaces a row. Streaming `assistant/chunk` events therefore
  // publish referentially-stable arrays, which the renderer's memoization
  // relies on (re-projecting every settled node per chunk is quadratic).
  let nodes = state.nodes
  let traces = state.trace
  let live = state.live
  let todos = state.todos
  let stats = state.stats
  let plan = state.plan
  let goal = state.goal
  let compaction = state.compaction
  switch (event.type) {
    case 'turn/start': {
      traces = appendTrace(traces, trace(event.seq, `turn ${event.data.turn} start`), scratch)
      stats = { ...stats, turns: stats.turns + 1 }
      scratch.turnNumber = event.data.turn
      scratch.turnLlms = 0
      scratch.turnTools = 0
      scratch.turnTtftMs = 0
      scratch.turnTtftSteps = 0
      break
    }
    case 'user/message': {
      const text = blocksText(event.data.content, 0)
      const source = event.data.source
      if (source.kind === 'user') {
        nodes = appendNode(nodes, { kind: 'user', id: event.seq, text }, scratch)
      } else {
        // Injected context (workspace instructions, skill catalogs, notices…)
        // renders as a collapsed disclosure, like the Web context row.
        nodes = appendNode(nodes, { kind: 'context', id: event.seq, text, producer: producerOf(source) }, scratch)
      }
      traces = appendTrace(traces, trace(event.seq, `user (${source.kind}): ${firstLine(text)}`), scratch)
      break
    }
    case 'step/start': {
      live = { text: '', think: '', thinkSince: null }
      scratch.step = { startTime: event.time, firstChunkTime: null, lastChunkTime: null, usage: null }
      traces = appendTrace(traces, trace(event.seq, `step ${event.data.turn}.${event.data.step} start`), scratch)
      stats = { ...stats, steps: stats.steps + 1 }
      break
    }
    case 'assistant/chunk': {
      if (live === null) live = { text: '', think: '', thinkSince: null }
      const chunk = event.data.chunk
      if (chunk.type === 'text-delta') {
        live = { ...live, text: live.text + chunk.text }
      } else if (chunk.type === 'reasoning-delta') {
        live = {
          ...live,
          think: live.think + chunk.text,
          thinkSince: live.thinkSince ?? (live.think === '' ? event.time : live.thinkSince),
        }
      } else if (chunk.type === 'usage' && scratch.step !== null) {
        scratch.step.usage = usageOf(chunk.usage)
      }
      if (scratch.step !== null && chunk.type !== 'usage') {
        scratch.step.firstChunkTime ??= event.time
        scratch.step.lastChunkTime = event.time
      }
      break
    }
    case 'assistant/message': {
      if (live !== null && live.think !== '') {
        nodes = writableNodes(nodes, scratch)
        flushThink(nodes, event.seq, live.think, Math.max(0, event.time - (live.thinkSince ?? event.time)))
      }
      const text = blocksText(event.data.message.content, 0)
      nodes = appendNode(nodes, {
        kind: 'assistant',
        id: event.seq,
        text,
        messageId: event.data.message.id,
        ...(event.data.interrupted === true ? { interrupted: true as const } : {}),
      }, scratch)
      traces = appendTrace(traces, trace(event.seq, `assistant (${text.length} chars)`), scratch)
      if (event.data.usage !== undefined && scratch.step !== null && scratch.step.usage === null) {
        scratch.step.usage = usageOf(event.data.usage)
      }
      live = null
      break
    }
    case 'tool/call': {
      // The reasoning streamed before this step's model call asked for tools:
      // flush it as a settled think row so it renders before the tool rows.
      if (live !== null && live.think !== '') {
        nodes = writableNodes(nodes, scratch)
        flushThink(nodes, event.seq, live.think, Math.max(0, event.time - (live.thinkSince ?? event.time)))
        live = { ...live, think: '', thinkSince: null }
      }
      nodes = appendNode(nodes, {
        kind: 'tool',
        id: event.seq,
        detail: `${event.data.name} ${previewArgs(event.data.arguments)}`,
        status: 'running',
        text: '',
        args: parseArgsLenient(event.data.arguments),
        callCard: null,
        resultCard: null,
      }, scratch)
      scratch.toolStarts.set(event.data.callId, event.time)
      traces = appendTrace(traces, trace(event.seq, `tool ${event.data.name}`), scratch)
      break
    }
    case 'tool/result': {
      const text = blocksText(event.data.message.content, MAX_TOOL_TEXT)
      const status: ToolStatus = event.data.error === undefined ? 'done' : 'error'
      const index = lastRunningTool(nodes)
      if (index >= 0) {
        const running = nodes[index]
        if (running !== undefined && running.kind === 'tool') {
          nodes = writableNodes(nodes, scratch)
          // Drop parsed args and the pending call view: the session log keeps
          // the raw payload; the TUI row keeps a preview-sized result card.
          nodes[index] = {
            ...running,
            status,
            text,
            args: undefined,
            callCard: null,
            resultCard: compactResultCard(running.resultCard),
          }
        }
      } else {
        nodes = appendNode(nodes, { kind: 'tool', id: event.seq, detail: 'tool', status, text, args: undefined, callCard: null, resultCard: null }, scratch)
      }
      const start = scratch.toolStarts.get(toolResultCallId(event))
      if (start !== undefined) {
        const duration = Math.max(0, event.time - start)
        stats = { ...stats, toolMs: stats.toolMs + duration }
        scratch.turnTools += duration
      }
      traces = appendTrace(traces, trace(event.seq, `result ${status}`), scratch)
      break
    }
    case 'step/end': {
      traces = appendTrace(traces, trace(event.seq, `step ${event.data.turn}.${event.data.step} end`), scratch)
      if (scratch.step !== null) {
        const before = stats
        stats = commitStep(stats, scratch.step)
        scratch.turnLlms += stats.llmMs - before.llmMs
        scratch.turnTtftMs += stats.ttftMs - before.ttftMs
        scratch.turnTtftSteps += stats.stepsWithTtft - before.stepsWithTtft
        scratch.step = null
      }
      break
    }
    case 'turn/end': {
      const reason = event.data.reason
      traces = appendTrace(traces, trace(event.seq, `turn ${event.data.turn} end (${reason.kind})`), scratch)
      // The per-turn tail: LLM wall time, tool wall time, and average TTFT
      // for this turn, mirroring the Web turn-tail statistics.
      const tailParts = [
        `LLM ${formatMs(scratch.turnLlms)}`,
        `工具 ${formatMs(scratch.turnTools)}`,
        ...(scratch.turnTtftSteps > 0 ? [`TTFT ${formatMs(scratch.turnTtftMs / scratch.turnTtftSteps)}`] : []),
      ]
      nodes = appendNode(nodes, { kind: 'status', id: event.seq, error: false, text: `└ turn ${scratch.turnNumber} · ${tailParts.join(' · ')}` }, scratch)
      if (reason.kind === 'error') {
        nodes = appendNode(nodes, {
          kind: 'status',
          id: event.seq,
          error: true,
          text: `turn failed: ${reason.error.code}: ${reason.error.message}`.slice(0, MAX_STATUS_TEXT),
        }, scratch)
      } else if (reason.kind === 'aborted') {
        nodes = appendNode(nodes, { kind: 'status', id: event.seq, error: false, text: 'cancelled' }, scratch)
      }
      break
    }
    case 'todo/write': {
      todos = [...event.data.todos]
      break
    }
    case 'request/context': {
      if (event.data.contextWindow !== undefined) {
        stats = { ...stats, contextWindow: event.data.contextWindow }
      }
      break
    }
    case 'command/run': {
      // A logged `/plan` selection is pending until a `plan/mode` commit
      // resolves it (the plan-mode projection's wanted/active pair).
      if (event.data.name === 'plan' && event.data.args !== undefined) {
        const wanted = event.data.args.trim() !== 'off'
        plan = { active: plan.active, pending: wanted !== plan.active }
      }
      break
    }
    case 'command/done': {
      if (event.data.kind === 'success' && event.data.text !== undefined && event.data.text !== '') {
        nodes = appendNode(nodes, { kind: 'status', id: event.seq, error: false, text: event.data.text.slice(0, MAX_STATUS_TEXT) }, scratch)
      } else if (event.data.kind === 'error') {
        nodes = appendNode(nodes, {
          kind: 'status',
          id: event.seq,
          error: true,
          text: `command failed: ${event.data.text ?? 'unknown error'}`.slice(0, MAX_STATUS_TEXT),
        }, scratch)
      }
      break
    }
    case 'llm/retry': {
      // One muted row per retry chain: a later attempt with the same retryId
      // replaces the row in place, folding the whole chain into one entry.
      const data = event.data
      const failure = data.failure
      const next: TuiNode = {
        kind: 'retry',
        id: event.seq,
        retryId: data.retryId,
        turn: data.turn,
        step: data.step,
        provider: data.provider,
        policyKey: data.policyKey,
        retry: data.retry,
        maxRetries: data.mode === 'normal' ? data.maxRetries : null,
        delayMs: data.delayMs,
        retryAt: 0,
        started: false,
        failure: {
          code: failure.code,
          ...(failure.status === undefined ? {} : { status: failure.status }),
        },
      }
      const chainIndex = lastRetryChain(nodes, data.retryId)
      nodes = writableNodes(nodes, scratch)
      if (chainIndex === -1) nodes.push(next)
      else nodes[chainIndex] = next
      traces = appendTrace(traces, trace(event.seq, `retry ${data.retry}/${data.mode === 'normal' ? String(data.maxRetries) : '∞'} · ${formatMs(data.delayMs)} · ${failure.code}`), scratch)
      break
    }
    case 'llm/retry-started': {
      const chainIndex = lastRetryChain(nodes, event.data.retryId)
      const prior = nodes[chainIndex]
      if (prior !== undefined && prior.kind === 'retry') {
        nodes = writableNodes(nodes, scratch)
        nodes[chainIndex] = { ...prior, started: true, retryAt: 0 }
      }
      break
    }
    case 'plan/mode': {
      plan = { active: event.data.active, pending: false }
      nodes = appendNode(nodes, {
        kind: 'status',
        id: event.seq,
        error: false,
        text: event.data.active ? '◈ plan 模式开启' : '◈ plan 模式关闭',
      }, scratch)
      break
    }
    case 'goal/change': {
      const change = event.data
      if (change.operation === 'clear') {
        goal = null
        nodes = appendNode(nodes, { kind: 'status', id: event.seq, error: false, text: '◆ goal 已清除' }, scratch)
      } else {
        const snapshot = change.goal
        const next: GoalRow = {
          objective: snapshot.objective,
          phase: snapshot.phase,
          ...(snapshot.blockedReason === undefined ? {} : {
            blockedReason: { code: snapshot.blockedReason.code, message: snapshot.blockedReason.message },
          }),
          revision: snapshot.revision,
          roundsStarted: change.roundsStarted,
          maxGoalRounds: snapshot.maxGoalRounds,
          createdAt: change.createdAt,
          updatedAt: change.updatedAt,
        }
        goal = next
        const phaseLabel = next.phase === 'active' ? '进行中'
          : next.phase === 'paused' ? '已暂停'
            : next.phase === 'blocked' ? '已阻塞'
              : '已完成'
        const objective = next.objective.length <= MAX_GOAL_PREVIEW
          ? next.objective
          : `${next.objective.slice(0, MAX_GOAL_PREVIEW)}…`
        nodes = appendNode(nodes, {
          kind: 'status',
          id: event.seq,
          error: false,
          text: `◆ goal ${change.operation} · ${phaseLabel} · ${objective}`,
        }, scratch)
      }
      break
    }
    case 'compaction/start': {
      // No settled row: while the run is in flight the renderer draws a live
      // gradient row keyed off `compaction` (the run is usually brief).
      compaction = true
      break
    }
    case 'compaction/end': {
      compaction = false
      nodes = appendNode(nodes, { kind: 'status', id: event.seq, error: false, text: 'compacted' }, scratch)
      break
    }
    default:
      // `request/header`, `session/end-seed`, approval audit pairs, and
      // plugin-merged types are structural: no transcript row.
      break
  }
  return { nodes, trace: traces, todos, live, stats, plan, goal, compaction }
}

/**
 * Anchor a folded retry row's countdown to the wall clock. Deliberately OUT of
 * `applyEvent` so the fold stays deterministic (a replayed log produces the
 * same rows); the surface stamps the anchor exactly once, as the event
 * arrives. The matching `llm/retry-started` settles the row, so historical
 * rows replayed past their wait flash no stale countdown.
 * @param state - the folded state whose retry row to anchor.
 * @param event - the `llm/retry` event to anchor.
 * @param now - the current epoch ms (injectable for tests).
 */
export function anchorRetry(state: FoldState, event: SessionEvent, now: number = Date.now()): void {
  if (event.type !== 'llm/retry') return
  const chainIndex = lastRetryChain(state.nodes, event.data.retryId)
  const node = state.nodes[chainIndex]
  if (node !== undefined && node.kind === 'retry') {
    // Replace the element without copying the array: the renderer's settled
    // memo depends on the array identity (stable across the lazy-copy fold),
    // so the next shimmer/countdown recompute picks the anchored row up.
    state.nodes[chainIndex] = { ...node, retryAt: now + node.delayMs }
  }
}

/** Project one usage record into the fold's sample shape. */
function usageOf(usage: {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}): TokenUsageSample {
  return {
    input: usage.inputTokens ?? 0,
    output: usage.outputTokens ?? 0,
    cacheRead: usage.cacheReadTokens ?? 0,
    cacheWrite: usage.cacheWriteTokens ?? 0,
    reasoning: usage.reasoningTokens ?? 0,
  }
}

/** Read the paired callId from a tool-result's tool-result block. */
function toolResultCallId(event: SessionEvent & { type: 'tool/result' }): string {
  const block = event.data.message.content.find(entry => entry.type === 'tool-result')
  return block?.type === 'tool-result' ? block.toolCallId : ''
}

/** Parse raw tool-call arguments JSON; failures degrade to the raw string. */
function parseArgsLenient(argumentsJson: string): unknown {
  try {
    return JSON.parse(argumentsJson) as unknown
  } catch {
    return argumentsJson
  }
}

/** First line of a multi-line string, for trajectory labels. */
function firstLine(text: string): string {
  const line = text.split('\n')[0] ?? ''
  if (line.length <= 60) return line
  return `${line.slice(0, 60)}…`
}
