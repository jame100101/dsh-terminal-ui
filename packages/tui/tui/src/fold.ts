/**
 * Pure session-log → transcript fold for the dsh terminal surface. Applying
 * the same event prefix always produces the same node/trace/stats sequence
 * (replay determinism), which is what unit tests assert and what resume
 * relies on. The fold working set keeps a bounded tail of rows and capped
 * bodies; stats still accumulate across dropped prefix events. The session
 * log remains the full durable record. The whole-session statistics mirror
 * the Web stats strip: turn/step counts, LLM and tool wall times, TTFT,
 * decode throughput, cache hit ratio, token totals, and context occupancy.
 * @module @deepseek-ai/dsh-tui/src/fold
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
// Empty type imports carry declaration merges: compaction extends the session
// event vocabulary with `compaction/*`, commands with `command/run`/`done`,
// llm-retry with `llm/retry`, plan-mode with `plan/mode`, goal with
// `goal/change`, tools with `tool/code-dispatch*`.
import type {} from '@deepseek-ai/dsh-compaction'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-llm-retry'
import type {} from '@deepseek-ai/dsh-plan-mode'
import type {} from '@deepseek-ai/dsh-goal'
import type {} from '@deepseek-ai/dsh-tools'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { FoldState, GoalRow, SessionStats, TuiNode, ToolStatus } from './types'
import { compactResultCard } from './card-project'
import { deepSeekCostUsd } from './deepseek-cost'
import { formatMs } from './plain'

/** Tool-result text cap: rows stay display-sized even for giant outputs. */
export const MAX_TOOL_TEXT = 4000
/** Settled assistant body cap. The session log keeps the full message. */
export const MAX_ASSISTANT_TEXT = 32_768
/** User-prompt body cap in the fold working set. */
export const MAX_USER_TEXT = 8_192
/** Thinking-row body cap. */
export const MAX_THINK_TEXT = 4_000
/** Injected-context body cap. */
export const MAX_CONTEXT_TEXT = 4_000
/** Newest transcript rows the fold retains (matches the render window). */
export const MAX_FOLD_NODES = 3_000
/** Soft cap on projected node+trace+live characters; oldest rows drop first. */
export const MAX_FOLD_CHARS = 1_500_000
/** Events processed between `setImmediate` yields during resume replay. */
export const FOLD_YIELD_EVERY = 400
/** Newest trajectory lines the fold retains. */
export const MAX_TRACE = 512
/** Status-row text cap. */
const MAX_STATUS_TEXT = 400
/** Goal objective preview cap for the status row. */
const MAX_GOAL_PREVIEW = 200
/** Tool-call argument preview cap. */
const MAX_ARGS_PREVIEW = 120

/**
 * Hard-slice a display body. The durable session log is the full text.
 * @param text - the projected body.
 * @param cap - maximum retained characters.
 * @returns `text` or its prefix of `cap` characters.
 */
function capBody(text: string, cap: number): string {
  return text.length <= cap ? text : text.slice(0, cap)
}

/**
 * Count characters the fold currently retains (nodes, traces, live buffer).
 * Used by tests to assert long sessions stay bounded; not a heap measurement.
 * @param state - a folded transcript.
 * @returns retained character count.
 */
function nodeResidentChars(node: TuiNode): number {
  if (node.kind === 'tool') return node.detail.length + node.text.length + node.callId.length + node.name.length
  if (node.kind === 'retry') return node.retryId.length + node.provider.length
  if (node.kind === 'deliverables') return node.paths.reduce((sum, path) => sum + path.length, 0)
  if ('text' in node) return node.text.length
  return 0
}

/**
 * Count characters retained by the bounded transcript projection.
 * @param state - Current TUI fold.
 * @returns Characters held by nodes, trace entries, and the live buffer.
 */
export function foldResidentChars(state: FoldState): number {
  let total = 0
  for (const node of state.nodes) total += nodeResidentChars(node)
  for (const entry of state.trace) total += entry.text.length
  if (state.live !== null) total += state.live.text.length + state.live.think.length
  return total
}

/**
 * Create an empty fold state.
 * @returns a state with no projected session events.
 */
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
      costUsd: 0,
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

/** Preview already-normalized Code Mode dispatch arguments. */
function previewUnknownArgs(value: unknown): string {
  if (typeof value === 'string') return previewArgs(value)
  try {
    return previewArgs(JSON.stringify(value) ?? '')
  } catch {
    return ''
  }
}

/**
 * Decode the paired call id and failure bit from a `tool/result` event.
 * Status uses the tool-result block's `isError`; `event.data.error` is only
 * a diagnostic supplement.
 * @param event - a session event.
 * @returns the decoded result, or null when the event is not `tool/result`.
 */
export function decodeToolResult(event: SessionEvent): {
  callId: string
  isError: boolean
  content: ContentBlock[]
} | null {
  if (event.type !== 'tool/result') return null
  const content = event.data.message.content
  const block = content.find(entry => entry.type === 'tool-result')
  return {
    callId: block?.type === 'tool-result' ? String(block.toolCallId) : '',
    isError: block?.type === 'tool-result' && block.isError === true,
    content,
  }
}

/** Index of the tool row with this call id, or -1. */
function findToolByCallId(nodes: readonly TuiNode[], callId: string): number {
  if (callId === '') return -1
  for (let index = nodes.length - 1; index >= 0; index--) {
    const node = nodes[index]
    if (node !== undefined && node.kind === 'tool' && node.callId === callId) return index
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
      nodes[index] = {
        ...node,
        text: capBody(node.text + text, MAX_THINK_TEXT),
        id,
        durationMs: node.durationMs + durationMs,
      }
      return
    }
  }
  nodes.push({ kind: 'think', id, text: capBody(text, MAX_THINK_TEXT), durationMs })
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
  route: PricingRoute | null
}

/** Exact request route used to price one completed model step. */
interface PricingRoute {
  provider: string
  model: string
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
  const firstChunkTime = step.firstChunkTime
  const lastChunkTime = step.lastChunkTime
  const timed = firstChunkTime !== null && lastChunkTime !== null
  if (!timed && step.usage === null) return stats
  const stepCost = step.usage === null || step.route === null
    ? 0
    : deepSeekCostUsd(step.route.provider, step.route.model, step.usage)
  return {
    ...stats,
    llmMs: stats.llmMs + (timed ? Math.max(0, lastChunkTime - step.startTime) : 0),
    ttftMs: stats.ttftMs + (timed ? Math.max(0, firstChunkTime - step.startTime) : 0),
    stepsWithTtft: stats.stepsWithTtft + (timed ? 1 : 0),
    decodeMs: stats.decodeMs + (timed ? Math.max(0, lastChunkTime - firstChunkTime) : 0),
    tokens: step.usage === null ? stats.tokens : {
      input: stats.tokens.input + step.usage.input,
      output: stats.tokens.output + step.usage.output,
      cacheRead: stats.tokens.cacheRead + step.usage.cacheRead,
      cacheWrite: stats.tokens.cacheWrite + step.usage.cacheWrite,
      reasoning: stats.tokens.reasoning + step.usage.reasoning,
    },
    costUsd: stats.costUsd + stepCost,
  }
}

/** Mutable per-event bookkeeping the fold carries between calls. */
export interface FoldScratch {
  step: StepState | null
  /** Latest logged request route, retained across steps in one replay. */
  requestRoute: PricingRoute | null
  toolStarts: Map<string, number>
  /** Compact call presentations retained until their matching result. */
  toolCallCards: Map<string, unknown>
  /** Successful mutation paths in first-seen order for the active turn. */
  turnProduced: string[]
  /** Per-turn sums feeding the turn-tail row (`└ turn N · LLM … · 工具 … · TTFT …`). */
  turnNumber: number
  turnLlms: number
  turnTools: number
  turnTtftMs: number
  turnTtftSteps: number
}

/**
 * Create scratch state for one session event sequence.
 * @returns fresh mutable fold scratch.
 */
export function createScratch(): FoldScratch {
  return {
    step: null,
    requestRoute: null,
    toolStarts: new Map(),
    toolCallCards: new Map(),
    turnProduced: [],
    turnNumber: 0,
    turnLlms: 0,
    turnTools: 0,
    turnTtftMs: 0,
    turnTtftSteps: 0,
  }
}

/**
 * Associate a tool call's compact presentation with its call id.
 * @param scratch - the active fold stream.
 * @param callId - opaque tool call id.
 * @param card - compact `presentCall` view.
 */
export function rememberToolCallCard(scratch: FoldScratch, callId: string, card: unknown): void {
  scratch.toolCallCards.set(callId, card)
}

/** Read mutation paths from the official tool render intent vocabulary. */
function producedPaths(card: unknown): string[] {
  if (typeof card !== 'object' || card === null) return []
  const view = card as { card?: unknown; kind?: unknown; locations?: unknown }
  if (view.card !== 'diff' && !(view.card === 'generic' && view.kind === 'edit')) return []
  if (!Array.isArray(view.locations)) return []
  return view.locations.flatMap((location) => {
    if (typeof location !== 'object' || location === null) return []
    const path = (location as { path?: unknown }).path
    return typeof path === 'string' && path !== '' ? [path] : []
  })
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
 * Keep only the newest `max` items. Replay-private buffers splice in place;
 * live folds slice so published array identity changes only on eviction.
 * @param items - nodes or traces.
 * @param max - retained tail length.
 * @param scratch - the fold stream (replay vs live).
 * @returns the truncated array (possibly the same object).
 */
function trimRing<T>(items: T[], max: number, scratch: FoldScratch): T[] {
  if (items.length <= max) return items
  if (batchScratches.has(scratch)) {
    items.splice(0, items.length - max)
    return items
  }
  return items.slice(items.length - max)
}

/** Drop oldest nodes until the projected character budget fits. */
function trimFoldNodes(nodes: TuiNode[], scratch: FoldScratch): TuiNode[] {
  const next = trimRing(nodes, MAX_FOLD_NODES, scratch)
  let chars = 0
  for (const node of next) chars += nodeResidentChars(node)
  if (chars <= MAX_FOLD_CHARS) return next
  let start = 0
  while (start < next.length - 1 && chars > MAX_FOLD_CHARS) {
    chars -= nodeResidentChars(next[start] as TuiNode)
    start += 1
  }
  if (start === 0) return next
  if (batchScratches.has(scratch)) {
    next.splice(0, start)
    return next
  }
  return next.slice(start)
}

/**
 * Fold one complete raw event log into transcript state (resume replay).
 * The same prefix contract as {@link applyEvent}: a persisted session's
 * full log folds into exactly the rows the live fold produced.
 * @param events - the session log in seq order.
 * @param hooks - optional presentation enrichment immediately before or after each event folds.
 * @returns the folded transcript state and its scratch.
 */
export function foldFromLog(
  events: readonly SessionEvent[],
  hooks?: {
    before?(event: SessionEvent, fold: FoldState, scratch: FoldScratch): void
    after?(event: SessionEvent, fold: FoldState, scratch: FoldScratch): void
  },
): { fold: FoldState; scratch: FoldScratch } {
  const scratch = createScratch()
  batchScratches.add(scratch)
  let fold = initialState()
  try {
    for (const event of events) {
      hooks?.before?.(event, fold, scratch)
      fold = applyEvent(fold, event, scratch)
      hooks?.after?.(event, fold, scratch)
    }
  } finally {
    batchScratches.delete(scratch)
  }
  return { fold, scratch }
}

/**
 * Replay a log with `setImmediate` yields so a long resume does not monopolize
 * the event loop. The folded result matches {@link foldFromLog}.
 * @param events - the session log in seq order.
 * @param hooks - optional presentation enrichment immediately before or after each event folds.
 * @param options - yield stride and progress callback.
 * @returns the folded transcript state and its scratch.
 */
export async function foldFromLogYielding(
  events: readonly SessionEvent[],
  hooks?: {
    before?(event: SessionEvent, fold: FoldState, scratch: FoldScratch): void
    after?(event: SessionEvent, fold: FoldState, scratch: FoldScratch): void
  },
  options?: {
    yieldEvery?: number
    onProgress?(done: number, total: number): void
    signal?: AbortSignal
    seed?: { fold: FoldState; scratch: FoldScratch }
  },
): Promise<{ fold: FoldState; scratch: FoldScratch }> {
  const yieldEvery = Math.max(1, options?.yieldEvery ?? FOLD_YIELD_EVERY)
  const scratch = options?.seed?.scratch ?? createScratch()
  let fold = options?.seed === undefined
    ? initialState()
    : {
      ...options.seed.fold,
      nodes: [...options.seed.fold.nodes],
      trace: [...options.seed.fold.trace],
      todos: [...options.seed.fold.todos],
    }
  batchScratches.add(scratch)
  try {
    for (let index = 0; index < events.length; index += 1) {
      if (options?.signal?.aborted === true) break
      const event = events[index]
      if (event === undefined) continue
      hooks?.before?.(event, fold, scratch)
      fold = applyEvent(fold, event, scratch)
      hooks?.after?.(event, fold, scratch)
      if ((index + 1) % yieldEvery === 0) {
        options?.onProgress?.(index + 1, events.length)
        await new Promise<void>((resolve) => {
          setImmediate(resolve)
        })
      }
    }
    if (options?.signal?.aborted !== true) options?.onProgress?.(events.length, events.length)
  } finally {
    batchScratches.delete(scratch)
  }
  return { fold, scratch }
}

/**
 * Fold one session event into the transcript state. Pure: the input state is
 * never mutated; unknown and structural events fall through without a row.
 * The fold working set keeps the newest {@link MAX_FOLD_NODES} rows and caps
 * each body; the session log remains the full durable record.
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
      scratch.toolCallCards.clear()
      scratch.turnProduced = []
      stats = { ...stats, turns: stats.turns + 1 }
      scratch.turnNumber = event.data.turn
      scratch.turnLlms = 0
      scratch.turnTools = 0
      scratch.turnTtftMs = 0
      scratch.turnTtftSteps = 0
      break
    }
    case 'user/message': {
      const source = event.data.source
      const text = blocksText(event.data.content, source.kind === 'user' ? MAX_USER_TEXT : MAX_CONTEXT_TEXT)
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
      scratch.step = {
        startTime: event.time,
        firstChunkTime: null,
        lastChunkTime: null,
        usage: null,
        route: scratch.requestRoute,
      }
      traces = appendTrace(traces, trace(event.seq, `step ${event.data.turn}.${event.data.step} start`), scratch)
      stats = { ...stats, steps: stats.steps + 1 }
      break
    }
    case 'request/header': {
      const route = {
        provider: event.data.header.config.provider,
        model: event.data.header.config.model,
      }
      scratch.requestRoute = route
      if (scratch.step !== null) scratch.step.route = route
      break
    }
    case 'assistant/chunk': {
      if (live === null) live = { text: '', think: '', thinkSince: null }
      const chunk = event.data.chunk
      if (chunk.type === 'text-delta') {
        if (live.text.length < MAX_ASSISTANT_TEXT) {
          live = { ...live, text: capBody(live.text + chunk.text, MAX_ASSISTANT_TEXT) }
        }
      } else if (chunk.type === 'reasoning-delta') {
        if (live.think.length < MAX_THINK_TEXT) {
          live = {
            ...live,
            think: capBody(live.think + chunk.text, MAX_THINK_TEXT),
            thinkSince: live.thinkSince ?? (live.think === '' ? event.time : live.thinkSince),
          }
        } else if (live.thinkSince === null) {
          live = { ...live, thinkSince: event.time }
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
      const text = blocksText(event.data.message.content, MAX_ASSISTANT_TEXT)
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
        callId: String(event.data.callId),
        name: event.data.name,
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
      const decoded = decodeToolResult(event)
      const text = blocksText(event.data.message.content, MAX_TOOL_TEXT)
      const status: ToolStatus = decoded?.isError === true ? 'error' : 'done'
      const callId = decoded?.callId ?? ''
      const index = findToolByCallId(nodes, callId)
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
        nodes = appendNode(nodes, {
          kind: 'tool',
          id: event.seq,
          callId,
          name: 'tool',
          detail: 'tool',
          status,
          text,
          args: undefined,
          callCard: null,
          resultCard: null,
        }, scratch)
      }
      if (status === 'done') {
        const seen = new Set(scratch.turnProduced)
        for (const path of producedPaths(scratch.toolCallCards.get(callId))) {
          if (seen.has(path)) continue
          seen.add(path)
          scratch.turnProduced.push(path)
        }
      }
      scratch.toolCallCards.delete(callId)
      const start = scratch.toolStarts.get(callId)
      if (start !== undefined) {
        scratch.toolStarts.delete(callId)
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
      if (scratch.turnProduced.length > 0) {
        nodes = appendNode(nodes, { kind: 'deliverables', id: event.seq, paths: [...scratch.turnProduced] }, scratch)
      }
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
    case 'tool/code-dispatch-start': {
      nodes = appendNode(nodes, {
        kind: 'tool',
        id: event.seq,
        callId: String(event.data.subCallId),
        name: event.data.name,
        parentCallId: String(event.data.parentCallId),
        detail: `${event.data.name} ${previewUnknownArgs(event.data.arguments)}`,
        status: 'running',
        text: '',
        args: event.data.arguments,
        callCard: null,
        resultCard: null,
      }, scratch)
      scratch.toolStarts.set(String(event.data.subCallId), event.time)
      traces = appendTrace(traces, trace(event.seq, `tool ${event.data.name}`), scratch)
      break
    }
    case 'tool/code-dispatch': {
      const callId = String(event.data.subCallId)
      const text = blocksText(event.data.content, MAX_TOOL_TEXT)
      const status: ToolStatus = event.data.isError ? 'error' : 'done'
      const index = findToolByCallId(nodes, callId)
      if (index >= 0) {
        const running = nodes[index]
        if (running !== undefined && running.kind === 'tool') {
          nodes = writableNodes(nodes, scratch)
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
        nodes = appendNode(nodes, {
          kind: 'tool',
          id: event.seq,
          callId,
          name: event.data.name,
          parentCallId: String(event.data.parentCallId),
          detail: event.data.name,
          status,
          text,
          args: undefined,
          callCard: null,
          resultCard: null,
        }, scratch)
      }
      scratch.toolStarts.delete(callId)
      traces = appendTrace(traces, trace(event.seq, `result ${status}`), scratch)
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
      // `session/end-seed`, approval audit pairs, and
      // plugin-merged types are structural: no transcript row.
      break
  }
  return {
    nodes: trimFoldNodes(nodes, scratch),
    trace: trimRing(traces, MAX_TRACE, scratch),
    todos,
    live,
    stats,
    plan,
    goal,
    compaction,
  }
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
