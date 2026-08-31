import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { resolveSessionPreset } from '@deepseek-ai/dsh-agent-presets'
import { boot, healProfilesModuleFallback, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { SessionId } from '@deepseek-ai/dsh-session'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTuiAgent, resolveTuiPreset, SessionPresetQueue } from '../src/preset-lifecycle'

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
