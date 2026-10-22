/** Real official loop/tool/approval/persistence; only model transport is scripted. */
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { boot, createRuntimeResolution, PluginPackages, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { createUserMessage, ToolCallId, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTuiAgent } from '../src/preset-lifecycle'
import { readTuiSession } from '../src/session-read'
import { MockAdapter, textResponse } from './mock-adapter'

function toolResponse(id: string): StreamChunk[] {
  const call = { type: 'tool-call' as const, id: ToolCallId(id), name: 'inbox_gate', arguments: '{}' }
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'block-end', index: 0, block: call },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 2 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

function prompt(text: string) {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

describe('official busy inbox queue and steering', () => {
  let ctx: Context
  let home: string
  let workspace: string
  let reached: ReturnType<typeof Promise.withResolvers<void>>
  let release: ReturnType<typeof Promise.withResolvers<void>>

  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), 'dsh-tui-inbox-'))
    workspace = join(home, 'workspace')
    await mkdir(workspace)
    vi.stubEnv('DSH_HOME', home)
    const config = join(home, 'cordis.yml')
    await writeFile(config, '[]\n')
    const require = createRequire(import.meta.url)
    const installAnchor = require.resolve('@deepseek-ai/dsh/package.json')
    const resolution = await createRuntimeResolution({ installAnchor, home })
    ctx = await boot('tui-inbox-roundtrip', config, [
      ...loadOverlayPatches('tui-inbox-roundtrip', require.resolve('@deepseek-ai/dsh-base/cordis.patch.yml')),
      { id: 'session-persistence-jsonl', config: { root: join(home, 'sessions') } },
      { id: 'storage-json', config: { root: join(home, 'storages') } },
      { id: 'session-telemetry-otel', disabled: true },
      { id: 'hmr', disabled: true },
      { id: 'session-title-llm', disabled: true },
    ], async root => {
      await root.plugin(PluginPackages, { resolution })
      provideCmdline(root, { args: [], exit: () => {} })
    }, pathToFileURL(installAnchor).href)
    ctx.tools.register(defineTool({
      name: 'inbox_gate', description: 'A deterministic busy-loop test gate.', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async () => { reached.resolve(); await release.promise; return 'released' },
    }))
  }, 120_000)

  afterAll(async () => {
    await ctx?.fiber.dispose()
    vi.unstubAllEnvs()
    if (home !== undefined) await rm(home, { recursive: true, force: true })
  })

  for (const mode of ['queue', 'steer'] as const) {
    it(`consumes ${mode} exactly once at its official boundary while a real tool is running`, async () => {
      reached = Promise.withResolvers<void>(); release = Promise.withResolvers<void>()
      const adapter = new MockAdapter([toolResponse('busy-gate'), textResponse('first answer'), textResponse('queued answer')])
      const off = ctx.llm.registerAdapter(['inbox-test'], adapter)
      const created = await createTuiAgent(ctx, workspace)
      created.ref.current = { provider: 'inbox-test', model: 'fixture-model' }
      const first = prompt('initial request')
      const appended = prompt(`busy ${mode} addition`)
      try {
        created.agent.followup(first)
        await reached.promise
        expect(created.agent.session.snapshotEvents().filter(e => e.type === 'turn/end')).toHaveLength(0)
        if (mode === 'queue') created.agent.followup(appended)
        else created.agent.steer(appended)
        release.resolve()
        await created.agent.whenIdle()
        const events = created.agent.session.snapshotEvents()
        const messages = events.filter(e => e.type === 'user/message')
        expect(messages.filter(e => e.data.id === first.id)).toHaveLength(1)
        expect(messages.filter(e => e.data.id === appended.id)).toHaveLength(1)
        expect(events.filter(e => e.type === 'turn/start')).toHaveLength(mode === 'queue' ? 2 : 1)
        expect(events.filter(e => e.type === 'turn/end')).toHaveLength(mode === 'queue' ? 2 : 1)
        expect(adapter.requests).toHaveLength(mode === 'queue' ? 3 : 2)
        const firstEnd = events.find(e => e.type === 'turn/end')!
        const appendedEvent = messages.find(e => e.data.id === appended.id)!
        expect(appendedEvent.seq > firstEnd.seq).toBe(mode === 'queue')
        expect(events.filter(e => e.type === 'tool/result')).toHaveLength(1)
        expect(await ctx.sessions.flush(created.agent.session)).toBe(true)
        const stored = await readTuiSession(ctx.sessionQuery, created.agent.id)
        expect(stored.events.filter(e => e.type === 'user/message' && e.data.id === appended.id)).toHaveLength(1)
      } finally { release.resolve(); off(); await created.handle.dispose() }
    }, 20_000)
  }
})
