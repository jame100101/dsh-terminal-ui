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
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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

import { sendChildPrompt } from '../src/controller/child-prompt'

describe('official human child continuation', () => {
  let ctx: Context; let home: string; let workspace: string
  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), 'dsh-child-prompt-'))
    workspace = join(home, 'workspace'); await mkdir(workspace)
    ctx = await bootTuiComposition(home)
  }, 120000)
  afterAll(async () => { await ctx?.fiber.dispose(); if (home) await rm(home, { recursive: true, force: true }) })
  it('queues and steers human prompts through the official direct-child authority without impersonating a model', async () => {
    const adapter = new MockAdapter([textResponse('initial child'), textResponse('queued continuation'), textResponse('steered continuation')])
    const off = ctx.llm.registerAdapter(['child-prompt-test'], adapter)
    const parent = await createTuiAgent(ctx, workspace)
    const stranger = await createTuiAgent(ctx, workspace)
    const activation = await ctx.subagents.startActivation({ provider: 'spawn', label: 'continuable child', delivery: 'caller', signal: new AbortController().signal,
      request: { parent: parent.agent, agentPreset: 'minimal', prompt: [{ type: 'text', text: 'initial task' }], agentOptions: { provider: 'child-prompt-test', model: 'fixture' } } })
    try {
      await activation.result
      await expect(sendChildPrompt(ctx.subagents, stranger.agent.id, activation.childId, 'foreign input', 'queue', new AbortController().signal)).rejects.toThrow()
      const queued = await sendChildPrompt(ctx.subagents, parent.agent.id, activation.childId, 'human queued input', 'queue', new AbortController().signal)
      const child = ctx.agents.get(activation.childId)!
      await child.whenIdle()
      const steered = await sendChildPrompt(ctx.subagents, parent.agent.id, activation.childId, 'human steered input', 'steer', new AbortController().signal)
      await child.whenIdle()
      const userEvents = child.session.snapshotEvents().filter(event => event.type === 'user/message')
      for (const receipt of [queued, steered]) {
        const accepted = userEvents.find(event => event.data.id === receipt.messageId)
        expect(accepted?.data.source).toMatchObject({ kind: 'user', rpcId: expect.any(String) })
      }
      expect(queued.messageId).not.toBe(steered.messageId)
      expect(adapter.requests).toHaveLength(3)
      expect(parent.agent.session.snapshotEvents().filter(event => event.type === 'user/message')).toHaveLength(0)
      const cancelled = new AbortController(); cancelled.abort()
      await expect(sendChildPrompt(ctx.subagents, parent.agent.id, activation.childId, 'cancelled', 'queue', cancelled.signal)).rejects.toThrow()
      expect(adapter.requests).toHaveLength(3)
    } finally { await activation.dispose(); await stranger.handle.dispose(); await parent.handle.dispose(); off() }
  }, 20000)
})
