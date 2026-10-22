/** Real official Node PTC workers; no model transport or synthetic runtime. */
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { boot, createRuntimeResolution, PluginPackages, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

describe('official PTC retained worker state', () => {
  let ctx: Context
  let home: string
  let workspace: string
  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), 'dsh-tui-ptc-'))
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
      { id: 'ptc-runtime', config: { executionMode: 'persistent-in-memory' } },
      { id: 'session-title-llm', disabled: true },
    ], async root => {
      await root.plugin(PluginPackages, { resolution })
      provideCmdline(root, { args: [], exit: () => {} })
    }, pathToFileURL(installAnchor).href)
  }, 120_000)
  afterAll(async () => {
    await ctx?.fiber.dispose(); vi.unstubAllEnvs()
    if (home !== undefined) await rm(home, { recursive: true, force: true })
  })
  it('reuses only the exact owner and loses memory after releasing its process', async () => {
    const runtime = ctx.ptcRuntime
    expect(runtime.programFormat).toBe('repl')
    const owner = {}; const other = {}
    const run = (program: string, stateOwner: object) => runtime.run(runtime.resolve({ program, stateOwner, cwd: workspace, bindings: [] }))
    try {
      expect(await run('var parityMemory = 41; parityMemory', owner)).toMatchObject({ value: 41 })
      expect(await run('parityMemory += 1; parityMemory', owner)).toMatchObject({ value: 42 })
      expect(await run('typeof parityMemory', other)).toMatchObject({ value: 'undefined' })
      await runtime.release(owner)
      expect(await run('typeof parityMemory', owner)).toMatchObject({ value: 'undefined' })
    } finally { await runtime.release(owner); await runtime.release(other) }
  }, 30_000)
  it('cancels a real active worker and never reuses its abandoned memory', async () => {
    const runtime = ctx.ptcRuntime; const owner = {}; const controller = new AbortController()
    const reached = Promise.withResolvers<void>(); const release = Promise.withResolvers<null>()
    const running = runtime.run(runtime.resolve({
      program: 'var abandonedMemory = 73; await fixture.hold(null); abandonedMemory', stateOwner: owner,
      cwd: workspace, signal: controller.signal,
      bindings: [{ global: 'fixture', functions: { hold: async () => { reached.resolve(); return release.promise } } }],
    }))
    try {
      await Promise.race([reached.promise, running.then(result => { throw new Error(`Worker ended before gate: ${JSON.stringify(result)}`) })])
      controller.abort()
      expect(await running).toMatchObject({ error: { kind: 'abort' } })
      release.resolve(null)
      const next = await runtime.run(runtime.resolve({ program: 'typeof abandonedMemory', stateOwner: owner, cwd: workspace, bindings: [] }))
      expect(next).toMatchObject({ value: 'undefined' })
    } finally { controller.abort(); release.resolve(null); await runtime.release(owner) }
  }, 30_000)
})
