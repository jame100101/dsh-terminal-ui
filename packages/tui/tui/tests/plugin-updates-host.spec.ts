import { PluginUpdateController } from '../src/controller/plugin-updates'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const hostRequire = createRequire(require.resolve('@deepseek-ai/dsh-base/package.json'))
// Resolve the installed host's public export, keeping its singleton-sensitive dependency graph.
const { PluginManager } = await import(pathToFileURL(hostRequire.resolve('@deepseek-ai/dsh-plugin-manager')).href)

describe('official rc.2 plugin update lifecycle in an isolated profile', () => {
  it('updates a local bundle without HMR, reports pending restart, and preserves files on failed install', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-plugin-update-'))
    const profile = join(root, 'profile')
    const source = join(root, 'bundle-v2')
    const original = join(root, 'bundle-v1')
    const old = join(profile, 'node_modules', 'local-update-fixture')
    const ctx = new Context()
    try {
      // Keep package-manager configuration and dependency resolution local to
      // the fixture: no real registry credentials or invented registry package.
      await writeFile(join(root, 'npmrc'), '')
      vi.stubEnv('NPM_CONFIG_USERCONFIG', join(root, 'npmrc'))
      vi.stubEnv('HOME', root)
      await mkdir(original)
      await mkdir(old, { recursive: true })
      await mkdir(source, { recursive: true })
      const manifest = (version: string) => JSON.stringify({ name: 'local-update-fixture', version, dsh: { bundle: { patch: './bundle.patch.yml' } } })
      await writeFile(join(original, 'package.json'), manifest('1.0.0'))
      await writeFile(join(original, 'bundle.patch.yml'), '[]\n')
      await writeFile(join(old, 'package.json'), manifest('1.0.0'))
      await writeFile(join(old, 'bundle.patch.yml'), '[]\n')
      await writeFile(join(source, 'package.json'), manifest('2.0.0'))
      await writeFile(join(source, 'bundle.patch.yml'), '[]\n')
      await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'isolated-update-profile', private: true, dependencies: { 'local-update-fixture': `file:${original}` }, dsh: { profile: { bundles: [] } } }))
      await writeFile(join(profile, 'cordis.patch.yml'), '[]\n')
      ctx.provide('profileContext')
      ctx.provide('loader')
      ctx.provide('hmr')
      ctx.set('profileContext', { name: 'fixture', dir: profile, patchPath: join(profile, 'cordis.patch.yml'), home: root, cwd: root, installAnchor: require.resolve('@deepseek-ai/dsh-base/package.json'), startedBundles: [], overlays: [], telemetryDisabledEnv: '1' })
      ctx.set('loader', { entries: () => [] })
      const manager = new PluginManager(ctx, { pnpmCommand: 'pnpm', outputBytes: 65536, lockWaitMs: 1000, inspectTimeoutMs: 1000, githubConnectionTimeoutMs: 1000, idleTimeoutMs: 30000, fallbackRegistries: [] })
      const result = await manager.installBundle(source, { enabled: false, saveExact: true })
      expect(result, JSON.stringify(result)).toMatchObject({ application: 'restart-required', restartReason: 'no-hmr', version: '2.0.0' })
      expect((await manager.listBundles()).find((b: { name: string }) => b.name === 'local-update-fixture')).toMatchObject({ version: '2.0.0', enabled: false })
      const controller = new PluginUpdateController(manager)
      expect(await controller.setEnabled('local-update-fixture', true)).toMatchObject({ application: 'restart-required', restartReason: 'no-hmr' })
      expect((await manager.listBundles()).find((b: { name: string }) => b.name === 'local-update-fixture')).toMatchObject({ enabled: true })
      expect(await controller.setEnabled('local-update-fixture', false)).toMatchObject({ application: 'restart-required' })
      const fresh = join(root, 'fresh-bundle')
      await mkdir(fresh)
      await writeFile(join(fresh, 'package.json'), JSON.stringify({ name: 'fresh-bundle-fixture', version: '1.0.0', dsh: { bundle: { patch: './bundle.patch.yml' } } }))
      await writeFile(join(fresh, 'bundle.patch.yml'), '[]\n')
      expect(await manager.installBundle(fresh, { enabled: false, saveExact: true })).toMatchObject({ application: 'restart-required', version: '1.0.0' })
      expect((await manager.listBundles()).find((b: { name: string }) => b.name === 'fresh-bundle-fixture')).toMatchObject({ installed: true, enabled: false })
      expect(await controller.remove('fresh-bundle-fixture')).toMatchObject({ changed: true, stage: 'remove' })
      expect(JSON.parse(await readFile(join(profile, 'package.json'), 'utf8')).dependencies['fresh-bundle-fixture']).toBeUndefined()
      const saved = await readFile(join(profile, 'package.json'), 'utf8')
      const failed = await manager.installBundle(join(root, 'missing-bundle'), { enabled: false })
      expect(failed.application).toBe('failed')
      expect(await readFile(join(profile, 'package.json'), 'utf8')).toBe(saved)
      ctx.set('hmr', {})
      const refused = await manager.installBundle('local-update-fixture@3.0.0', { enabled: false })
      expect(refused).toMatchObject({ application: 'failed', error: { code: 'already-installed' } })
      expect(await readFile(join(profile, 'package.json'), 'utf8')).toBe(saved)
    } finally {
      vi.unstubAllEnvs()
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  }, 60000)
})
