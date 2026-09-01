import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { resolveSessionPreset } from '@deepseek-ai/dsh-agent-presets'
import { boot, healProfilesModuleFallback, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import type { JobOutcome, JobStart } from '@deepseek-ai/dsh-jobs'
import { CallId, createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { foldRequestHeader, SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { WorkflowRunId } from '@deepseek-ai/dsh-workflow'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { createForkAgent, createForkArtifact } from '../src/fork-lifecycle'
import { projectJobsRows, subscribeVisibleJobs } from '../src/jobs-projection'
import { pluginInventoryEntries, profilePatchEntry } from '../src/patch-toggle'
import { createTuiAgent, resolveTuiPreset, SessionPresetQueue } from '../src/preset-lifecycle'
import { prepareTuiResume, replayTuiResumeOrDispose } from '../src/resume-lifecycle'
import {
  createWorkflowProjection, foldWorkflowSessionEvents, projectWorkflowSessionDelivery,
} from '../src/workflow-projection'

/* oxlint-disable typescript/no-unsafe-argument -- Oxlint resolves this cross-package boot fixture outside a test compiler face. */
/* oxlint-disable typescript/no-unsafe-assignment -- Oxlint resolves this cross-package boot fixture outside a test compiler face. */
/* oxlint-disable typescript/no-unsafe-call -- Oxlint resolves this cross-package boot fixture outside a test compiler face. */
/* oxlint-disable typescript/no-unsafe-member-access -- Oxlint resolves this cross-package boot fixture outside a test compiler face. */
/* oxlint-disable typescript/no-unsafe-return -- Oxlint resolves this cross-package boot fixture outside a test compiler face. */

const root = fileURLToPath(new URL('../../../..', import.meta.url))
const presets = join(root, 'apps', 'cli', 'config', 'agent-presets')
const installAnchor = join(root, 'apps', 'cli', 'package.json')
const basePatch = join(root, 'packages', 'bundle', 'base', 'cordis.patch.yml')
const tuiPatch = join(root, 'packages', 'bundle', 'tui-app', 'cordis.patch.yml')
const localSkill = 'tui-preset-local-proof'

function commandNames(ctx: Context, agent: Agent): string[] {
  return (ctx.get('commands')?.list(agent) ?? []).map(command => command.name).sort()
}

function toolNames(ctx: Context, agent: Agent): string[] {
  return ctx.tools.schemas(agent).map(tool => tool.name).sort()
}

function appendCompletedTurn(agent: Agent, turn = 1): void {
  agent.session.append('turn/start', { turn })
  agent.session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

function pendingJob(label: string, owner?: Agent): JobStart {
  let settle!: (outcome: JobOutcome) => void
  const done = new Promise<JobOutcome>((resolve) => { settle = resolve })
  return {
    kind: 'bash',
    label,
    ...(owner === undefined ? {} : { owner }),
    run: () => ({
      done,
      cancel: () => { settle({ status: 'killed' }) },
    }),
  }
}

async function skillNames(ctx: Context, agent: Agent, cwd: string): Promise<string[]> {
  return (await ctx.skills.list({ scope: agent, cwd })).map(skill => skill.name).sort()
}

async function bootTuiComposition(home: string): Promise<Context> {
  const profileDir = join(home, 'profiles', 'spec')
  const settingsFile = join(home, 'settings.yaml')
  await mkdir(profileDir, { recursive: true })
  await writeFile(settingsFile, '{}\n')
  await writeFile(join(profileDir, 'cordis.yml'), '[]\n')
  healProfilesModuleFallback(installAnchor, home)
  return await boot('dsh-tui-preset-test', join(profileDir, 'cordis.yml'), [
    ...loadOverlayPatches('dsh-tui-preset-test', basePatch),
    ...loadOverlayPatches('dsh-tui-preset-test', tuiPatch),
    { id: 'tui', disabled: true },
    { id: 'settings', config: { path: settingsFile, watch: false } },
    { id: 'session-persistence-jsonl', config: { root: join(home, 'sessions') } },
    { id: 'storage-json', config: { root: join(home, 'storages') } },
    { id: 'session-telemetry-otel', disabled: true },
    {
      id: 'agent-presets',
      config: {
        default: 'standard',
        roots: [{ path: presets, trust: 'system' }],
        includeUserRoot: false,
      },
    },
  ], (bootCtx) => { provideCmdline(bootCtx, { args: [], exit: () => {} }) })
}

async function resumeColdTuiSession(ctx: Context, sessionId: SessionId) {
  const snapshot = await ctx.sessionQuery.readSession(sessionId)
  return prepareTuiResume(
    ctx,
    sessionId,
    { header: snapshot.session, events: snapshot.events },
    ctx.agentDefaultModel.currentSelection(),
  )
}

async function persistAndDisposeTuiAgent(
  ctx: Context,
  created: Awaited<ReturnType<typeof createTuiAgent>>,
): Promise<void> {
  if (created.agent.session.events.length === 0) appendCompletedTurn(created.agent)
  expect(await ctx.sessions.flush(created.agent.session)).toBe(true)
  await created.handle.dispose()
}

describe('shipped TUI preset composition', () => {
  let ctx: Context
  let home: string
  let workspace: string

  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), 'dsh-tui-preset-'))
    workspace = join(home, 'workspace')
    const skillDir = join(workspace, '.agents', 'skills', localSkill)
    await mkdir(skillDir, { recursive: true })
    await writeFile(join(skillDir, 'SKILL.md'), [
      '---',
      `name: ${localSkill}`,
      'description: Proves that local skill discovery belongs to the active preset.',
      '---',
      '',
      'Body.',
      '',
    ].join('\n'))
    ctx = await bootTuiComposition(home)
  }, 120_000)

  afterAll(async () => {
    await ctx?.fiber.dispose()
    if (home !== undefined) await rm(home, { recursive: true, force: true })
  })

  it('resolves the configured default before creation and records the mounted id in the header', async () => {
    const created = await createTuiAgent(ctx, workspace)
    try {
      const expected = (await ctx.agentPresets.resolve(undefined)).id
      expect(created.presetId).toBe(expected)
      expect(created.agent.session.header.agentPreset).toBe(expected)
      expect(ctx.agentPresets.composedPreset(created.agent.ctx)).toBe(expected)
      expect(commandNames(ctx, created.agent)).toEqual(expect.arrayContaining(['compact', 'plan']))
      expect(await skillNames(ctx, created.agent, workspace)).toContain(localSkill)
    } finally {
      await created.handle.dispose()
    }
  })

  it('separates root profile rows from preset-only plugin rows', async () => {
    const created = await createTuiAgent(ctx, workspace, 'standard')
    try {
      const entries = [...ctx.loader.entries()]
      const inventory = pluginInventoryEntries(entries)
      expect(inventory.filter(entry => entry.options.id === 'tool-fs')).toHaveLength(1)
      expect(profilePatchEntry(entries, 'agent-default-model')?.id).toBe('include:agent-default-model')
      expect(inventory.some(entry => entry.options.id === 'tool-subagent-claude-code')).toBe(true)
      expect(profilePatchEntry(entries, 'tool-subagent-claude-code')).toBeUndefined()
    } finally {
      await created.handle.dispose()
    }
  })

  it('switches standard to minimal and back with commands, skills, tools, prompt, marker event, and composition aligned', async () => {
    const created = await createTuiAgent(ctx, workspace, 'standard')
    try {
      const minimal = await ctx.agentPresets.recompose(created.agent.ctx, 'minimal')
      created.agent.session.append('agent-preset/selected', { agentPreset: minimal.id })

      expect(commandNames(ctx, created.agent)).not.toEqual(expect.arrayContaining(['compact', 'plan']))
      expect(await skillNames(ctx, created.agent, workspace)).not.toContain(localSkill)
      expect(ctx.agentPresets.composedPreset(created.agent.ctx)).toBe('minimal')
      expect(resolveSessionPreset(created.agent.session)).toBe('minimal')
      const minimalAssembly = await ctx.systemPrompt.assemble({ scope: created.agent })
      expect(minimalAssembly.sections).toEqual([
        { name: 'deployment:persona', text: 'You are a helpful software engineer assistant.' },
      ])
      expect(minimalAssembly.tools.map(tool => tool.name)).toEqual(['pwsh', 'str_replace_editor'])

      const standard = await ctx.agentPresets.recompose(created.agent.ctx, 'standard')
      created.agent.session.append('agent-preset/selected', { agentPreset: standard.id })

      expect(commandNames(ctx, created.agent)).toEqual(expect.arrayContaining(['compact', 'plan']))
      expect(await skillNames(ctx, created.agent, workspace)).toContain(localSkill)
      expect(ctx.agentPresets.composedPreset(created.agent.ctx)).toBe('standard')
      expect(resolveSessionPreset(created.agent.session)).toBe('standard')
      expect(toolNames(ctx, created.agent)).toEqual(expect.arrayContaining(['pwsh', 'read', 'skill', 'write']))
    } finally {
      await created.handle.dispose()
    }
  })

  it('activates code and cordis capabilities rather than changing only metadata', async () => {
    const created = await createTuiAgent(ctx, workspace)
    try {
      await ctx.agentPresets.recompose(created.agent.ctx, 'code')
      const codeAssembly = await ctx.systemPrompt.assemble({ scope: created.agent })
      expect(codeAssembly.tools.map(tool => tool.name)).toEqual(['run_code'])

      await ctx.agentPresets.recompose(created.agent.ctx, 'cordis')
      expect(toolNames(ctx, created.agent)).toEqual(expect.arrayContaining([
        'cordis_define', 'cordis_inspect_list', 'cordis_inspect_query', 'cordis_run', 'cordis_stop',
      ]))
      expect(await skillNames(ctx, created.agent, workspace)).toContain('editing-cordis-compositions')
    } finally {
      await created.handle.dispose()
    }
  })

  it('carries the actual selected preset into a new session header and mount', async () => {
    const current = await createTuiAgent(ctx, workspace)
    const selected = await ctx.agentPresets.recompose(current.agent.ctx, 'minimal')
    current.agent.session.append('agent-preset/selected', { agentPreset: selected.id })

    const next = await createTuiAgent(ctx, workspace, resolveSessionPreset(current.agent.session))
    try {
      expect(next.agent.session.header.agentPreset).toBe('minimal')
      expect(ctx.agentPresets.composedPreset(next.agent.ctx)).toBe('minimal')
      expect(commandNames(ctx, next.agent)).not.toEqual(expect.arrayContaining(['compact', 'plan']))
    } finally {
      await next.handle.dispose()
      await current.handle.dispose()
    }
  })

  it('persists and resumes a default-preset fork with matching durable metadata and composition', async () => {
    const parent = await createTuiAgent(ctx, workspace, 'standard')
    let child: Awaited<ReturnType<typeof prepareTuiResume>> | undefined
    try {
      appendCompletedTurn(parent.agent)
      const childId = await createForkArtifact(ctx, { source: parent.agent, cwd: workspace })
      expect(childId).not.toBeNull()
      if (childId === null) throw new Error('expected completed parent turn to produce a fork')
      expect(ctx.agents.get(childId)).toBeUndefined()
      const cold = await ctx.sessionQuery.readSession(childId)
      expect(cold.session).toMatchObject({
        agentPreset: parent.presetId,
        parentSession: parent.agent.id,
        seedLength: parent.agent.session.events.length,
      })
      child = await resumeColdTuiSession(ctx, childId)
      expect(child.handle.agent.session.header.agentPreset).toBe(parent.presetId)
      expect(ctx.agentPresets.composedPreset(child.handle.agent.ctx)).toBe(parent.presetId)
      expect(commandNames(ctx, child.handle.agent)).toEqual(expect.arrayContaining(['compact', 'plan']))
    } finally {
      await child?.handle.dispose()
      await parent.handle.dispose()
    }
  })

  it('persists and resumes a switched-preset fork under the seed effective preset', async () => {
    const parent = await createTuiAgent(ctx, workspace, 'standard')
    let child: Awaited<ReturnType<typeof prepareTuiResume>> | undefined
    try {
      const minimal = await ctx.agentPresets.recompose(parent.agent.ctx, 'minimal')
      parent.agent.session.append('agent-preset/selected', { agentPreset: minimal.id })
      appendCompletedTurn(parent.agent)
      const childId = await createForkArtifact(ctx, { source: parent.agent, cwd: workspace })
      expect(childId).not.toBeNull()
      if (childId === null) throw new Error('expected completed parent turn to produce a fork')
      const cold = await ctx.sessionQuery.readSession(childId)
      expect(cold.session.agentPreset).toBe('minimal')
      child = await resumeColdTuiSession(ctx, childId)
      expect(ctx.agentPresets.composedPreset(child.handle.agent.ctx)).toBe('minimal')
      expect(commandNames(ctx, child.handle.agent)).not.toEqual(expect.arrayContaining(['compact', 'plan']))
      expect(toolNames(ctx, child.handle.agent)).not.toEqual(expect.arrayContaining(['skill']))
    } finally {
      await child?.handle.dispose()
      await parent.handle.dispose()
    }
  })

  it('does not publish a fork when its recorded preset cannot resolve', async () => {
    const parent = await createTuiAgent(ctx, workspace, 'standard')
    try {
      appendCompletedTurn(parent.agent)
      const before = ctx.agents.list().length
      await expect(createForkAgent(ctx, {
        seed: parent.agent.session.events,
        cwd: workspace,
        parentSession: parent.agent.id,
        presetId: 'missing-preset',
        selection: parent.selection,
      })).rejects.toThrow(/missing-preset/u)
      expect(ctx.agents.list()).toHaveLength(before)
    } finally {
      await parent.handle.dispose()
    }
  })

  it('rolls a fork back when preset mounting fails after child preparation starts', async () => {
    const parent = await createTuiAgent(ctx, workspace, 'standard')
    const mount = vi.spyOn(ctx.agentPresets, 'mount').mockRejectedValueOnce(new Error('mount failed for test'))
    try {
      appendCompletedTurn(parent.agent)
      const liveBefore = ctx.agents.list()
      const sessionsBefore = ctx.sessions.list()
      await expect(createForkAgent(ctx, {
        seed: parent.agent.session.events,
        cwd: workspace,
        parentSession: parent.agent.id,
        presetId: 'standard',
        selection: parent.selection,
      })).rejects.toThrow('mount failed for test')
      expect(ctx.agents.list()).toEqual(liveBefore)
      expect(ctx.sessions.list()).toEqual(sessionsBefore)
    } finally {
      mount.mockRestore()
      await parent.handle.dispose()
    }
  })

  it('rolls a fork back when its durability barrier fails after publication', async () => {
    const parent = await createTuiAgent(ctx, workspace, 'standard')
    const flush = vi.spyOn(ctx.sessions, 'flush').mockRejectedValueOnce(new Error('fork flush failed for test'))
    try {
      appendCompletedTurn(parent.agent)
      const liveBefore = ctx.agents.list()
      const sessionsBefore = ctx.sessions.list()
      await expect(createForkArtifact(ctx, { source: parent.agent, cwd: workspace }))
        .rejects.toThrow('fork flush failed for test')
      expect(ctx.agents.list()).toEqual(liveBefore)
      expect(ctx.sessions.list()).toEqual(sessionsBefore)
    } finally {
      flush.mockRestore()
      await parent.handle.dispose()
    }
  })

  it('resumes a fork on its seed route and keeps that route for the next real request', async () => {
    const reasoning = {
      efforts: [
        { id: ReasoningEffortId('low'), name: 'Low' },
        { id: ReasoningEffortId('high'), name: 'High' },
      ],
      defaultEffort: ReasoningEffortId('low'),
    }
    const adapter = new MockAdapter([textResponse('fork route ok')], reasoning)
    const offAdapter = ctx.llm.registerAdapter(['fork-route-a', 'fork-route-b'], adapter)
    const parent = await createTuiAgent(ctx, workspace, 'standard')
    let child: Awaited<ReturnType<typeof prepareTuiResume>> | undefined
    try {
      parent.agent.session.append('turn/start', { turn: 1 })
      parent.agent.session.append('request/header', {
        header: {
          config: {
            provider: 'fork-route-a',
            model: 'model-a',
            reasoningEffort: ReasoningEffortId('high'),
          },
        },
        reason: 'initial',
      })
      parent.agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      parent.agent.session.append('turn/start', { turn: 2 })
      parent.agent.session.append('request/header', {
        header: {
          config: {
            provider: 'fork-route-b',
            model: 'model-b',
            reasoningEffort: ReasoningEffortId('low'),
          },
        },
        reason: 'change',
      })
      parent.agent.session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })

      const childId = await createForkArtifact(ctx, { source: parent.agent, cwd: workspace, atSeq: 1 })
      expect(childId).not.toBeNull()
      if (childId === null) throw new Error('expected the first completed turn to produce a fork')
      child = await resumeColdTuiSession(ctx, childId)
      expect(child.selection).toEqual({
        provider: 'fork-route-a',
        model: 'model-a',
        reasoningEffort: ReasoningEffortId('high'),
      })
      expect(child.reasoning).toEqual({ effort: 'high', levels: ['low', 'high'] })

      child.handle.agent.followup(createUserMessage({
        content: [{ type: 'text', text: 'continue on the fork route' }],
        source: { kind: 'user' },
      }))
      await child.handle.agent.whenIdle()
      expect(adapter.requests).toHaveLength(1)
      expect(adapter.requests[0]).toMatchObject({
        provider: 'fork-route-a',
        model: 'model-a',
        reasoningEffort: 'high',
      })
      expect(foldRequestHeader(child.handle.agent.session.events)?.config).toMatchObject({
        provider: 'fork-route-a',
        model: 'model-a',
        reasoningEffort: 'high',
      })
    } finally {
      await child?.handle.dispose()
      await parent.handle.dispose()
      offAdapter()
    }
  })

  it('resumes the target route instead of the current surface route and keeps it for the next request', async () => {
    const reasoning = {
      efforts: [
        { id: ReasoningEffortId('low'), name: 'Low' },
        { id: ReasoningEffortId('high'), name: 'High' },
      ],
      defaultEffort: ReasoningEffortId('low'),
    }
    const adapter = new MockAdapter([textResponse('target first'), textResponse('target resumed')], reasoning)
    const offAdapter = ctx.llm.registerAdapter(['resume-route-a', 'resume-route-b'], adapter)
    const target = await createTuiAgent(ctx, workspace, 'standard')
    let current: Awaited<ReturnType<typeof createTuiAgent>> | undefined
    let resumed: Awaited<ReturnType<typeof prepareTuiResume>> | undefined
    try {
      target.ref.current = {
        provider: 'resume-route-a',
        model: 'model-a',
        reasoningEffort: ReasoningEffortId('high'),
      }
      target.agent.followup(createUserMessage({
        content: [{ type: 'text', text: 'record target route' }],
        source: { kind: 'user' },
      }))
      await target.agent.whenIdle()
      expect(adapter.requests[0]).toMatchObject({
        provider: 'resume-route-a', model: 'model-a', reasoningEffort: 'high',
      })
      const targetId = target.agent.id
      expect(await ctx.sessions.flush(target.agent.session)).toBe(true)
      await target.handle.dispose()

      current = await createTuiAgent(ctx, workspace, 'minimal')
      current.ref.current = {
        provider: 'resume-route-b',
        model: 'model-b',
        reasoningEffort: ReasoningEffortId('low'),
      }
      const snapshot = await ctx.sessionQuery.readSession(targetId)
      resumed = await prepareTuiResume(
        ctx,
        targetId,
        { header: snapshot.session, events: snapshot.events },
        ctx.agentDefaultModel.currentSelection(),
      )
      expect(resumed.selection).toEqual({
        provider: 'resume-route-a', model: 'model-a', reasoningEffort: ReasoningEffortId('high'),
      })
      expect(resumed.reasoning).toEqual({ effort: 'high', levels: ['low', 'high'] })
      expect(current.ref.current).toEqual({
        provider: 'resume-route-b', model: 'model-b', reasoningEffort: ReasoningEffortId('low'),
      })

      await current.handle.dispose()
      current = undefined
      resumed.handle.agent.followup(createUserMessage({
        content: [{ type: 'text', text: 'continue target route after resume' }],
        source: { kind: 'user' },
      }))
      await resumed.handle.agent.whenIdle()
      expect(adapter.requests.at(-1)).toMatchObject({
        provider: 'resume-route-a', model: 'model-a', reasoningEffort: 'high',
      })
      expect(foldRequestHeader(resumed.handle.agent.session.events)?.config).toMatchObject({
        provider: 'resume-route-a', model: 'model-a', reasoningEffort: 'high',
      })
    } finally {
      await resumed?.handle.dispose()
      await current?.handle.dispose()
      if (ctx.agents.get(target.agent.id) === target.agent) await target.handle.dispose()
      offAdapter()
    }
  })

  it('leaves the current Agent and composition intact when resumed preset setup fails', async () => {
    const target = await createTuiAgent(ctx, workspace, 'standard')
    appendCompletedTurn(target.agent)
    const targetId = target.agent.id
    await persistAndDisposeTuiAgent(ctx, target)
    const current = await createTuiAgent(ctx, workspace, 'minimal')
    const mount = vi.spyOn(ctx.agentPresets, 'mount').mockRejectedValueOnce(new Error('resume mount failed for test'))
    try {
      const snapshot = await ctx.sessionQuery.readSession(targetId)
      await expect(prepareTuiResume(
        ctx,
        targetId,
        { header: snapshot.session, events: snapshot.events },
        ctx.agentDefaultModel.currentSelection(),
      )).rejects.toThrow('resume mount failed for test')
      expect(ctx.agents.get(current.agent.id)).toBe(current.agent)
      expect(ctx.agents.get(targetId)).toBeUndefined()
      expect(ctx.agentPresets.composedPreset(current.agent.ctx)).toBe('minimal')
    } finally {
      mount.mockRestore()
      await current.handle.dispose()
    }
  })

  it('rejects a retired recorded route before publishing or changing the current surface Agent', async () => {
    const adapter = new MockAdapter([textResponse('record route before retirement')])
    const offAdapter = ctx.llm.registerAdapter(['resume-retired-route'], adapter)
    const target = await createTuiAgent(ctx, workspace, 'standard')
    target.ref.current = {
      provider: 'resume-retired-route',
      model: 'retired-model',
    }
    target.agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'record the route that will retire' }],
      source: { kind: 'user' },
    }))
    await target.agent.whenIdle()
    const targetId = target.agent.id
    await persistAndDisposeTuiAgent(ctx, target)
    offAdapter()

    const current = await createTuiAgent(ctx, workspace, 'minimal')
    const currentSelection = { ...current.ref.current }
    try {
      const snapshot = await ctx.sessionQuery.readSession(targetId)
      await expect(prepareTuiResume(
        ctx,
        targetId,
        { header: snapshot.session, events: snapshot.events },
        ctx.agentDefaultModel.currentSelection(),
      )).rejects.toThrow(/resume-retired-route|adapter/ui)
      expect(ctx.agents.get(current.agent.id)).toBe(current.agent)
      expect(ctx.agents.get(targetId)).toBeUndefined()
      expect(current.ref.current).toEqual(currentSelection)
      expect(ctx.agentPresets.composedPreset(current.agent.ctx)).toBe('minimal')
    } finally {
      await current.handle.dispose()
    }
  })

  it('uses the deployment fallback when a resumed legacy Session has no request header', async () => {
    const target = await createTuiAgent(ctx, workspace, 'standard')
    const targetId = target.agent.id
    await persistAndDisposeTuiAgent(ctx, target)
    const snapshot = await ctx.sessionQuery.readSession(targetId)
    const offAdapter = ctx.llm.registerAdapter(['legacy-deployment-provider'], new MockAdapter([], {
      efforts: [{ id: ReasoningEffortId('low'), name: 'Low' }],
      defaultEffort: ReasoningEffortId('low'),
    }))
    const fallback = {
      provider: 'legacy-deployment-provider',
      model: 'legacy-deployment-model',
      reasoningEffort: ReasoningEffortId('low'),
    }
    let resumed: Awaited<ReturnType<typeof prepareTuiResume>> | undefined
    try {
      resumed = await prepareTuiResume(
        ctx,
        targetId,
        { header: snapshot.session, events: snapshot.events },
        fallback,
      )
      expect(resumed.selection).toEqual(fallback)
      expect(resumed.ref.current).toEqual(fallback)
      expect(resumed.handle.agent.options).toMatchObject(fallback)
    } finally {
      await resumed?.handle.dispose()
      offAdapter()
    }
  })

  it('forwards cancellation into a pending resume preparation', async () => {
    const target = await createTuiAgent(ctx, workspace, 'standard')
    const targetId = target.agent.id
    await persistAndDisposeTuiAgent(ctx, target)
    const current = await createTuiAgent(ctx, workspace, 'minimal')
    const entered = Promise.withResolvers<undefined>()
    let observedSignal: AbortSignal | undefined
    const resume = vi.spyOn(ctx.agents, 'resume').mockImplementation(async (options) => {
      observedSignal = options.signal
      entered.resolve(undefined)
      await new Promise<undefined>((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => {
          const reason = options.signal?.reason
          reject(reason instanceof Error ? reason : new Error('resume aborted'))
        }, { once: true })
      })
      throw new Error('unreachable resume completion')
    })
    try {
      const snapshot = await ctx.sessionQuery.readSession(targetId)
      const controller = new AbortController()
      const pending = prepareTuiResume(
        ctx,
        targetId,
        { header: snapshot.session, events: snapshot.events },
        ctx.agentDefaultModel.currentSelection(),
        controller.signal,
      )
      await entered.promise
      controller.abort(new Error('cancel resume test'))
      await expect(pending).rejects.toThrow('cancel resume test')
      expect(observedSignal).toBe(controller.signal)
      expect(ctx.agents.get(current.agent.id)).toBe(current.agent)
    } finally {
      resume.mockRestore()
      await current.handle.dispose()
    }
  })

  it('disposes a published resume target when projection replay fails before the surface swap', async () => {
    const target = await createTuiAgent(ctx, workspace, 'standard')
    const targetId = target.agent.id
    await persistAndDisposeTuiAgent(ctx, target)
    const current = await createTuiAgent(ctx, workspace, 'minimal')
    const prepared = await resumeColdTuiSession(ctx, targetId)
    expect(ctx.agents.get(targetId)).toBe(prepared.handle.agent)
    await expect(replayTuiResumeOrDispose(prepared.handle, async () => {
      throw new Error('projection replay failed for test')
    })).rejects.toThrow('projection replay failed for test')
    try {
      expect(ctx.agents.get(targetId)).toBeUndefined()
      expect(ctx.agents.get(current.agent.id)).toBe(current.agent)
      expect(ctx.agentPresets.composedPreset(current.agent.ctx)).toBe('minimal')
    } finally {
      await current.handle.dispose()
    }
  })

  it('isolates two real Agent workflow streams although the process-global lifecycle observes both', async () => {
    const agentA = await createTuiAgent(ctx, workspace, 'standard')
    const agentB = await createTuiAgent(ctx, workspace, 'standard')
    const globalStarts: string[] = []
    const deliveredSessions = new Set<Session>()
    let currentProjection = createWorkflowProjection()
    const offStarts = ctx.on('workflow/start', (info) => { globalStarts.push(String(info.id)) })
    const offDispatch = ctx.on('internal/dispatch', (_mode, eventName, args) => {
      if (eventName !== 'session/event') return
      const [source, event] = args as unknown as [Session, SessionEvent]
      deliveredSessions.add(source)
      const next = projectWorkflowSessionDelivery(
        agentA.agent.session,
        source,
        currentProjection,
        event,
      )
      if (next !== null) currentProjection = next
    }, { global: true })
    try {
      const execute = (agent: Agent, name: string, callId: string) => ctx.tools.execute({
        signal: new AbortController().signal,
        callId: CallId(callId),
        name: 'workflow',
        arguments: {
          script: 'return 1',
          meta: { name, description: `${name} isolation proof` },
        },
        agent,
      })
      const [resultA, resultB] = await Promise.all([
        execute(agentA.agent, 'current-workflow', 'tui-workflow-current'),
        execute(agentB.agent, 'foreign-workflow', 'tui-workflow-foreign'),
      ])
      expect(resultA.isError).toBe(false)
      expect(resultB.isError).toBe(false)
      expect(globalStarts).toHaveLength(2)
      expect(deliveredSessions.has(agentA.agent.session)).toBe(true)
      expect(deliveredSessions.has(agentB.agent.session)).toBe(true)
      expect([...currentProjection.values()].map(row => row.name)).toEqual(['current-workflow'])
      expect([...foldWorkflowSessionEvents(agentA.agent.session.events).values()].map(row => row.name))
        .toEqual(['current-workflow'])
      expect([...foldWorkflowSessionEvents(agentB.agent.session.events).values()].map(row => row.name))
        .toEqual(['foreign-workflow'])
    } finally {
      offDispatch()
      offStarts()
      await agentB.handle.dispose()
      await agentA.handle.dispose()
    }
  })

  it('reconstructs only the resumed Session workflow rows from persisted history', async () => {
    const target = await createTuiAgent(ctx, workspace, 'standard')
    const targetRun = WorkflowRunId('resume-target-workflow')
    target.agent.session.append('tool-workflow/run-start', { runId: targetRun, name: 'target-history' })
    target.agent.session.append('tool-workflow/run-end', { runId: targetRun, stopReason: 'completed' })
    const targetId = target.agent.id
    await persistAndDisposeTuiAgent(ctx, target)

    const current = await createTuiAgent(ctx, workspace, 'standard')
    const currentRun = WorkflowRunId('current-surface-workflow')
    current.agent.session.append('tool-workflow/run-start', { runId: currentRun, name: 'current-history' })
    let resumed: Awaited<ReturnType<typeof prepareTuiResume>> | undefined
    try {
      const snapshot = await ctx.sessionQuery.readSession(targetId)
      resumed = await prepareTuiResume(
        ctx,
        targetId,
        { header: snapshot.session, events: snapshot.events },
        ctx.agentDefaultModel.currentSelection(),
      )
      expect([...foldWorkflowSessionEvents(resumed.events).values()]).toEqual([{
        id: targetRun,
        name: 'target-history',
        status: 'completed',
        agentsStarted: 0,
      }])
      expect([...foldWorkflowSessionEvents(current.agent.session.events).values()].map(row => row.name))
        .toEqual(['current-history'])
    } finally {
      await resumed?.handle.dispose()
      await current.handle.dispose()
    }
  })

  it('projects real JobRegistry ownership and refreshes only the current Agent plus unowned work', async () => {
    const agentA = await createTuiAgent(ctx, workspace, 'standard')
    const agentB = await createTuiAgent(ctx, workspace, 'standard')
    const offController = ctx.jobs.attachController('tui-jobs-projection-test')
    let current = agentA.agent
    const refreshes: string[][] = []
    const offChanges = subscribeVisibleJobs(ctx.jobs, () => current, () => {
      refreshes.push(projectJobsRows(ctx.jobs, current, Date.now()).map(row => row.label))
    })
    try {
      const jobA = ctx.jobs.start(pendingJob('owned-a', agentA.agent))
      const refreshesAfterA = refreshes.length
      const jobB = ctx.jobs.start(pendingJob('owned-b', agentB.agent))
      expect(refreshes).toHaveLength(refreshesAfterA)
      const unowned = ctx.jobs.start(pendingJob('unowned'))
      expect(projectJobsRows(ctx.jobs, agentA.agent, Date.now()).map(row => row.label))
        .toEqual(['owned-a', 'unowned'])
      expect(projectJobsRows(ctx.jobs, agentB.agent, Date.now()).map(row => row.label))
        .toEqual(['owned-b', 'unowned'])
      expect(refreshes.at(-1)).toEqual(['owned-a', 'unowned'])

      current = agentB.agent
      const jobB2 = ctx.jobs.start(pendingJob('owned-b-2', agentB.agent))
      expect(refreshes.at(-1)).toEqual(['owned-b', 'unowned', 'owned-b-2'])
      expect(() => ctx.jobs.kill(jobB, agentA.agent)).toThrow('belongs to another session')
      expect(ctx.jobs.kill(jobB, agentB.agent)).toBe('requested')

      const refreshCount = refreshes.length
      offChanges()
      ctx.jobs.start(pendingJob('owned-a-after-dispose', agentA.agent))
      expect(refreshes).toHaveLength(refreshCount)

      ctx.jobs.kill(jobA, agentA.agent)
      ctx.jobs.kill(jobB2, agentB.agent)
      ctx.jobs.kill(unowned, agentA.agent)
    } finally {
      offChanges()
      offController()
      await agentB.handle.dispose()
      await agentA.handle.dispose()
    }
  })

  it('serializes real rapid recompositions and leaves the last successful selection authoritative', async () => {
    const created = await createTuiAgent(ctx, workspace)
    const queue = new SessionPresetQueue()
    try {
      const selections = ['minimal', 'code', 'standard'].map(id => queue.run(created.agent.id, async () => {
        const preset = await ctx.agentPresets.recompose(created.agent.ctx, id)
        created.agent.session.append('agent-preset/selected', { agentPreset: preset.id })
        return preset.id
      }))

      await expect(Promise.all(selections)).resolves.toEqual(['minimal', 'code', 'standard'])
      expect(ctx.agentPresets.composedPreset(created.agent.ctx)).toBe('standard')
      expect(resolveSessionPreset(created.agent.session)).toBe('standard')
      expect(commandNames(ctx, created.agent)).toEqual(expect.arrayContaining(['compact', 'plan']))
    } finally {
      await created.handle.dispose()
    }
  })

  it('leaves composition and log unchanged when a preset is invalid', async () => {
    const created = await createTuiAgent(ctx, workspace)
    try {
      const toolsBefore = toolNames(ctx, created.agent)
      const commandsBefore = commandNames(ctx, created.agent)
      const eventsBefore = created.agent.session.events.length

      await expect(ctx.agentPresets.recompose(created.agent.ctx, 'missing-preset')).rejects.toThrow()

      expect(toolNames(ctx, created.agent)).toEqual(toolsBefore)
      expect(commandNames(ctx, created.agent)).toEqual(commandsBefore)
      expect(created.agent.session.events).toHaveLength(eventsBefore)
      expect(ctx.agentPresets.composedPreset(created.agent.ctx)).toBe(created.presetId)
    } finally {
      await created.handle.dispose()
    }
  })

  it('resumes the newest logged selection with its real catalog and prompt composition', async () => {
    const created = await createTuiAgent(ctx, workspace)
    const sessionId = created.agent.id
    const selected = await ctx.agentPresets.recompose(created.agent.ctx, 'minimal')
    created.agent.session.append('agent-preset/selected', { agentPreset: selected.id })
    await created.handle.dispose()

    const snapshot = await ctx.sessionPersistence.inspect(sessionId)
    const recorded = resolveSessionPreset({ header: snapshot.meta, events: snapshot.events })
    const preset = await resolveTuiPreset(ctx, recorded)
    const resumed = await ctx.agents.resume({
      resumeSessionId: SessionId(String(sessionId)),
      setup: async (agentCtx) => {
        if (preset.kind === 'preset') await preset.service.mount(agentCtx, preset.id)
      },
    })
    try {
      expect(recorded).toBe('minimal')
      expect(ctx.agentPresets.composedPreset(resumed.agent.ctx)).toBe('minimal')
      expect(commandNames(ctx, resumed.agent)).not.toEqual(expect.arrayContaining(['compact', 'plan']))
      expect(await skillNames(ctx, resumed.agent, workspace)).not.toContain(localSkill)
      const assembly = await ctx.systemPrompt.assemble({ scope: resumed.agent })
      expect(assembly.sections[0]?.text).toBe('You are a helpful software engineer assistant.')
    } finally {
      await resumed.dispose()
    }
  })

  it('migrates a metadata-free old session onto the resolved default and records that fallback', async () => {
    const oldSessionId = SessionId('tui-old-session-without-preset')
    const old = await ctx.agents.create({ sessionId: oldSessionId, meta: { cwd: workspace } })
    await old.dispose()

    const snapshot = await ctx.sessionPersistence.inspect(oldSessionId)
    expect(resolveSessionPreset({ header: snapshot.meta, events: snapshot.events })).toBeUndefined()
    const preset = await resolveTuiPreset(ctx)
    const resumed = await ctx.agents.resume({
      resumeSessionId: oldSessionId,
      setup: async (agentCtx) => {
        if (preset.kind === 'preset') await preset.service.mount(agentCtx, preset.id)
      },
    })
    try {
      if (preset.kind === 'preset') {
        resumed.agent.session.append('agent-preset/selected', { agentPreset: preset.id })
        expect(ctx.agentPresets.composedPreset(resumed.agent.ctx)).toBe(preset.id)
        expect(resolveSessionPreset(resumed.agent.session)).toBe(preset.id)
      }
    } finally {
      await resumed.dispose()
    }
  })
})
