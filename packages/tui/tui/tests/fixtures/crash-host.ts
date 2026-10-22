/** Isolated child-process probe: official runtime, scripted transport, real durable side effect. */
import { createRequire } from 'node:module'
import { appendFile, readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { boot, createRuntimeResolution, PluginPackages, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createTuiAgent } from '../../src/preset-lifecycle'
import { prepareTuiResume } from '../../src/resume-lifecycle'
import { readTuiSession } from '../../src/session-read'
import { foldFromLog } from '../../src/fold'
import { MockAdapter, textResponse } from '../mock-adapter'
const home = process.env.DSH_HOME!
const mode = process.argv[2]
const workspace = join(home, 'workspace')
await mkdir(workspace, { recursive: true })
const config = join(home, 'cordis.yml')
await writeFile(config, '[]\n')
const require = createRequire(import.meta.url)
const anchor = require.resolve('@deepseek-ai/dsh/package.json')
const resolution = await createRuntimeResolution({ installAnchor: anchor, home })
const ctx = await boot('crash-probe', config, [
  ...loadOverlayPatches('crash-probe', require.resolve('@deepseek-ai/dsh-base/cordis.patch.yml')),
  { id: 'session-persistence-jsonl', config: { root: join(home, 'sessions') } },
  { id: 'storage-json', config: { root: join(home, 'storages') } },
  { id: 'hmr', disabled: true }, { id: 'session-title-llm', disabled: true },
  { id: 'session-telemetry-otel', disabled: true },
], async root => {
  await root.plugin(PluginPackages, { resolution })
  provideCmdline(root, { args: [], exit: () => {} })
}, pathToFileURL(anchor).href)
const adapter = new MockAdapter(mode === 'crash' ? [[
  { type: 'block-start', index: 0, blockType: 'tool-call' },
  { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId('durable-effect'), name: 'effect_probe', arguments: '{}' } },
  { type: 'finish', reason: { kind: 'tool-calls' } },
]] : [textResponse('continued without repeating effect')])
ctx.llm.registerAdapter(['crash-test'], adapter)
ctx.tools.register(defineTool({
  name: 'effect_probe', description: 'Fixture-only effect', parameters: {},
  output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
  execute: async (_args, exec) => {
    await appendFile(join(home, 'effects'), 'executed\n')
    await ctx.sessions.flush(exec.agent!.session)
    await writeFile(join(home, 'ready'), String(exec.agent!.id))
    // The parent kills this process after the call and side effect are durable.
    await new Promise<void>(() => {})
    return 'unreachable'
  },
}))
const prompt = (text: string) => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
if (mode === 'crash') {
  const created = await createTuiAgent(ctx, workspace)
  created.ref.current = { provider: 'crash-test', model: 'fixture' }
  created.agent.followup(prompt('perform the effect'))
  await created.agent.whenIdle()
} else {
  const id = SessionId(await readFile(join(home, 'ready'), 'utf8'))
  const cut = await readTuiSession(ctx.sessionQuery, id)
  const resumed = await prepareTuiResume(ctx, id, { header: cut.session, events: cut.events }, { provider: 'crash-test', model: 'fixture' })
  const before = resumed.handle.agent.session.snapshotEvents()
  const projected = foldFromLog(before)
  const autoRequests = adapter.requests.length
  resumed.handle.agent.followup(prompt('continue explicitly'))
  await resumed.handle.agent.whenIdle()
  await ctx.sessions.flush(resumed.handle.agent.session)
  await writeFile(join(home, 'result.json'), JSON.stringify({ autoRequests, requests: adapter.requests.length,
    before, nodes: projected.fold.nodes, after: resumed.handle.agent.session.snapshotEvents() }))
  await resumed.handle.dispose()
  await ctx.fiber.dispose()
}
