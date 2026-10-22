/** Official loop/retry/tool events; only the provider transport is scripted. */
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { boot, createRuntimeResolution, PluginPackages, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { createUserMessage, ToolCallId, LlmAdapter, LlmError, type GenerateOptions, type StreamChunk, type ResolvedRetryPolicy } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTuiAgent } from '../src/preset-lifecycle'
import { anchorRetry, foldFromLog } from '../src/fold'
import { retryCountdownSeconds } from '../src/plain'
import { mergeHistoricalJobs } from '../src/jobs-projection'
import { readTuiSession } from '../src/session-read'
import type { JobOutcome } from '@deepseek-ai/dsh-jobs'
import { textResponse } from './mock-adapter'

class RetryAdapter extends LlmAdapter {
  calls = 0
  constructor(private readonly script: (StreamChunk[] | Error)[], private readonly delay = 80) { super() }
  override providerRetryPolicy(): ResolvedRetryPolicy { return { mode: 'normal', maxRetries: 1, retryableCodes: ['RATE_LIMIT'], initialDelayMs: this.delay, maxDelayMs: this.delay, jitterRatio: 0 } }
  override async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls += 1
    const next = this.script.shift()
    if (!next) throw new Error('fixture script exhausted')
    if (next instanceof Error) throw next
    yield* next
  }
}
const prompt = (text: string) => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })

describe('official retry ownership and cancellation', () => {
  let ctx: Context
  let home: string
  let workspace: string
  let toolExecutions = 0
  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), 'dsh-retry-contract-'))
    workspace = join(home, 'workspace')
    await mkdir(workspace)
    vi.stubEnv('DSH_HOME', home)
    const config = join(home, 'cordis.yml')
    await writeFile(config, '[]\n')
    const require = createRequire(import.meta.url)
    const installAnchor = require.resolve('@deepseek-ai/dsh/package.json')
    const resolution = await createRuntimeResolution({ installAnchor, home })
    ctx = await boot('tui-retry-contract', config, [
      ...loadOverlayPatches('tui-retry-contract', require.resolve('@deepseek-ai/dsh-base/cordis.patch.yml')),
      { id: 'session-persistence-jsonl', config: { root: join(home, 'sessions') } },
      { id: 'storage-json', config: { root: join(home, 'storages') } },
      { id: 'session-telemetry-otel', disabled: true }, { id: 'hmr', disabled: true }, { id: 'session-title-llm', disabled: true },
    ], async root => { await root.plugin(PluginPackages, { resolution }); provideCmdline(root, { args: [], exit: () => {} }) }, pathToFileURL(installAnchor).href)
    ctx.tools.register(defineTool({ name: 'retry_probe', description: 'Count completed fixture operations.', parameters: {}, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute: async () => { toolExecutions += 1; return 'completed once' } }))
  }, 120000)
  afterAll(async () => { await ctx?.fiber.dispose(); vi.unstubAllEnvs(); if (home) await rm(home, { recursive: true, force: true }) })

  it('counts down to waiting and lets only the host start the next attempt', async () => {
    const adapter = new RetryAdapter([new LlmError('synthetic rate limit', 'RATE_LIMIT', { status: 429 }), textResponse('recovered')])
    const off = ctx.llm.registerAdapter(['retry-fixture'], adapter)
    const created = await createTuiAgent(ctx, workspace)
    created.ref.current = { provider: 'retry-fixture', model: 'fixture' }
    const reached = Promise.withResolvers<void>()
    const offEvent = ctx.on('session/event', (session, event) => { if (session === created.agent.session && event.type === 'llm/retry') reached.resolve() })
    try {
      created.agent.followup(prompt('retry the model request'))
      await reached.promise
      expect(adapter.calls).toBe(1)
      const event = created.agent.session.snapshotEvents().find(event => event.type === 'llm/retry')!
      const { fold } = foldFromLog(created.agent.session.snapshotEvents())
      anchorRetry(fold, event, 1000)
      const row = fold.nodes.find(node => node.kind === 'retry')!
      expect(row.kind).toBe('retry')
      if (row.kind !== 'retry') throw new Error('missing retry row')
      expect(retryCountdownSeconds(row.retryAt, 1000)).toBe(1)
      expect(retryCountdownSeconds(row.retryAt, row.retryAt)).toBeNull()
      expect(adapter.calls).toBe(1)
      await created.agent.whenIdle()
      expect(adapter.calls).toBe(2)
      const events = created.agent.session.snapshotEvents()
      expect(events.filter(event => event.type === 'llm/retry')).toHaveLength(1)
      expect(events.filter(event => event.type === 'llm/retry-started')).toHaveLength(1)
      expect(foldFromLog(events).fold.nodes.find(node => node.kind === 'retry')).toMatchObject({ started: true, retryAt: 0 })
    } finally { offEvent(); off(); await created.handle.dispose() }
  }, 20000)

  it('cancels a host wait and never starts a delayed second attempt', async () => {
    const adapter = new RetryAdapter([new LlmError('synthetic rate limit', 'RATE_LIMIT'), textResponse('must not run')], 100)
    const off = ctx.llm.registerAdapter(['retry-cancel-fixture'], adapter)
    const created = await createTuiAgent(ctx, workspace)
    created.ref.current = { provider: 'retry-cancel-fixture', model: 'fixture' }
    const reached = Promise.withResolvers<void>()
    const offEvent = ctx.on('session/event', (session, event) => { if (session === created.agent.session && event.type === 'llm/retry') reached.resolve() })
    try {
      created.agent.followup(prompt('cancel during backoff'))
      await reached.promise
      created.agent.cancel({ kind: 'user' })
      await created.agent.whenIdle()
      await new Promise(resolve => setTimeout(resolve, 150))
      expect(adapter.calls).toBe(1)
      const events = created.agent.session.snapshotEvents()
      expect(events.filter(event => event.type === 'llm/retry-started')).toHaveLength(0)
      expect(foldFromLog(events).fold.nodes.find(node => node.kind === 'retry')).toMatchObject({ terminal: 'cancelled', retryAt: 0, started: false })
      expect(events.filter(event => event.type === 'turn/end').at(-1)?.data.reason.kind).toBe('aborted')
    } finally { offEvent(); off(); await created.handle.dispose() }
  }, 20000)

  it('a user followup after request failure does not reexecute an already completed tool', async () => {
    const call = { type: 'tool-call' as const, id: ToolCallId('retry-side-effect'), name: 'retry_probe', arguments: '{}' }
    const tool: StreamChunk[] = [{ type: 'block-start', index: 0, blockType: 'tool-call' }, { type: 'block-end', index: 0, block: call }, { type: 'finish', reason: { kind: 'tool-calls' } }]
    const adapter = new RetryAdapter([tool, new LlmError('synthetic auth failure', 'AUTH'), textResponse('user requested continuation')])
    const off = ctx.llm.registerAdapter(['retry-manual-fixture'], adapter)
    const created = await createTuiAgent(ctx, workspace)
    created.ref.current = { provider: 'retry-manual-fixture', model: 'fixture' }
    const previous = toolExecutions
    try {
      created.agent.followup(prompt('perform operation'))
      await created.agent.whenIdle()
      expect(toolExecutions).toBe(previous + 1)
      expect(adapter.calls).toBe(2)
      expect(created.agent.session.snapshotEvents().filter(event => event.type === 'llm/retry')).toHaveLength(0)
      created.agent.followup(prompt('continue after correcting credentials'))
      await created.agent.whenIdle()
      expect(adapter.calls).toBe(3)
      expect(toolExecutions).toBe(previous + 1)
    } finally { off(); await created.handle.dispose() }
  }, 20000)
  it('projects an actual persisted job registration as interrupted once its live owner is gone', async () => {
    const created = await createTuiAgent(ctx, workspace)
    const done = Promise.withResolvers<JobOutcome>()
    let starts = 0
    const detach = ctx.jobs.attachController('tui-cold-history-fixture')
    try {
      const id = ctx.jobs.start({ kind: 'bash', label: 'cold history fixture', owner: created.agent.id,
        run: () => { starts += 1; return { done: done.promise, cancel: () => done.resolve({ status: 'killed' }) } } })
      expect(await ctx.sessions.flush(created.agent.session)).toBe(true)
      const saved = await readTuiSession(ctx.sessionQuery, created.agent.id)
      expect(saved.events.find(event => event.type === 'job/registered')?.data).toMatchObject({ jobId: id, owner: created.agent.id })
      await created.handle.dispose()
      expect(ctx.jobs.list(created.agent.id)).toEqual([])
      expect(mergeHistoricalJobs([], saved.events, created.agent.id)).toMatchObject([{ id, status: 'interrupted' }])
      expect(starts).toBe(1)
    } finally { done.resolve({ status: 'killed' }); detach(); await created.handle.dispose() }
  }, 20000)

})
