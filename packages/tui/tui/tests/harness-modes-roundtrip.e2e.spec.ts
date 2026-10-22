import { terminalPresetSource } from '../../../../apps/tui-cli/scripts/preset-assets.mjs'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { boot, createRuntimeResolution, PluginPackages, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-plan-mode'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTuiAgent } from '../src/preset-lifecycle'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { loadSessionRows, SessionTitleCache } from '../src/harness/session-panel'
import { readTuiSession } from '../src/session-read'
import { prepareTuiResume } from '../src/resume-lifecycle'
import { MockAdapter, textResponse } from './mock-adapter'

async function bootModes(home: string): Promise<Context> {
  const require = createRequire(import.meta.url)
  const installAnchor = require.resolve('@deepseek-ai/dsh/package.json')
  const profileDir = join(home, 'profiles', 'spec')
  await mkdir(profileDir, { recursive: true })
  const config = join(profileDir, 'cordis.yml')
  const settings = join(home, 'settings.yaml')
  await writeFile(config, '[]\n'); await writeFile(settings, '{}\n')
  const files = await Promise.all(['standard', 'ptc', 'minimal', 'cordis'].map(async id => {
    const filename = join(profileDir, `${id}.patch.yml`)
    await writeFile(filename, terminalPresetSource(readFileSync(require.resolve(`@deepseek-ai/dsh-web-app/presets/${id}.patch.yml`), 'utf8')))
    return filename
  }))
  const resolution = await createRuntimeResolution({ installAnchor, home })
  const root = fileURLToPath(new URL('../../../..', import.meta.url))
  return boot('dsh-tui-preset-test', config, [
    ...loadOverlayPatches('dsh-tui-preset-test', require.resolve('@deepseek-ai/dsh-base/cordis.patch.yml')),
    ...loadOverlayPatches('dsh-tui-preset-test', join(root, 'apps/tui-cli/plugin/cordis.patch.yml')),
    ...files.flatMap(file => loadOverlayPatches('dsh-tui-preset-test', file)),
    { id: 'tui', disabled: true }, { id: 'hmr', disabled: true },
    { id: 'session-title-llm', disabled: true }, { id: 'session-telemetry-otel', disabled: true },
    { id: 'settings', config: { path: settings, watch: false } },
    { id: 'session-persistence-jsonl', config: { root: join(home, 'sessions') } },
    { id: 'storage-json', config: { root: join(home, 'storages') } },
  ], async ctx => {
    await ctx.plugin(PluginPackages, { resolution }); provideCmdline(ctx, { args: [], exit: () => {} })
  }, pathToFileURL(installAnchor).href)
}

describe('official Plan and sandbox mode boundaries', () => {
  let ctx: Context; let home: string; let workspace: string
  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), 'dsh-mode-matrix-'))
    workspace = join(home, 'workspace'); await mkdir(workspace)
    ctx = await bootModes(home)
  }, 120000)
  afterAll(async () => { await ctx?.fiber.dispose(); if (home) await rm(home, { recursive: true, force: true }) })

  for (const preset of ['standard', 'ptc']) {
    it(`keeps Plan, file permissions and tool exposure independent in ${preset}`, async () => {
      const created = await createTuiAgent(ctx, workspace, preset)
      const peer = await createTuiAgent(ctx, workspace, preset)
      const agent = created.agent
      const plan = ctx.agentPresets.serviceFor(agent, 'planMode')!
      const baselineTools = ctx.tools.schemas(agent).map(tool => tool.name).sort()
      const peerPolicy = ctx.sandboxPolicy.resolve({ session: peer.agent.session })
      const initialApprovalEvents = agent.session.snapshotEvents().filter(event => event.type.startsWith('approval/'))
      const initialSandboxEvents = agent.session.snapshotEvents().filter(event => event.type === 'sandbox/mode')
      try {
        expect(plan.get(agent).active).toBe(false)
        for (const mode of ['read-only', 'workspace-write'] as const) {
          setSandboxMode(agent.session, mode)
          for (const active of [true, false]) {
            expect(await ctx.commands.execute(agent, active ? '/plan' : '/plan off', [], new AbortController().signal)).toBeDefined()
            expect(plan.get(agent)).toMatchObject({ active })
            expect(ctx.sandboxPolicy.resolve({ session: agent.session })).toMatchObject({ mode, workspaceRoot: workspace })
            expect(ctx.tools.schemas(agent).map(tool => tool.name).sort()).toEqual(baselineTools)
            expect(ctx.agentPresets.serviceFor(peer.agent, 'planMode')!.get(peer.agent).active).toBe(false)
            expect(ctx.sandboxPolicy.resolve({ session: peer.agent.session })).toEqual(peerPolicy)
          }
        }
        const events = agent.session.snapshotEvents()
        expect(events.filter(event => event.type === 'plan/mode').map(event => event.data.active)).toEqual([true, false, true, false])
        expect(events.filter(event => event.type === 'sandbox/mode').slice(initialSandboxEvents.length).map(event => event.data.mode)).toEqual(['read-only', 'workspace-write'])
        expect(events.filter(event => event.type === 'command/done')).toHaveLength(4)
        expect(events.filter(event => event.type === 'turn/start')).toHaveLength(0)
        expect(events.filter(event => event.type.startsWith('approval/'))).toEqual(initialApprovalEvents)
      } finally { await peer.handle.dispose(); await created.handle.dispose() }
    }, 20000)
  }

  it('does not invent a Plan capability in minimal preset', async () => {
    const created = await createTuiAgent(ctx, workspace, 'minimal')
    try {
      expect(ctx.commands.list(created.agent).map(command => command.name)).not.toContain('plan')
      expect(ctx.agentPresets.serviceFor(created.agent, 'planMode')).toBeUndefined()
      const before = created.agent.session.snapshotEvents().length
      expect(await ctx.commands.execute(created.agent, '/plan', [], new AbortController().signal)).toBeUndefined()
      expect(created.agent.session.snapshotEvents()).toHaveLength(before)
    } finally { await created.handle.dispose() }
  })

  it('keeps an in-flight Plan choice pending until the next accepted step and never changes sandbox policy', async () => {
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    class GatedAdapter extends MockAdapter {
      override async *stream(options: Parameters<MockAdapter['stream']>[0]) {
        if (this.requests.length === 0) { entered.resolve(); await release.promise }
        yield* super.stream(options)
      }
    }
    const adapter = new GatedAdapter([textResponse('first'), textResponse('next')])
    const off = ctx.llm.registerAdapter(['modes-pending'], adapter)
    const created = await createTuiAgent(ctx, workspace, 'standard')
    created.ref.current = { provider: 'modes-pending', model: 'fixture' }
    const plan = ctx.agentPresets.serviceFor(created.agent, 'planMode')!
    const policy = ctx.sandboxPolicy.resolve({ session: created.agent.session })
    try {
      created.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'first' }], source: { kind: 'user' } }))
      await entered.promise
      await ctx.commands.execute(created.agent, '/plan', [], new AbortController().signal)
      expect(plan.get(created.agent)).toEqual({ active: false, pending: true })
      expect(created.agent.session.snapshotEvents().filter(event => event.type === 'plan/mode')).toHaveLength(0)
      await ctx.commands.execute(created.agent, '/plan off', [], new AbortController().signal)
      expect(plan.get(created.agent)).toEqual({ active: false, pending: false })
      await ctx.commands.execute(created.agent, '/plan', [], new AbortController().signal)
      expect(plan.get(created.agent)).toEqual({ active: false, pending: true })
      expect(ctx.sandboxPolicy.resolve({ session: created.agent.session })).toEqual(policy)
      release.resolve()
      await created.agent.whenIdle()
      created.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'second' }], source: { kind: 'user' } }))
      await created.agent.whenIdle()
      expect(plan.get(created.agent)).toEqual({ active: true })
      expect(created.agent.session.snapshotEvents().filter(event => event.type === 'plan/mode').map(event => event.data.active)).toEqual([true])
      expect(adapter.requests).toHaveLength(2)
      expect(ctx.sandboxPolicy.resolve({ session: created.agent.session })).toEqual(policy)
    } finally { release.resolve(); await created.handle.dispose(); off() }
  }, 20000)

  it('cold-resumes logged Plan and sandbox state without additional model calls', async () => {
    const adapter = new MockAdapter([textResponse('plan response')])
    const off = ctx.llm.registerAdapter(['modes-test'], adapter)
    const created = await createTuiAgent(ctx, workspace, 'standard')
    created.ref.current = { provider: 'modes-test', model: 'fixture' }
    const id = created.agent.id
    try {
      setSandboxMode(created.agent.session, 'read-only')
      await ctx.commands.execute(created.agent, '/plan', [], new AbortController().signal)
      const input = createUserMessage({ content: [{ type: 'text', text: 'inspect only' }], source: { kind: 'user' } })
      created.agent.followup(input)
      await created.agent.whenIdle()
      expect(adapter.requests).toHaveLength(1)
      expect(ctx.agentPresets.serviceFor(created.agent, 'planMode')!.get(created.agent).active).toBe(true)
      expect(await ctx.sessions.flush(created.agent.session)).toBe(true)
      await created.handle.dispose()
      const snapshot = await readTuiSession(ctx.sessionQuery, id)
      const resumed = await prepareTuiResume(ctx, id, { header: snapshot.session, events: snapshot.events }, { provider: 'modes-test', model: 'fixture' })
      try {
        expect(ctx.agentPresets.serviceFor(resumed.handle.agent, 'planMode')!.get(resumed.handle.agent).active).toBe(true)
        expect(ctx.sandboxPolicy.resolve({ session: resumed.handle.agent.session })).toMatchObject({ mode: 'read-only', workspaceRoot: workspace })
        expect(adapter.requests).toHaveLength(1)
        expect(resumed.handle.agent.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.id === input.id)).toHaveLength(1)
      } finally { await resumed.handle.dispose() }
    } finally { await created.handle.dispose(); off() }
  }, 20000)

  it('invalidates cold title cache after a real rc.2 rename and flush', async () => {
    const adapter = new MockAdapter([])
    const off = ctx.llm.registerAdapter(['title-cache-test'], adapter)
    const created = await createTuiAgent(ctx, workspace, 'standard')
    const id = created.agent.id
    const options = { cache: new SessionTitleCache(), persistence: ctx.sessionPersistence, isLive: (target: SessionId) => ctx.sessions.get(target) !== undefined }
    const query = {
      listSessions: ctx.sessionQuery.listSessions.bind(ctx.sessionQuery),
      readTitleSnapshots: vi.fn((...args: Parameters<Context['sessionQuery']['readTitleSnapshots']>) => ctx.sessionQuery.readTitleSnapshots(...args)),
    }
    try {
      ctx.sessionTitle.rename(created.agent.session, '初始标题')
      expect(await ctx.sessions.flush(created.agent.session)).toBe(true)
      await created.handle.dispose()
      expect(ctx.sessions.get(id)).toBeUndefined()
      const before = await ctx.sessionPersistence.stat(id)
      expect((await loadSessionRows(query, [], undefined, options)).find(row => row.id === id)?.title).toBe('初始标题')
      query.readTitleSnapshots.mockClear()
      await loadSessionRows(query, [], undefined, options)
      expect(query.readTitleSnapshots).not.toHaveBeenCalled()
      const snapshot = await readTuiSession(ctx.sessionQuery, id)
      const resumed = await prepareTuiResume(ctx, id, { header: snapshot.session, events: snapshot.events }, { provider: 'title-cache-test', model: 'fixture' })
      try {
        ctx.sessionTitle.rename(resumed.handle.agent.session, '修改后的标题🌏')
        expect(await ctx.sessions.flush(resumed.handle.agent.session)).toBe(true)
      } finally { await resumed.handle.dispose() }
      expect((await ctx.sessionPersistence.stat(id))?.revision).not.toBe(before?.revision)
      query.readTitleSnapshots.mockClear()
      const changed = await loadSessionRows(query, [], undefined, options)
      expect(changed.find(row => row.id === id)?.title).toBe('修改后的标题🌏')
      expect(query.readTitleSnapshots.mock.calls.flatMap(([ids]) => ids)).toEqual([id])
      expect(adapter.requests).toHaveLength(0)
    } finally { await created.handle.dispose(); off() }
  }, 20000)

})
