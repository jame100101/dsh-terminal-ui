import { describe, expect, it } from 'vitest'
import stringWidth from 'string-width'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { anchorRetry, applyEvent, createScratch, foldFromLog, initialState } from '../src/fold'
import type { FoldState } from '../src/types'
import { parseMouseWheel, scrollOffsetForWheel, stripMouseReports } from '../src/mouse'
import { fitStatsStrip, formatStats, localizeFoldStatus, markdownLines, renderNodePlain, welcomeText } from '../src/plain'

/** Display width alias used by the table alignment assertions. */
const stringWidthOf = stringWidth

/** Build one fake log event with the seq and time it occupies. */
function event(type: string, data: unknown, seq: number, time = seq): SessionEvent {
  return { type, seq, time, data } as SessionEvent
}

const text = (value: string): ContentBlock => ({ type: 'text', text: value })

/** The canonical sequence: one turn with thinking, two tools, usage. */
function canonicalSequence(): SessionEvent[] {
  return [
    event('turn/start', { turn: 1 }, 0, 0),
    event('step/start', { turn: 1, step: 1 }, 1, 10),
    event('user/message', { id: 'm1', role: 'user', content: [text('fix the tests')], source: { kind: 'user' } }, 2, 20),
    event('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'first inspect' } }, 3, 100),
    event('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 1, text: 'Let me look.' } }, 4, 110),
    event('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'read', arguments: '{"path":"a.ts"}' }, 5, 120),
    event('tool/result', { turn: 1, step: 1, message: { role: 'user', content: [{ type: 'tool-result', toolCallId: 'c1', content: [text('line one')] }] } }, 6, 320),
    event('tool/call', { turn: 1, step: 1, callId: 'c2', name: 'bash', arguments: '{"command":"pnpm test"}' }, 7, 330),
    event('tool/result', { turn: 1, step: 1, message: { role: 'user', content: [{ type: 'tool-result', toolCallId: 'c2', content: [text('ok')] }], isError: false } }, 8, 430),
    event('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 800 } } }, 9, 440),
    event('assistant/message', { turn: 1, step: 1, message: { id: 'a1', role: 'assistant', content: [text('All green.')], source: { kind: 'model' } } }, 10, 450),
    event('step/end', { turn: 1, step: 1 }, 11, 460),
    event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 12, 470),
  ]
}

function foldAll(events: readonly SessionEvent[]): FoldState {
  let state = initialState()
  const scratch = createScratch()
  for (const next of events) state = applyEvent(state, next, scratch)
  return state
}

describe('session fold', () => {
  it('folds one completed turn into user/think/tool/assistant rows', () => {
    const state = foldAll(canonicalSequence())
    expect(state.live).toBeNull()
    expect(state.nodes.map(node => node.kind)).toEqual([
      'user', 'think', 'tool', 'tool', 'assistant', 'status',
    ])
    const tools = state.nodes.filter(node => node.kind === 'tool')
    expect(tools.map(node => (node.kind === 'tool' ? node.status : undefined))).toEqual(['done', 'done'])
    expect(tools[0]?.text).toBe('line one')
    // The think row carries the block's thinking time: first reasoning chunk
    // at t=100, flushed by the first tool call at t=120 → 20ms.
    const think = state.nodes.find(node => node.kind === 'think')
    expect(think?.kind === 'think' && think.durationMs).toBe(20)
    const assistant = state.nodes.findLast(node => node.kind === 'assistant')
    expect(assistant?.text).toBe('All green.')
    // The assistant row carries the message id for durable feedback targets.
    expect(assistant?.kind === 'assistant' && assistant.messageId).toBe('a1')
  })

  it('folds plan/mode flips and /plan pending selections', () => {
    const pending = foldAll([
      event('command/run', { name: 'plan', args: 'on' }, 0),
      event('plan/mode', { active: true }, 1),
      event('command/run', { name: 'plan', args: 'off' }, 2),
    ])
    expect(pending.plan).toEqual({ active: true, pending: true })
    const after = foldAll([
      event('command/run', { name: 'plan', args: 'off' }, 0),
      event('plan/mode', { active: false }, 1),
    ])
    expect(after.plan).toEqual({ active: false, pending: false })
    // A committed flip leaves a status row narrating the change.
    expect(after.nodes.some(node => node.kind === 'status' && node.text === '◈ plan 模式关闭')).toBe(true)
  })

  it('folds goal/change whole values into the goal row and status lines', () => {
    const create = {
      kind: 'goal/change', version: 1, operation: 'create',
      goal: { id: 'g1', revision: 1, objective: '修好所有测试', phase: 'active', maxGoalRounds: 12 },
      roundsStarted: 0, createdAt: 1000, updatedAt: 1000,
    }
    const blocked = {
      kind: 'goal/change', version: 1, operation: 'block',
      goal: { id: 'g1', revision: 2, objective: '修好所有测试', phase: 'blocked', blockedReason: { code: 'no-key', message: '缺少 API key' }, maxGoalRounds: 12 },
      roundsStarted: 2, createdAt: 1000, updatedAt: 2000,
    }
    const cleared = foldAll([
      event('goal/change', create, 0),
      event('goal/change', blocked, 1),
      event('goal/change', { kind: 'goal/change', version: 1, operation: 'clear', cleared: { id: 'g1', revision: 2 }, clearedAt: 3000 }, 2),
    ])
    expect(cleared.goal).toBeNull()
    const blockedState = foldAll([event('goal/change', blocked, 1)])
    expect(blockedState.goal?.phase).toBe('blocked')
    expect(blockedState.goal?.blockedReason?.code).toBe('no-key')
    expect(blockedState.goal?.roundsStarted).toBe(2)
    expect(blockedState.nodes.some(node => node.kind === 'status' && node.text.includes('goal block'))).toBe(true)
  })

  it('keeps raw chunk deltas in the live buffer until the message settles', () => {
    let state = initialState()
    const scratch = createScratch()
    state = applyEvent(state, event('step/start', { turn: 1, step: 1 }, 1, 10), scratch)
    state = applyEvent(state, event('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'a' } }, 2, 20), scratch)
    state = applyEvent(state, event('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'b' } }, 3, 30), scratch)
    expect(state.live?.text).toBe('ab')
    expect(state.nodes).toHaveLength(0)
  })

  it('marks a failed tool result as an error row', () => {
    const state = foldAll([
      event('turn/start', { turn: 1 }, 0),
      event('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{"command":"nope"}' }, 1, 10),
      event('tool/result', { turn: 1, step: 1, message: { role: 'user', content: [{ type: 'tool-result', toolCallId: 'c1', content: [text('boom')] }] }, error: { name: 'Error', code: 'FAILED' } }, 2, 20),
    ])
    const tool = state.nodes.find(node => node.kind === 'tool')
    expect(tool?.kind === 'tool' && tool.status).toBe('error')
  })

  it('records turn failures as status rows after the turn tail', () => {
    const state = foldAll([
      event('turn/start', { turn: 1 }, 0),
      event('turn/end', { turn: 1, reason: { kind: 'error', error: { message: 'context overflow', code: 'CONTEXT_WINDOW_EXCEEDED' } } }, 1),
    ])
    expect(state.nodes).toHaveLength(2)
    expect(state.nodes[0]?.kind).toBe('status')
    expect(state.nodes[0]?.kind === 'status' && state.nodes[0].text.startsWith('└ turn 1 ·')).toBe(true)
    const failure = state.nodes[1]
    expect(failure?.kind).toBe('status')
    expect(failure?.kind === 'status' && failure.text).toContain('CONTEXT_WINDOW_EXCEEDED')
  })

  it('replays deterministically: the same prefix yields the same rows', () => {
    const once = foldAll(canonicalSequence())
    const twice = foldAll(canonicalSequence())
    expect(twice).toEqual(once)
  })

  it('folds one turn with multiple tool calls into a single merged think node', () => {
    const state = foldAll([
      event('turn/start', { turn: 1 }, 0),
      event('step/start', { turn: 1, step: 1 }, 1, 10),
      event('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: '第一段思考' } }, 2, 20),
      event('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'read', arguments: '{}' }, 3, 30),
      event('tool/result', { turn: 1, step: 1, message: { role: 'user', content: [{ type: 'tool-result', toolCallId: 'c1', content: [text('ok')] }] } }, 4, 40),
      event('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 1, text: '第二段思考' } }, 5, 50),
      event('tool/call', { turn: 1, step: 1, callId: 'c2', name: 'bash', arguments: '{}' }, 6, 60),
      event('tool/result', { turn: 1, step: 1, message: { role: 'user', content: [{ type: 'tool-result', toolCallId: 'c2', content: [text('ok')] }] } }, 7, 70),
      event('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 2, text: '第三段思考' } }, 8, 80),
      event('assistant/message', { turn: 1, step: 1, message: { id: 'a1', role: 'assistant', content: [text('完成')] } }, 9, 90),
    ])
    // One think node per turn, segments appended in order — no repeated
    // "Thinking" rows for every tool call.
    const thinks = state.nodes.filter(node => node.kind === 'think')
    expect(thinks).toHaveLength(1)
    expect(thinks[0]?.kind === 'think' && thinks[0].text).toBe('第一段思考第二段思考第三段思考')
  })

  it('renders every row kind through the plain projector', () => {
    const state = foldAll(canonicalSequence())
    for (const node of state.nodes) {
      expect(renderNodePlain(node).length).toBeGreaterThan(0)
    }
  })

  it('folds injected context into a collapsed disclosure row with its producer', () => {
    const state = foldAll([
      event('user/message', { id: 'm1', role: 'user', content: [text('instructions body')], source: { kind: 'plugin', plugin: 'dsh-agent-instructions' } }, 0),
    ])
    expect(state.nodes).toHaveLength(1)
    const node = state.nodes[0]
    expect(node?.kind).toBe('context')
    if (node?.kind === 'context') {
      expect(node.producer).toBe('dsh-agent-instructions')
      expect(node.text).toBe('instructions body')
    }
    const rendered = node === undefined ? '' : renderNodePlain(node)
    expect(rendered.startsWith('◆ 上下文注入 · dsh-agent-instructions')).toBe(true)
  })

  it('accumulates structural trace lines for the trajectory view', () => {
    const state = foldAll(canonicalSequence())
    const texts = state.trace.map(entry => entry.text)
    expect(texts[0]).toBe('turn 1 start')
    expect(texts.some(line => line.startsWith('step 1.1 start'))).toBe(true)
    expect(texts.some(line => line.startsWith('tool read'))).toBe(true)
    expect(texts.some(line => line.startsWith('result done'))).toBe(true)
    expect(texts.at(-1)).toBe('turn 1 end (completed)')
  })

  it('keeps the latest whole-list todo snapshot', () => {
    const state = foldAll([
      event('todo/write', { todos: [{ content: 'a', status: 'in_progress' }] }, 0),
      event('todo/write', { todos: [{ content: 'a', status: 'completed' }] }, 1),
    ])
    expect(state.todos).toEqual([{ content: 'a', status: 'completed' }])
  })

  it('folds command/done into success and error status rows', () => {
    const state = foldAll([
      event('command/done', { commandId: 'c1', kind: 'success', text: 'done text' }, 0),
      event('command/done', { commandId: 'c2', kind: 'error', text: 'boom' }, 1),
    ])
    expect(state.nodes[0]).toMatchObject({ kind: 'status', error: false, text: 'done text' })
    const failure = state.nodes[1]
    expect(failure?.kind).toBe('status')
    if (failure?.kind === 'status') expect(failure.error).toBe(true)
  })

  it('folds the Web stats: turns, steps, LLM/tool wall times, TTFT, tokens, cache', () => {
    const state = foldAll(canonicalSequence())
    const stats = state.stats
    expect(stats.turns).toBe(1)
    expect(stats.steps).toBe(1)
    // step/start at t=10, first chunk t=100, last model chunk t=110 (the
    // tool calls follow the model call, and the usage chunk is not timed).
    expect(stats.ttftMs).toBe(90)
    expect(stats.stepsWithTtft).toBe(1)
    expect(stats.llmMs).toBe(100)
    expect(stats.decodeMs).toBe(10)
    // tool c1: 120→320; c2: 330→430.
    expect(stats.toolMs).toBe(300)
    expect(stats.tokens).toMatchObject({ input: 100, output: 50, cacheRead: 800 })
    const line = formatStats(stats)
    expect(line).toContain('轮 1')
    expect(line).toContain('步 1')
    expect(line).toContain('TTFT 90ms')
    expect(line).toContain('缓存 89% 命中')
    expect(line).toContain('↑100')
    // The turn tail mirrors the Web per-turn statistics.
    const tail = state.nodes.find(node => node.kind === 'status' && node.text.startsWith('└ turn'))
    expect(tail?.kind === 'status' && tail.text).toBe('└ turn 1 · LLM 100ms · 工具 300ms · TTFT 90ms')
  })

  it('folds the context window from request/context', () => {
    const state = foldAll([
      event('request/context', { provider: 'deepseek-official', model: 'deepseek-v4-flash', contextWindow: 128000 }, 0),
    ])
    expect(state.stats.contextWindow).toBe(128000)
  })

  it('folds one retry chain into a single row with safe failure facts', () => {
    const retryEvent = (retry: number, delayMs: number): SessionEvent => event('llm/retry', {
      retryId: 'r1', turn: 1, step: 1, provider: 'deepseek-official', mode: 'normal',
      policyKey: 'default', retry, maxRetries: 3, delayMs,
      failure: { message: 'secret sk-abc', code: 'rate_limit', status: 429 },
    }, retry)
    const state = foldAll([retryEvent(1, 12000), retryEvent(2, 24000)])
    expect(state.nodes).toHaveLength(1)
    const node = state.nodes[0]
    expect(node?.kind).toBe('retry')
    if (node?.kind === 'retry') {
      expect(node.retryId).toBe('r1')
      expect(node.retry).toBe(2)
      expect(node.maxRetries).toBe(3)
      expect(node.delayMs).toBe(24000)
      expect(node.started).toBe(false)
      expect(node.retryAt).toBe(0)
      // The failure message never reaches the fold (credential safety).
      expect(node.failure).toEqual({ code: 'rate_limit', status: 429 })
    }
  })

  it('settles the retry row when llm/retry-started arrives', () => {
    const state = foldAll([
      event('llm/retry', {
        retryId: 'r1', turn: 1, step: 1, provider: 'deepseek-official', mode: 'always',
        policyKey: 'auth', retry: 1, delayMs: 1000,
        failure: { message: 'secret', code: 'auth_error' },
      }, 1),
      event('llm/retry-started', { retryId: 'r1', turn: 1, step: 1, retry: 1 }, 2),
    ])
    const node = state.nodes[0]
    expect(node?.kind).toBe('retry')
    if (node?.kind === 'retry') {
      expect(node.started).toBe(true)
      expect(node.retryAt).toBe(0)
      expect(node.maxRetries).toBeNull() // always mode renders as ∞
    }
  })

  it('anchors a retry countdown to the wall clock without breaking fold determinism', () => {
    const retryEvent = event('llm/retry', {
      retryId: 'r1', turn: 1, step: 1, provider: 'deepseek-official', mode: 'normal',
      policyKey: 'default', retry: 1, maxRetries: 3, delayMs: 12000,
      failure: { message: 'x', code: 'timeout' },
    }, 1)
    const state = foldAll([retryEvent])
    const node = state.nodes[0]
    if (node?.kind !== 'retry') throw new Error('expected a retry row')
    expect(node.retryAt).toBe(0) // the pure fold stamps no wall-clock values
    anchorRetry(state, retryEvent, 1000)
    // anchorRetry replaces the row element (array identity survives), so the
    // anchored value is read back from the array, not the stale reference.
    expect(state.nodes[0]?.kind === 'retry' && state.nodes[0].retryAt).toBe(13000)
    expect(node.retryAt).toBe(0)
  })

  it('keeps nodes/trace referentially stable across streaming chunks', () => {
    let state = initialState()
    const scratch = createScratch()
    state = applyEvent(state, event('turn/start', { turn: 1 }, 1, 10), scratch)
    state = applyEvent(state, event('user/message', { id: 'm1', role: 'user', content: [text('hi')], source: { kind: 'user' } }, 2, 20), scratch)
    const settledNodes = state.nodes
    state = applyEvent(state, event('step/start', { turn: 1, step: 1 }, 3, 30), scratch)
    const stepTrace = state.trace
    state = applyEvent(state, event('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'a' } }, 4, 40), scratch)
    state = applyEvent(state, event('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'b' } }, 5, 50), scratch)
    // Chunks change only the live buffer: the settled arrays keep identity,
    // which the renderer's per-node memoization depends on.
    expect(state.nodes).toBe(settledNodes)
    expect(state.trace).toBe(stepTrace)
    expect(state.live?.text).toBe('ab')
  })

  it('projects markdown into structural lines without inline markers', () => {
    const lines = markdownLines('# Title\n\nSome **bold** text\n\n```ts\nconst x = 1\n```\n\n- item one\n- item two')
    const texts = lines.map(line => line.text)
    expect(texts).toContain('Title')
    expect(texts).toContain('Some bold text')
    expect(texts).toContain('│ const x = 1')
    expect(texts).toContain('• item one')
    expect(texts.some(text => text.includes('**'))).toBe(false)
    expect(texts[texts.indexOf('Title') + 1]).toBe('')
    expect(texts[texts.indexOf('Some bold text') + 1]).toBe('')
  })

  it('renders GFM tables as cell-width-aligned grids', () => {
    const lines = markdownLines('| 名称 | 数 |\n| --- | --: |\n| 短 | 1 |\n| 一个更长 | 200 |\n', 40)
    const texts = lines.map(line => line.text)
    // Natural column widths (8 cells / 3 cells, second column right-aligned),
    // a matching `├─┼─┤` separator, and body rows padded to the same grid.
    // Each cell sits between `│ ` and ` │`, so its pad spaces plus the border
    // space appear together.
    expect(texts[0]).toBe('│ 名称     │  数 │')
    expect(texts[1]).toBe('├──────────┼─────┤')
    expect(texts[2]).toBe('│ 短       │   1 │')
    expect(texts[3]).toBe('│ 一个更长 │ 200 │')
    // Every GRID row (markdownLines appends one trailing empty line) has the
    // same cell width, so all column borders line up.
    expect(new Set(texts.slice(0, 4).map(line => stringWidthOf(line))).size).toBe(1)
  })

  it('shrinks over-wide tables to the available width with truncation', () => {
    const lines = markdownLines('| 很长的第一列 | 第二 |\n| --- | --- |\n| 一二三四五六七八九十一二三四五六七八九十 | x |\n', 20)
    for (const line of lines) {
      expect(stringWidthOf(line.text)).toBeLessThanOrEqual(20)
    }
    expect(lines.some(line => line.text.includes('…'))).toBe(true)
  })

  it('parses wheel reports and strips them from typed text (DamnatioX mouse API)', () => {
    expect(parseMouseWheel('\x1b[<64;10;5M')).toBe('up')
    expect(parseMouseWheel('\x1b[<65;10;5M')).toBe('down')
    expect(parseMouseWheel('\x1b[<64;10;5m')).toBe('up')
    expect(parseMouseWheel('\x1b[<0;2;2M')).toBeNull()
    expect(parseMouseWheel('plain text')).toBeNull()
    expect(parseMouseWheel('')).toBeNull()
    expect(stripMouseReports('abc\x1b[<64;2;2Mdef')).toBe('abcdef')
    expect(scrollOffsetForWheel(0, 12, 'up')).toBe(3)
    expect(scrollOffsetForWheel(0, 12, 'down')).toBe(0)
    expect(scrollOffsetForWheel(11, 12, 'up')).toBe(12)
    expect(scrollOffsetForWheel(3, 12, 'down')).toBe(0)
  })

  it('replays a persisted log into the complete history (resume parity)', () => {
    const events: SessionEvent[] = [
      ...canonicalSequence(),
      event('compaction/start', { compactionId: 'c1', turn: 1 }, 13, 500),
      event('compaction/end', { compactionId: 'c1', turn: 1 }, 14, 520),
      event('command/run', { name: 'plan', args: 'on' }, 15, 530),
      event('plan/mode', { active: true }, 16, 540),
      event('goal/change', {
        version: 1, operation: 'create',
        goal: { objective: 'ship it', phase: 'active', revision: 1, maxGoalRounds: 5 },
        roundsStarted: 0, createdAt: 1000, updatedAt: 1000,
      }, 17, 550),
    ]
    const replayed = foldFromLog(events)
    // The whole history renders: user + think + tools + assistant + tails.
    expect(replayed.fold.nodes.map(node => node.kind)).toEqual([
      'user', 'think', 'tool', 'tool', 'assistant', 'status',
      'status', 'status', 'status',
    ])
    expect(replayed.fold.nodes.some(node => node.kind === 'status' && node.text === 'compacted')).toBe(true)
    expect(replayed.fold.nodes.some(node => node.kind === 'user' && node.text === 'fix the tests')).toBe(true)
    expect(replayed.fold.compaction).toBe(false)
    expect(replayed.fold.plan).toEqual({ active: true, pending: false })
    expect(replayed.fold.goal?.objective).toBe('ship it')
    // Replay equals incremental folding over the same prefix.
    expect(replayed.fold.nodes).toEqual(foldAll(events).nodes)
  })

  it('replays a large history in one batch and restores immutable live publication afterward', () => {
    const events = Array.from({ length: 10_000 }, (_, index) => event('user/message', {
      id: `message-${index}`,
      role: 'user',
      content: [text(`history ${index}`)],
      source: { kind: 'user' },
    }, index))
    const replayed = foldFromLog(events)
    expect(replayed.fold.nodes).toHaveLength(events.length)
    expect(replayed.fold.trace).toHaveLength(events.length)
    expect(replayed.fold.nodes.at(-1)).toMatchObject({ kind: 'user', text: 'history 9999' })

    const replayNodes = replayed.fold.nodes
    const next = applyEvent(replayed.fold, event('command/done', {
      name: 'help', kind: 'success', text: 'after resume',
    }, events.length), replayed.scratch)
    expect(next.nodes).not.toBe(replayNodes)
    expect(replayNodes).toHaveLength(events.length)
    expect(next.nodes).toHaveLength(events.length + 1)
  })

  it('formats the stats strip per locale with the occupancy projection first', () => {
    const withWindow = [...canonicalSequence(), event('request/context', { provider: 'p', model: 'm', contextWindow: 128_000 }, 100)]
    const stats = foldAll(withWindow).stats
    expect(formatStats(stats, 'en')).toContain('turn 1')
    expect(formatStats(stats, 'en')).toContain('step 1')
    expect(formatStats(stats, 'en')).toContain('tools 300ms')
    expect(formatStats(stats, 'en')).toContain('cache 89% hit')
    const occupancy = { projectedTokens: 64_000, contextWindow: 128_000 }
    expect(formatStats(stats, 'zh', occupancy)).toContain('占用 50%/128k')
    expect(formatStats(stats, 'en', occupancy)).toContain('occupied 50%/128k')
    // A zero projected value falls back to the billed-tokens group.
    expect(formatStats(stats, 'zh', { projectedTokens: 0, contextWindow: 128_000 })).toContain('%/128k')
  })

  it('localizes deterministic fold and linear-fallback chrome in English', () => {
    const statuses = [
      '└ turn 2 · LLM 10ms · 工具 20ms',
      '◈ plan 模式开启',
      '◈ plan 模式关闭',
      '◆ goal 已清除',
      '◆ goal update · 已阻塞 · waiting',
    ].map(status => localizeFoldStatus(status, 'en'))
    const linear = [
      renderNodePlain({ kind: 'context', id: 1, producer: 'system', text: 'details' }, 'en'),
      renderNodePlain({
        kind: 'retry', id: 2, retryId: 'retry-1', turn: 1, step: 1, provider: 'p', policyKey: 'default', retry: 1,
        maxRetries: 3, delayMs: 100, retryAt: 0, started: false, failure: { code: 'rate-limit' },
      }, 'en'),
      welcomeText('en'),
    ]
    expect(statuses).toEqual([
      '└ turn 2 · LLM 10ms · tools 20ms',
      '◈ plan mode on',
      '◈ plan mode off',
      '◆ goal cleared',
      '◆ goal update · blocked · waiting',
    ])
    expect([...statuses, ...linear].join('\n')).not.toMatch(/\p{Script=Han}/u)
  })

  it('fits the stats strip by dropping whole groups, never ellipses', () => {
    const strip = '轮 128 · 步 512 · LLM 12.3s · 工具 8.1s · TTFT 900ms · 1.2k tok/s · 缓存 45% 命中 · ↑9.9M ↓8.8M Σ19M · 占用 78%/128k'
    expect(fitStatsStrip(strip, 20)).not.toContain('…')
    expect(fitStatsStrip(strip, 20)).toBe('轮 128 · 步 512')
    // The full strip passes through when it fits.
    expect(fitStatsStrip('轮 1 · 步 2', 60)).toBe('轮 1 · 步 2')
  })

  it('marks interrupted assistant prefixes and shows image placeholders', () => {
    const interrupted = foldAll([
      event('assistant/message', {
        turn: 1,
        step: 1,
        interrupted: true,
        message: { id: 'a2', role: 'assistant', content: [text('half')], source: { kind: 'model' } },
      }, 1, 10),
    ])
    const row = interrupted.nodes.find(node => node.kind === 'assistant')
    expect(row?.kind === 'assistant' && row.interrupted).toBe(true)
    expect(renderNodePlain(row!, 'zh')).toContain('已中断')
    expect(renderNodePlain(row!, 'en')).toContain('interrupted')
    const withImage = foldAll([
      event('user/message', {
        id: 'm2',
        role: 'user',
        content: [{
          type: 'image',
          attachment: {
            attachmentId: 'att-1' as never,
            mediaType: 'image/png',
            bytes: 12,
            width: 2,
            height: 2,
            name: 'shot.png',
          },
        }],
        source: { kind: 'user' },
      }, 1, 10),
    ])
    expect(withImage.nodes.find(node => node.kind === 'user')?.text).toContain('📎 shot.png')
  })

  it('keeps parsed args only while a tool is running and caps settled result text', () => {
    const huge = 'y'.repeat(12_000)
    const running = foldAll([
      event('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{"command":"cat huge.log"}' }, 1, 10),
    ])
    const runningNode = running.nodes.find(node => node.kind === 'tool')
    expect(runningNode?.kind === 'tool' && runningNode.args).toEqual({ command: 'cat huge.log' })
    const settled = foldAll([
      event('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{"command":"cat huge.log"}' }, 1, 10),
      event('tool/result', {
        turn: 1,
        step: 1,
        message: { role: 'user', content: [{ type: 'tool-result', toolCallId: 'c1', content: [text(huge)] }] },
      }, 2, 20),
    ])
    const tool = settled.nodes.find(node => node.kind === 'tool')
    expect(tool?.kind === 'tool' && tool.args).toBeUndefined()
    expect(tool?.kind === 'tool' && tool.callCard).toBeNull()
    expect(tool?.kind === 'tool' && tool.text.length).toBe(4000)
    expect(JSON.stringify(tool).length).toBeLessThan(huge.length)
  })
})
