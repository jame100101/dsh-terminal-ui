import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FiberState, type Context } from '@deepseek-ai/cordis'
import Hmr from '@deepseek-ai/cordis-plugin-hmr'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import { boot, watchUserPatches } from '@deepseek-ai/dsh-app-boot'
import { afterEach, describe, expect, it } from 'vitest'
import type { LoaderEntryView } from '../src/patch-toggle'
import { toggleProfilePlugin } from '../src/plugin-toggle-runtime'

interface MutableLoaderEntry extends LoaderEntryView {
  fiber?: {
    state?: number
    inject: Record<string, unknown>
    store?: Record<string, unknown>
  }
}

interface FakeLoaderContext {
  ctx: Context
  emit(event: string, ...args: unknown[]): void
}

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

async function patchFile(content = '[]\n'): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-tui-plugin-toggle-'))
  temporaryDirectories.push(directory)
  const filename = join(directory, 'cordis.patch.yml')
  await writeFile(filename, content, 'utf8')
  return filename
}

function entry(id: string, disabled: boolean, fiber = !disabled): MutableLoaderEntry {
  return {
    id: `include:${id}`,
    disabled,
    options: { id, name: id },
    ...(fiber ? { fiber: { state: FiberState.ACTIVE, inject: {}, store: {} } } : {}),
  }
}

function fakeContext(entries: MutableLoaderEntry[]): FakeLoaderContext {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  const ctx = {
    loader: { entries: () => entries.values() },
    on: (event: string, listener: (...args: unknown[]) => void) => {
      const bucket = listeners.get(event) ?? new Set()
      bucket.add(listener)
      listeners.set(event, bucket)
      return () => { bucket.delete(listener) }
    },
  } as unknown as Context
  return {
    ctx,
    emit: (event, ...args) => {
      for (const listener of listeners.get(event) ?? []) listener(...args)
    },
  }
}

async function waitForFile(filename: string, text: string): Promise<void> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    if ((await readFile(filename, 'utf8')).includes(text)) return
    await new Promise<void>(resolve => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${text}`)
}

describe('toggleProfilePlugin', () => {
  it('enables and disables a real root profile row through the live watcher', { timeout: 20_000 }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-tui-plugin-toggle-live-'))
    temporaryDirectories.push(directory)
    const config = join(directory, 'cordis.yml')
    const patch = join(directory, 'cordis.patch.yml')
    await writeFile(join(directory, 'noop.mjs'), 'export function apply() {}\n', 'utf8')
    await writeFile(config, '- id: optional\n  name: ./noop.mjs\n  disabled: true\n', 'utf8')
    await writeFile(patch, '[]\n', 'utf8')
    const ctx = await boot('dsh-tui-plugin-toggle-test', config)
    await ctx.plugin(Timer)
    await ctx.plugin(Hmr, { root: [], ignored: [], debounce: 0 })
    const disposeWatch = await watchUserPatches(ctx, {
      binName: 'dsh-tui-plugin-toggle-test',
      filename: patch,
    })
    try {
      await expect(toggleProfilePlugin({
        ctx,
        patchPath: patch,
        id: 'optional',
        surfacePluginId: 'tui',
        protectedIds: [],
        settleTimeoutMs: 5_000,
      })).resolves.toEqual({ ok: true, enabled: true })
      expect([...ctx.loader.entries()].find(candidate => candidate.options.id === 'optional')?.fiber).toBeDefined()
      // Chokidar's atomic-write coalescer needs its short rename window to
      // close before this test requires a second independent notification.
      await new Promise<void>(resolve => setTimeout(resolve, 250))
      await expect(toggleProfilePlugin({
        ctx,
        patchPath: patch,
        id: 'optional',
        surfacePluginId: 'tui',
        protectedIds: [],
        settleTimeoutMs: 5_000,
      })).resolves.toEqual({ ok: true, enabled: false })
      expect([...ctx.loader.entries()].find(candidate => candidate.options.id === 'optional')?.fiber).toBeUndefined()
    } finally {
      await disposeWatch()
      await ctx.fiber.dispose()
    }
  })

  it('persists disable and resolves after Loader disposal', async () => {
    const target = entry('storage', false)
    const runtime = fakeContext([target])
    const filename = await patchFile()
    const result = toggleProfilePlugin({
      ctx: runtime.ctx,
      patchPath: filename,
      id: 'storage',
      surfacePluginId: 'tui',
      protectedIds: [],
      settleTimeoutMs: 1_000,
    })
    await waitForFile(filename, 'disabled: true')
    target.disabled = true
    target.fiber = undefined
    runtime.emit('internal/status')
    await expect(result).resolves.toEqual({ ok: true, enabled: false })
  })

  it('persists enable and resolves only after an active Loader fiber exists', async () => {
    const target = entry('storage', true, false)
    const runtime = fakeContext([target])
    const filename = await patchFile('- id: storage\n  disabled: true\n')
    const result = toggleProfilePlugin({
      ctx: runtime.ctx,
      patchPath: filename,
      id: 'storage',
      surfacePluginId: 'tui',
      protectedIds: [],
      settleTimeoutMs: 1_000,
    })
    await waitForFile(filename, 'disabled: false')
    target.disabled = false
    target.fiber = { state: FiberState.ACTIVE, inject: {}, store: {} }
    runtime.emit('internal/status')
    await expect(result).resolves.toEqual({ ok: true, enabled: true })
  })

  it('rejects a provider with active dependents before writing', async () => {
    const provider = entry('storage', false)
    provider.fiber = { state: FiberState.ACTIVE, inject: {}, store: { storage: {} } }
    const consumer = entry('storage-domain', false)
    consumer.fiber = { state: FiberState.ACTIVE, inject: { storage: null }, store: {} }
    const runtime = fakeContext([provider, consumer])
    const filename = await patchFile()
    await expect(toggleProfilePlugin({
      ctx: runtime.ctx,
      patchPath: filename,
      id: 'storage',
      surfacePluginId: 'tui',
      protectedIds: [],
      settleTimeoutMs: 100,
    })).resolves.toEqual({ ok: false, code: 'dependency-blocked', blockers: ['storage-domain'] })
    await expect(readFile(filename, 'utf8')).resolves.toBe('[]\n')
  })

  it('keeps deployment-managed rows outside the profile switch action', async () => {
    const target = entry('tool-bash', true, false)
    const runtime = fakeContext([target])
    const filename = await patchFile()
    await expect(toggleProfilePlugin({
      ctx: runtime.ctx,
      patchPath: filename,
      id: 'tool-bash',
      surfacePluginId: 'tui',
      protectedIds: ['tool-bash'],
      settleTimeoutMs: 100,
    })).resolves.toEqual({ ok: false, code: 'profile-managed' })
    await expect(readFile(filename, 'utf8')).resolves.toBe('[]\n')
  })

  it('reports a preset-only row as managed without waiting or writing', async () => {
    const target = entry('tool-subagent-claude-code', true, false)
    target.id = 'include:agent-presets:tool-subagent-claude-code'
    const runtime = fakeContext([target])
    const filename = await patchFile()
    await expect(toggleProfilePlugin({
      ctx: runtime.ctx,
      patchPath: filename,
      id: 'tool-subagent-claude-code',
      surfacePluginId: 'tui',
      protectedIds: [],
      settleTimeoutMs: 60_000,
    })).resolves.toEqual({ ok: false, code: 'profile-managed' })
    await expect(readFile(filename, 'utf8')).resolves.toBe('[]\n')
  })

  it('rolls the exact patch text back when hot apply times out', async () => {
    const target = entry('storage', false)
    const runtime = fakeContext([target])
    const before = '# keep this comment\n[]\n'
    const filename = await patchFile(before)
    const result = await toggleProfilePlugin({
      ctx: runtime.ctx,
      patchPath: filename,
      id: 'storage',
      surfacePluginId: 'tui',
      protectedIds: [],
      settleTimeoutMs: 20,
    })
    expect(result).toMatchObject({ ok: false, code: 'apply-failed', rollback: 'restored' })
    await expect(readFile(filename, 'utf8')).resolves.toBe(before)
  })

  it('rolls back immediately when Loader reports an HMR rejection', async () => {
    const target = entry('storage', false)
    const runtime = fakeContext([target])
    const before = '[]\n'
    const filename = await patchFile(before)
    const result = toggleProfilePlugin({
      ctx: runtime.ctx,
      patchPath: filename,
      id: 'storage',
      surfacePluginId: 'tui',
      protectedIds: [],
      settleTimeoutMs: 1_000,
    })
    await waitForFile(filename, 'disabled: true')
    runtime.emit('internal/dispatch', 'parallel', 'hmr/config-update-failed', [filename, new Error('candidate rejected')])
    await expect(result).resolves.toMatchObject({
      ok: false,
      code: 'apply-failed',
      detail: 'candidate rejected',
      rollback: 'restored',
    })
    await expect(readFile(filename, 'utf8')).resolves.toBe(before)
  })

  it('preserves a later file edit instead of restoring an obsolete snapshot', async () => {
    const target = entry('storage', false)
    const runtime = fakeContext([target])
    const filename = await patchFile('[]\n')
    const result = toggleProfilePlugin({
      ctx: runtime.ctx,
      patchPath: filename,
      id: 'storage',
      surfacePluginId: 'tui',
      protectedIds: [],
      settleTimeoutMs: 1_000,
    })
    await waitForFile(filename, 'disabled: true')
    const concurrent = '- id: storage\n  disabled: true\n# concurrent editor\n'
    await writeFile(filename, concurrent, 'utf8')
    runtime.emit('internal/dispatch', 'parallel', 'hmr/config-update-failed', [filename, new Error('candidate rejected')])
    await expect(result).resolves.toMatchObject({
      ok: false,
      code: 'apply-failed',
      rollback: 'preserved-concurrent-edit',
    })
    await expect(readFile(filename, 'utf8')).resolves.toBe(concurrent)
  })
})
