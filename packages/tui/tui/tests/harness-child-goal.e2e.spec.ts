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
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTuiAgent } from '../src/preset-lifecycle'
import { MockAdapter, textResponse } from './mock-adapter'
const root = fileURLToPath(new URL('../../../..', import.meta.url))
const installAnchor = createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json')
const basePatch = createRequire(import.meta.url).resolve('@deepseek-ai/dsh-base/cordis.patch.yml')
const tuiPatch = join(root, 'apps/tui-cli/plugin/cordis.patch.yml')
async function bootTuiComposition(home: string): Promise<Context> {
  const profileDir = join(home, 'profiles', 'spec')
  const settingsFile = join(home, 'settings.yaml')
  await mkdir(profileDir, { recursive: true })
  await writeFile(settingsFile, '{}\n')
  await writeFile(join(profileDir, 'cordis.yml'), '[]\n')
  const presetFiles = await Promise.all(['standard', 'ptc', 'minimal', 'cordis'].map(async id => {
    const filename = join(profileDir, `${id}.patch.yml`)
    await writeFile(filename, terminalPresetSource(readFileSync(createRequire(import.meta.url).resolve(`@deepseek-ai/dsh-web-app/presets/${id}.patch.yml`), 'utf8')))
    return filename
  }))
  const resolution = await createRuntimeResolution({ installAnchor, home })
  return await boot('dsh-tui-preset-test', join(profileDir, 'cordis.yml'), [
    ...loadOverlayPatches('dsh-tui-preset-test', basePatch),
    ...loadOverlayPatches('dsh-tui-preset-test', tuiPatch),
    ...presetFiles.flatMap(filename => loadOverlayPatches('dsh-tui-preset-test', filename)),
    { id: 'tui', disabled: true },
    { id: 'session-title-llm', disabled: true },
    { id: 'hmr', disabled: true },
    { id: 'settings', config: { path: settingsFile, watch: false } },
    { id: 'session-persistence-jsonl', config: { root: join(home, 'sessions') } },
    { id: 'storage-json', config: { root: join(home, 'storages') } },
    { id: 'session-telemetry-otel', disabled: true },

  ], async (bootCtx) => { await bootCtx.plugin(PluginPackages, { resolution }); provideCmdline(bootCtx, { args: [], exit: () => {} }) }, pathToFileURL(installAnchor).href)
}

describe('official child preset and Goal join', () => {
  let ctx: Context; let home: string; let workspace: string
  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), 'dsh-tui-child-goal-'))
    workspace = join(home, 'workspace'); await mkdir(workspace)
    ctx = await bootTuiComposition(home)
  }, 120_000)
  afterAll(async () => { await ctx?.fiber.dispose(); if (home) await rm(home, { recursive: true, force: true }) })
  it('waits for a genuinely running independent-preset child before admitting a Goal round', async () => {
    const reached = Promise.withResolvers<void>(); const release = Promise.withResolvers<void>()
    const offTool = ctx.tools.register(defineTool({
      name: 'child_gate', description: 'Child lifecycle test gate.', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async () => { reached.resolve(); await release.promise; return 'child released' },
    }))
    const childAdapter = new MockAdapter([[
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId('child-gate'), name: 'child_gate', arguments: '{}' } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ], textResponse('child completed')])
    const offParentTool = ctx.tools.register(defineTool({
      name: 'parent_probe', description: 'A completed parent operation while child remains active.', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async () => 'parent operation finished',
    }))
    const parentAdapter = new MockAdapter([[
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId('parent-probe'), name: 'parent_probe', arguments: '{}' } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ], textResponse('parent initial done'), textResponse('goal round done')])
    const offChild = ctx.llm.registerAdapter(['child-test'], childAdapter)
    const offParent = ctx.llm.registerAdapter(['parent-test'], parentAdapter)
    const parent = await createTuiAgent(ctx, workspace)
    parent.ref.current = { provider: 'parent-test', model: 'fixture' }
    const activation = await ctx.subagents.startActivation({
      provider: 'spawn', label: 'independent child', delivery: 'caller', signal: new AbortController().signal,
      request: { parent: parent.agent, agentPreset: 'minimal', prompt: [{ type: 'text', text: 'wait at gate' }],
        agentOptions: { provider: 'child-test', model: 'fixture' } },
    })
    const join = vi.spyOn(ctx.subagents, 'waitForChildren')
    try {
      await reached.promise
      const child = ctx.agents.get(activation.childId)!
      expect(child.session.header.agentPreset).toBe('minimal')
      expect(ctx.agentPresets.composedPreset(child.ctx)).toBe('minimal')
      expect(ctx.agentPresets.composedPreset(parent.agent.ctx)).not.toBe('minimal')
      ctx.goals.create(parent.agent, { objective: 'finish after child', maxGoalRounds: 1 })
      parent.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'parent initial' }], source: { kind: 'user' } }))
      await parent.agent.whenIdle()
      await vi.waitFor(() => expect(join).toHaveBeenCalledWith(parent.agent))
      expect(ctx.goals.get(parent.agent)?.roundsStarted).toBe(0)
      expect(parentAdapter.requests).toHaveLength(2)
      expect(parent.agent.session.snapshotEvents().filter(e => e.type === 'tool/result')).toHaveLength(1)
      expect(child.session.snapshotEvents().filter(e => e.type === 'tool/result')).toHaveLength(0)
      expect(ctx.agents.get(activation.childId)).toBe(child)
      release.resolve()
      await activation.result
      await vi.waitFor(() => expect(ctx.goals.get(parent.agent)).toMatchObject({ roundsStarted: 1, phase: 'blocked', blockedReason: { code: 'round-limit' } }), { timeout: 5000 })
      expect(parentAdapter.requests).toHaveLength(3)
      expect(childAdapter.requests).toHaveLength(2)
      expect(parent.agent.session.snapshotEvents().filter(e => e.type === 'user/message' && e.data.source.kind === 'goal')).toHaveLength(1)
    } finally { release.resolve(); join.mockRestore(); await activation.dispose(); await parent.handle.dispose(); offChild(); offParent(); offTool(); offParentTool() }
  }, 20_000)
})
