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
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readPermissionPresets, selectPermissionPreset, setPermissionDefault } from '../src/harness/permission-presets'
import { changeApprovalPolicy, readApprovalPolicy } from '../src/harness/approval-policy'
import { createTuiAgent } from '../src/preset-lifecycle'
import { prepareTuiResume } from '../src/resume-lifecycle'
import { readTuiSession } from '../src/session-read'
import { MockAdapter, textResponse } from './mock-adapter'

function toolResponse(id: string, name = 'approval_probe'): StreamChunk[] {
  const call = { type: 'tool-call' as const, id: ToolCallId(id), name, arguments: '{}' }
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

describe('official approval / cancel / durable resume roundtrip', () => {
  let ctx: Context
  let home: string
  let workspace: string
  let approvedExecutions = 0

  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), 'dsh-tui-approval-'))
    workspace = join(home, 'workspace')
    await mkdir(workspace)
    vi.stubEnv('DSH_HOME', home)
    const profile = join(home, 'profiles', 'approval-fixture')
    await mkdir(profile, { recursive: true })
    const config = join(profile, 'cordis.yml')
    await writeFile(config, '[]\n')
    await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify([{ id: 'hmr', disabled: true }, { id: 'session-title-llm', disabled: true }, { id: 'session-telemetry-otel', disabled: true }, { id: 'session-persistence-jsonl', config: { root: join(home, 'sessions') } }, { id: 'storage-json', config: { root: join(home, 'storages') } }]))
    await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'approval-fixture', private: true, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }))
    const require = createRequire(import.meta.url)
    const installAnchor = require.resolve('@deepseek-ai/dsh/package.json')
    const resolution = await createRuntimeResolution({ installAnchor, home })
    ctx = await boot('tui-approval-roundtrip', config, [
      ...loadOverlayPatches('tui-approval-roundtrip', require.resolve('@deepseek-ai/dsh-base/cordis.patch.yml')),
      { id: 'session-persistence-jsonl', config: { root: join(home, 'sessions') } },
      { id: 'storage-json', config: { root: join(home, 'storages') } },
      { id: 'session-telemetry-otel', disabled: true },
      { id: 'hmr', disabled: true },
      { id: 'session-title-llm', disabled: true },
    ], async root => {
      root.provide('profileContext')
      root.set('profileContext', { name: 'approval-fixture', dir: profile, patchPath: join(profile, 'cordis.patch.yml'), installAnchor, cwd: workspace, home, startedBundles: ['@deepseek-ai/dsh-base'], overlays: [], telemetryDisabledEnv: '1' })
      await root.plugin(PluginPackages, { resolution })
      provideCmdline(root, { args: [], exit: () => {} })
    }, pathToFileURL(installAnchor).href)
    ctx.tools.register(defineTool({
      name: 'approval_probe', description: 'A fixture-only operation requiring official approval.', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async (_args, exec) => {
        if (exec.agent === undefined) throw new Error('Agent required')
        const decision = await ctx.approval.request({ agent: exec.agent, toolName: 'approval_probe', callId: exec.callId, signal: exec.signal, reason: 'fixture operation' })
        if (decision === 'allowed-once') approvedExecutions += 1
        return decision
      },
    }))
  }, 120_000)

  afterAll(async () => {
    await ctx?.fiber.dispose()
    vi.unstubAllEnvs()
    if (home !== undefined) await rm(home, { recursive: true, force: true })
  })

  it('changes only the official future-session default and rejects Auto as a default', async () => {
    const existing = await createTuiAgent(ctx, workspace)
    const initial = readPermissionPresets(ctx, existing.agent)!
    expect(initial.defaultWritable).toBe(true)
    const events = existing.agent.session.snapshotEvents()
    const target = initial.defaultOptions!.find(option => option.value !== initial.defaultPreset)!.value
    try {
      await expect(setPermissionDefault(ctx, 'auto')).rejects.toThrow('unavailable')
      await setPermissionDefault(ctx, target)
      expect(readPermissionPresets(ctx, existing.agent)?.current).toBe(initial.current)
      expect(existing.agent.session.snapshotEvents()).toEqual(events)
      const fresh = await createTuiAgent(ctx, workspace)
      try { expect(readPermissionPresets(ctx, fresh.agent)?.current).toBe(target) }
      finally { await fresh.handle.dispose() }
    } finally {
      await setPermissionDefault(ctx, initial.defaultPreset!)
      await existing.handle.dispose()
    }
  })

  it.each([{ verdict: { risk: 'low', decision: 'allow' }, expected: 1 }, { verdict: { risk: 'high', decision: 'deny', reason: 'fixture denial' }, expected: 0 }])('official Auto review: $verdict.decision before the native body', async ({ verdict, expected }) => {
    const adapter = new MockAdapter([toolResponse('auto-ok', 'auto_probe'), textResponse(JSON.stringify(verdict)), textResponse('auto-reviewed answer')])
    const unregister = ctx.llm.registerAdapter(['auto-test'], adapter)
    let executions = 0
    const unregisterTool = ctx.tools.register(defineTool({ name: 'auto_probe', description: 'Read a fixture counter; no external effects.', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async () => { executions++; return 'fixture ok' },
    }))
    const created = await createTuiAgent(ctx, workspace)
    const agent = created.agent
    created.ref.current = { provider: 'auto-test', model: 'fixture' }
    expect(readPermissionPresets(ctx, agent)?.options.some(option => option.value === 'auto')).toBe(false)
    const require = createRequire(import.meta.url)
    const baseRequire = createRequire(require.resolve('@deepseek-ai/dsh-base/package.json'))
    const plugin = await import(baseRequire.resolve('@deepseek-ai/dsh-experimental-auto-review'))
    const fiber = ctx.plugin(plugin)
    try {
      await fiber.inertia
      expect(readPermissionPresets(ctx, agent)?.options.some(option => option.value === 'auto')).toBe(true)
      selectPermissionPreset(ctx, agent, 'auto')
      expect(readPermissionPresets(ctx, agent)?.current).toBe('auto')
      agent.followup(prompt('Run auto_probe on the fixture'))
      await agent.whenIdle()
      expect(executions, JSON.stringify(agent.session.snapshotEvents().filter(event => event.type === 'turn/end' || event.type === 'tool/result'))).toBe(expected)
      expect(adapter.requests).toHaveLength(3)
    } finally {
      selectPermissionPreset(ctx, agent, 'workspace-write')
      await created.handle.dispose()
      await fiber.dispose()
      unregisterTool(); unregister()
    }
  })

  it('runs an approved tool through the loop and cold-resumes its committed audit and route', async () => {
    const adapter = new MockAdapter([toolResponse('approval-ok'), textResponse('approved answer'), textResponse('resumed answer')])
    const offAdapter = ctx.llm.registerAdapter(['approval-test'], adapter)
    const created = await createTuiAgent(ctx, workspace)
    created.ref.current = { provider: 'approval-test', model: 'fixture-model' }
    const offApproval = ctx.on('approval/request', async (request, next) => request.agent === created.agent ? 'allowed-once' : next())
    const previousExecutions = approvedExecutions
    try {
      created.agent.followup(prompt('do the approved operation'))
      await created.agent.whenIdle()
      const events = created.agent.session.snapshotEvents()
      const asked = events.filter(event => event.type === 'approval/asked')
      const decided = events.filter(event => event.type === 'approval/decided')
      expect(asked).toHaveLength(1)
      expect(asked[0]?.data).toMatchObject({ toolName: 'approval_probe', callId: 'approval-ok' })
      expect(decided).toHaveLength(1)
      expect(decided[0]?.data).toEqual({ id: asked[0]?.data.id, outcome: 'allowed-once' })
      expect(approvedExecutions).toBe(previousExecutions + 1)
      expect(adapter.requests).toHaveLength(2)
      const id = created.agent.id
      expect(await ctx.sessions.flush(created.agent.session)).toBe(true)
      await created.handle.dispose()
      const snapshot = await readTuiSession(ctx.sessionQuery, id)
      expect(snapshot.events.filter(event => event.type === 'approval/decided')).toHaveLength(1)
      const resumed = await prepareTuiResume(ctx, id, { header: snapshot.session, events: snapshot.events }, ctx.agentDefaultModel.currentSelection())
      try {
        expect(resumed.handle.agent.id).toBe(id)
        expect(resumed.selection).toMatchObject({ provider: 'approval-test', model: 'fixture-model' })
        resumed.handle.agent.followup(prompt('continue after restart'))
        await resumed.handle.agent.whenIdle()
        expect(adapter.requests).toHaveLength(3)
        expect(approvedExecutions).toBe(previousExecutions + 1)
      } finally { await resumed.handle.dispose() }
    } finally { offApproval(); offAdapter(); await created.handle.dispose() }
  }, 20_000)

  it('cancels a real pending approval, records cancelled once and rejects its late grant', async () => {
    const adapter = new MockAdapter([toolResponse('approval-cancel')])
    const offAdapter = ctx.llm.registerAdapter(['approval-cancel-test'], adapter)
    const created = await createTuiAgent(ctx, workspace)
    created.ref.current = { provider: 'approval-cancel-test', model: 'fixture-model' }
    const reached = Promise.withResolvers<void>()
    const answer = Promise.withResolvers<ApprovalOutcome>()
    const offApproval = ctx.on('approval/request', (request, next) => {
      if (request.agent !== created.agent) return next()
      reached.resolve()
      return answer.promise
    })
    const previousExecutions = approvedExecutions
    try {
      created.agent.followup(prompt('wait for my approval'))
      await reached.promise
      created.agent.cancel({ kind: 'user' })
      await created.agent.whenIdle()
      answer.resolve('allowed-once')
      await Promise.resolve()
      const events = created.agent.session.snapshotEvents()
      const asked = events.filter(event => event.type === 'approval/asked')
      const decided = events.filter(event => event.type === 'approval/decided')
      expect(asked).toHaveLength(1)
      expect(decided.map(event => event.data)).toEqual([{ id: asked[0]?.data.id, outcome: 'cancelled' }])
      expect(approvedExecutions).toBe(previousExecutions)
      expect(events.filter(event => event.type === 'turn/end').at(-1)?.data.reason.kind).toBe('aborted')
      expect(await ctx.sessions.flush(created.agent.session)).toBe(true)
      const persisted = await readTuiSession(ctx.sessionQuery, created.agent.id)
      expect(persisted.events.filter(event => event.type === 'approval/decided').map(event => event.data.outcome)).toEqual(['cancelled'])
    } finally { answer.resolve('rejected'); offApproval(); offAdapter(); await created.handle.dispose() }
  }, 20_000)
  it('switches ask/never through the adapter, rejects without prompting, and restores the persisted policy fold', async () => {
    const adapter = new MockAdapter([toolResponse('never-probe'), textResponse('denied'), toolResponse('ask-probe'), textResponse('approved')])
    const offAdapter = ctx.llm.registerAdapter(['approval-policy-test'], adapter)
    const created = await createTuiAgent(ctx, workspace)
    const other = await createTuiAgent(ctx, workspace)
    created.ref.current = { provider: 'approval-policy-test', model: 'fixture-model' }
    let prompts = 0
    const offApproval = ctx.on('approval/request', (request, next) => {
      if (request.agent !== created.agent) return next()
      prompts++
      return 'allowed-once'
    })
    const before = approvedExecutions
    const sandbox = ctx.sandboxPolicy.resolve({ session: created.agent.session }).mode
    try {
      expect(readApprovalPolicy(ctx, created.agent)).toEqual({ policy: 'ask', source: 'session' })
      changeApprovalPolicy(ctx, created.agent, 'never')
      expect(readApprovalPolicy(ctx, created.agent)).toEqual({ policy: 'never', source: 'session' })
      expect(readApprovalPolicy(ctx, other.agent)?.policy).toBe('ask')
      expect(ctx.sandboxPolicy.resolve({ session: created.agent.session }).mode).toBe(sandbox)
      created.agent.followup(prompt('try the operation'))
      await created.agent.whenIdle()
      expect(prompts).toBe(0)
      expect(approvedExecutions).toBe(before)
      expect(created.agent.session.snapshotEvents().filter(event => event.type === 'approval/decided').map(event => event.data.outcome)).toEqual(['rejected'])
      expect(await ctx.sessions.flush(created.agent.session)).toBe(true)
      const saved = await readTuiSession(ctx.sessionQuery, created.agent.id)
      // Replay into a separate in-memory Session verifies the public host override fold.
      const { Session } = await import('@deepseek-ai/dsh-session')
      const replay = Session.create(created.agent.id, saved.events, saved.session)
      expect(ctx.approval.overrideOf(replay)).toBe('never')
      changeApprovalPolicy(ctx, created.agent, 'ask')
      created.agent.followup(prompt('ask this time'))
      await created.agent.whenIdle()
      expect(prompts).toBe(1)
      expect(approvedExecutions).toBe(before + 1)
      expect(readApprovalPolicy(ctx, created.agent)?.policy).toBe('ask')
      expect(ctx.sandboxPolicy.resolve({ session: created.agent.session }).mode).toBe(sandbox)
    } finally { offApproval(); offAdapter(); await created.handle.dispose(); await other.handle.dispose() }
  }, 20_000)

})
