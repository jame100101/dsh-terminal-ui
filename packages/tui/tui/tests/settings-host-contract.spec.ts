import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { LlmAdapter, LlmRuntime, type LlmModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildSettingsRows, groupProviders } from '../src/settings-data'
import type { SettingsData } from '../src/store'
const require = createRequire(import.meta.url)
const hostRequire = createRequire(require.resolve('@deepseek-ai/dsh-base/package.json'))
const localUrl = hostRequire.resolve('@deepseek-ai/dsh-credentials-local')
const { LocalCredentialProvider } = await import(pathToFileURL(localUrl).href)
const localRequire = createRequire(localUrl)
const { createLaunchEnvironmentSnapshot } = await import(pathToFileURL(localRequire.resolve('@deepseek-ai/dsh-launch-environment')).href)
const empty = (): SettingsData => ({ general: { busyEnter: 'queue', thinking: 'collapsed', theme: 'dark', locale: 'en' }, models: { providers: [], credentials: [] }, plugins: [], configs: {}, inventory: { namespaces: [], credentials: [], inspectProviders: 0 }, presets: [], currentPreset: undefined })

describe('settings against the official alpha.3 host', () => {
  it('shows managed > process > project > user credential sources without mutating environment or exposing values', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-credential-contract-'))
    const ctx = new Context()
    const ref = credentialRef('DSH_PARITY_FIXTURE_KEY')
    const previous = process.env.DSH_PARITY_FIXTURE_KEY
    try {
      ctx.provide('launchEnvironment')
      ctx.set('launchEnvironment', createLaunchEnvironmentSnapshot([
        { source: 'process', values: { DSH_PARITY_FIXTURE_KEY: 'fixture-process' } },
        { source: 'project-env', values: { DSH_PARITY_FIXTURE_KEY: 'fixture-project', DSH_PARITY_PROJECT_KEY: 'fixture-project' } },
        { source: 'user-env', values: { DSH_PARITY_FIXTURE_KEY: 'fixture-user', DSH_PARITY_PROJECT_KEY: 'fixture-user', DSH_PARITY_USER_KEY: 'fixture-user' } },
      ]))
      const fiber = ctx.plugin(LocalCredentialProvider, { dshHome: home, watch: false })
      await fiber.inertia
      const service = ctx.credentials
      expect(await service.resolve(ref)).toEqual({ value: 'fixture-process', source: 'env' })
      await service.set(ref, 'fixture-managed')
      expect(await service.resolve(ref)).toEqual({ value: 'fixture-managed', source: 'file' })
      expect(await service.describe(ref)).toMatchObject({ configured: true, source: 'file', writable: true })
      const settings = empty()
      settings.models.credentials = [{ ref, ...await service.describe(ref) }]
      const text = buildSettingsRows({ settings, provider: '', model: '', reasoning: { effort: undefined, levels: [] } }, 'models', 'en').map(row => row.text).join('\n')
      expect(text).toContain('configured (file)')
      expect(text).not.toContain('fixture-managed')
      await service.unset(ref)
      expect((await service.resolve(ref))?.source).toBe('env')
      expect((await service.resolve(credentialRef('DSH_PARITY_PROJECT_KEY')))?.source).toBe('project-env')
      expect((await service.resolve(credentialRef('DSH_PARITY_USER_KEY')))?.source).toBe('user-env')
      expect(process.env.DSH_PARITY_FIXTURE_KEY).toBe(previous)
    } finally { await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }) }
  })
  it('refreshes provider-owned catalog and retains an unavailable selected model in settings', async () => {
    const ctx = new Context()
    class Catalog extends LlmAdapter {
      models: LlmModelInfo[] = [{ provider: 'fixture', id: 'old', name: 'Old' }]
      override async listModels() { return this.models }
      override async *stream(): AsyncIterable<StreamChunk> { throw new Error('catalog test never sends provider requests') }
    }
    try {
      const llm = new LlmRuntime(ctx)
      const adapter = new Catalog()
      const registration = llm.registerAdapter(['fixture'], adapter)
      expect((await llm.listModels('fixture')).map(model => model.id)).toEqual(['old'])
      adapter.models = [{ provider: 'fixture', id: 'new', name: 'New', inputModalities: ['text', 'image'] }]
      const settings = empty()
      settings.models.providers = groupProviders((await llm.listModels('fixture')).map(model => ({ provider: model.provider, model: model.id, acceptsImage: model.inputModalities?.includes('image') === true })))
      const rows = buildSettingsRows({ settings, provider: 'fixture', model: 'old', reasoning: { effort: undefined, levels: [] } }, 'models', 'en')
      expect(rows.find(row => row.key === 'm-current-unavailable')?.text).toContain('fixture/old')
      expect(rows.find(row => row.meta?.model === 'new')?.text).toContain('image')
      registration.replace(['renamed'])
      await expect(llm.listModels('fixture')).rejects.toThrow('no adapter registered')
    } finally { await ctx.fiber.dispose() }
  })
})

describe('plugin version settings projection', () => {
  it('offers exact-version action only for owned bundles and separates pending installed/runtime versions', () => {
    const settings = empty()
    settings.bundles = [
      { name: 'third-party-fixture', version: '1.0.0', installed: true, enabled: true, availability: 'profile' },
      { name: '@jame100101/dsh-tui', version: '0.2.2', installed: true, enabled: true, availability: 'profile' },
    ]
    settings.pluginUpdates = [{ name: 'third-party-fixture', requestedVersion: '2.0.0', installedVersion: '2.0.0', phase: 'pending-restart', restartReason: 'no-hmr', rollbackSpec: 'third-party-fixture@1.0.0', rollback: 'available' }]
    const rows = buildSettingsRows({ settings, provider: '', model: '', reasoning: { effort: undefined, levels: [] } }, 'plugins', 'en')
    expect(rows.filter(row => row.action === 'update-plugin').map(row => row.meta)).toEqual([{ name: 'third-party-fixture', version: '1.0.0' }])
    expect(rows.find(row => row.key === 'bundle-result-third-party-fixture')?.text).toContain('pending-restart · installed: 2.0.0 · last applied: unknown · no-hmr')
    expect(rows.find(row => row.key === 'bundle-rollback-third-party-fixture')?.text).toContain('requires a separate explicit version change')
    const general = buildSettingsRows({ settings, provider: '', model: '', reasoning: { effort: undefined, levels: [] } }, 'general', 'en')
    expect(general.find(row => row.action === 'cycle-keymap')?.text).toContain('legacy-dsh')
  })
})
