import { createRequire } from 'node:module'
import { mkdir, writeFile, readFile, access } from 'node:fs/promises'
import { join, basename, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import { boot, createRuntimeResolution, PluginPackages, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
// Use the built plugin: tsc erases public Cordis const-enum references before packaging.
import { MessageFeedbackService } from '@deepseek-ai/dsh-message-feedback'
import * as Tui from '../../lib/index.js'
import { LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { textResponse } from '../mock-adapter'
const home = process.env.DSH_HOME!
if (!home || !isAbsolute(home) || !basename(home).startsWith('dsh-transcript-')) throw new Error('Disposable preview home required')
const done = Promise.withResolvers<number>()
const workspace = join(home, 'workspace')
await mkdir(workspace, { recursive: true })
process.chdir(workspace)
const config = join(home, 'cordis.yml')
await writeFile(config, '[]\n')
await writeFile(join(home, 'cordis.patch.yml'), '[]\n')
await writeFile(join(home, 'package.json'), JSON.stringify({ name: 'pipe-fixture', private: true, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }))
const require = createRequire(import.meta.url)
const anchor = require.resolve('@deepseek-ai/dsh/package.json')
const resolution = await createRuntimeResolution({ installAnchor: anchor, home })
const ctx = await boot('pipe-probe', config, [
  ...loadOverlayPatches('pipe-probe', require.resolve('@deepseek-ai/dsh-base/cordis.patch.yml')),
  { id: 'agent-default-model', config: { provider: 'pipe-test', model: 'fixture' } },
  { id: 'session-persistence-jsonl', config: { root: join(home, 'sessions') } },
  { id: 'storage-json', config: { root: join(home, 'storages') } },
  { id: 'hmr', disabled: true }, { id: 'session-title-llm', disabled: true },
  { id: 'session-telemetry-otel', disabled: true },
], async root => {
  root.provide('profileContext')
  root.set('profileContext', { name: 'fixture', dir: home, patchPath: join(home, 'cordis.patch.yml'), installAnchor: anchor, cwd: workspace, home, startedBundles: ['@deepseek-ai/dsh-base'], overlays: [], telemetryDisabledEnv: '1' })
  await root.plugin(PluginPackages, { resolution })
  provideCmdline(root, { args: process.argv.slice(2), exit: code => done.resolve(code ?? 0) })
}, pathToFileURL(anchor).href)
// Test transport only. Official boot, agent loop, tools, persistence and TUI remain real.
async function gate(name: string, signal?: AbortSignal): Promise<void> {
  while (!signal?.aborted) {
    try { await access(join(home, name)); return } catch { /* Wait for the capture driver, never synthesize success. */ }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('Preview cancelled')
}
const target = join(workspace, 'greeting.ts')
const before = 'export const greeting = "Hello";\n'
const after = 'export const greeting = "你好，世界🙂";\n'
await writeFile(target, before)
ctx.tools.register(defineTool({
  name: 'preview_edit', description: 'Isolated preview file edit', parameters: {},
  output: {
    schema: { type: 'object', additionalProperties: false, properties: { path: { type: 'string' }, oldText: { type: 'string' }, newText: { type: 'string' } } },
    render: () => [{ type: 'text', text: 'Edited greeting.ts in the isolated preview workspace.' }],
    presentationMeta: (_args, value) => value,
  },
  presentCall: () => ({ card: 'diff', title: 'Update(greeting.ts)', diffs: [{ path: 'greeting.ts', oldText: before, newText: after }] }),
  presentResult: (_args, result) => result.isError ? undefined : ({ card: 'diff', diffs: [result.meta as { path: string; oldText: string; newText: string }] }),
  execute: async (_args, exec) => {
    const oldText = await readFile(target, 'utf8')
    await writeFile(join(home, 'tool-started'), 'running')
    await gate('continue-tool', exec.signal)
    await writeFile(target, after)
    const newText = await readFile(target, 'utf8')
    await writeFile(join(home, 'tool-evidence.json'), JSON.stringify({ path: target, oldText, newText }))
    return { path: 'greeting.ts', oldText, newText }
  },
}))
class PreviewAdapter extends LlmAdapter {
  requests = 0
  override async resolveModel(provider: string, model: string) { return { provider, id: model, name: model, context: { contextWindow: 1000000 } } }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests++
    if (this.requests > 1) { yield* textResponse('Updated greeting.ts. The isolated file now contains 你好，世界🙂.\n\n## File verification\n\n| Item | Result |\n| --- | --- |\n| **中文🙂** | *verified* ~~old~~ `greeting.ts` [details](https://example.test) |').map(chunk => chunk.type === 'usage' ? { ...chunk, usage: { inputTokens: 340, cacheReadTokens: 660, outputTokens: 30 } } : chunk); return }
    const thought = 'Inspect the isolated file, then replace the greeting and verify the written bytes.'
    yield { type: 'block-start', index: 0, blockType: 'reasoning' }
    yield { type: 'reasoning-delta', index: 0, text: thought }
    await gate('continue-thinking', options.signal)
    yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: thought } }
    yield { type: 'block-start', index: 1, blockType: 'tool-call' }
    yield { type: 'block-end', index: 1, block: { type: 'tool-call', id: ToolCallId('preview-edit-1'), name: 'preview_edit', arguments: '{}' } }
    if (process.env.DSH_TEST_BASH === '1') {
      yield { type: 'block-start', index: 2, blockType: 'tool-call' }
      yield { type: 'block-end', index: 2, block: { type: 'tool-call', id: ToolCallId('preview-bash-1'), name: 'bash', arguments: JSON.stringify({ command: 'uname -s', description: 'Check kernel name' }) } }
    }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
  }
}
const adapter = new PreviewAdapter()
ctx.llm.registerAdapter(['pipe-test'], adapter)
await ctx.plugin(MessageFeedbackService, { maxNoteBytes: 8192 }).inertia
await ctx.plugin(Tui, { locale: 'en', appearance: process.env.DSH_TEST_APPEARANCE === 'claude-terminal-light' ? 'claude-terminal-light' : 'claude-terminal-dark', thinking: 'expanded' }).inertia
const code = await done.promise

await writeFile(join(home, 'requests.json'), JSON.stringify({ requests: adapter.requests }))
await ctx.fiber.dispose()
process.exitCode = code
