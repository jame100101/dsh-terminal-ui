import { writeHeapSnapshot } from 'node:v8'
import { createRequire } from 'node:module'
import { appendFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { boot, createRuntimeResolution, PluginPackages, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
// Use the built plugin: tsc erases public Cordis const-enum references before packaging.
import { MessageFeedbackService } from '@deepseek-ai/dsh-message-feedback'
import * as Tui from '../../lib/index.js'
import { ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { MockAdapter, textResponse } from '../mock-adapter'
const home = process.env.DSH_HOME!
const done = Promise.withResolvers<number>()
const workspace = join(home, 'workspace')
await mkdir(workspace, { recursive: true })
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
let soakRequests = 0
let soakTools = 0
const withSoakTools = process.env.TUI_PIPE_SOAK === '1' && process.env.DSH_HOST_SOAK_TOOLS === '1'
const soakToolBytes = Number(process.env.DSH_HOST_SOAK_TOOL_BYTES ?? 0)
if (!Number.isSafeInteger(soakToolBytes) || soakToolBytes < 0 || soakToolBytes > 1024 * 1024) throw new Error('Fixture payload must be 0–1 MiB')
if (withSoakTools) ctx.tools.register(defineTool({
  name: 'soak_file_probe', description: 'Verify a disposable fixture file', parameters: {},
  output: { schema: { type:'object', properties:{ value:{type:'string'} }, additionalProperties:false }, render: value => [{type:'text',text:value.value}] },
  execute: async () => {
    const path = join(workspace, 'soak-file-probe.txt')
    const expected = '中文🌏' + 'x'.repeat(soakToolBytes)
    await writeFile(path, expected)
    const value = await readFile(path, 'utf8')
    if (value !== expected) throw new Error('Fixture file verification failed')
    soakTools++
    return {value}
  },
}))
class DelayedAdapter extends MockAdapter {
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (process.env.TUI_PIPE_SOAK === '1') {
      // Only the provider is synthetic; do not retain GenerateOptions in this
      // long-run fixture, which would manufacture a test-owned memory leak.
      soakRequests++
      if (withSoakTools && soakRequests % 2 === 1) {
        yield {type:'block-start',index:0,blockType:'tool-call'}
        yield {type:'block-end',index:0,block:{type:'tool-call',id:ToolCallId(`soak-${soakRequests}`),name:'soak_file_probe',arguments:'{}'}}
        yield {type:'finish',reason:{kind:'tool-calls'}}
        return
      }
      for (const chunk of textResponse(`soak answer ${withSoakTools ? soakRequests / 2 : soakRequests}`)) yield chunk
      return
    }
    for await (const chunk of super.stream(options)) {
      if (process.env.TUI_PIPE_DELAY === '1' && chunk.type === 'block-start') await new Promise(resolve => setTimeout(resolve, 2500))
      yield chunk
    }
  }
}
const adapter = new DelayedAdapter(process.env.TUI_PIPE_FAIL === '1' ? [[
  { type: 'finish', reason: { kind: 'error', failure: { code: 'AUTH', message: 'fixture request refused' } } },
]] : [textResponse('fixture plain answer'), textResponse('fixture second answer'), textResponse('fixture third answer')])
ctx.llm.registerAdapter(['pipe-test'], adapter)
await ctx.plugin(MessageFeedbackService, { maxNoteBytes: 8192 }).inertia
const tuiFiber = ctx.plugin(Tui, { locale: 'en', taskNotifications: process.env.TUI_PIPE_NOTIFY === '1' ? 'always' : 'off' })
await tuiFiber.inertia
if (Tui.inject.some(key => ctx.get(key) === undefined)) throw new Error('Incomplete pipe fixture composition: ' + Tui.inject.filter(key => ctx.get(key) === undefined).join(','))
if (process.env.DSH_HOST_SOAK_HEAP_DIR) await mkdir(process.env.DSH_HOST_SOAK_HEAP_DIR, {recursive:true})
let memorySamples = 0
let heapCheckpoint = 0
const memoryTimer = process.env.TUI_PIPE_SOAK === '1' ? setInterval(() => {
  const snapshotDir = process.env.DSH_HOST_SOAK_HEAP_DIR
  if (snapshotDir && soakRequests >= (heapCheckpoint === 0 ? 100 : 600) && heapCheckpoint < 2) {
    writeHeapSnapshot(join(snapshotDir, `host-${++heapCheckpoint}.heapsnapshot`))
  }
  const collected = process.env.DSH_HOST_SOAK_GC === '1' && ++memorySamples % 30 === 0
  if (collected) globalThis.gc?.()
  appendFileSync(join(home, 'memory.jsonl'), JSON.stringify({at:Date.now(),requests:soakRequests,collected,agents:ctx.agents.list().length,sessions:ctx.sessions.list().length,...process.memoryUsage()}) + '\n')
}, 1000) : undefined
const code = await done.promise
if (memoryTimer) clearInterval(memoryTimer)

await writeFile(join(home, 'requests.json'), JSON.stringify({ tools:soakTools, requests: process.env.TUI_PIPE_SOAK === '1' ? soakRequests : adapter.requests.length }))
await ctx.fiber.dispose()
process.exitCode = code
