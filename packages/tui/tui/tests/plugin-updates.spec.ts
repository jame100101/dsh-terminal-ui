import { describe, expect, it, vi } from 'vitest'
import { PluginUpdateController, bundleUpdateBlockedReason, parseExactBundleSpec, type BundleChangeResult, type ManagedBundle } from '../src/controller/plugin-updates.ts'
const bundle = (version = '1.0.0'): ManagedBundle => ({ name: 'test-bundle', installed: true, enabled: true, availability: 'profile', version })
function fixture(result: BundleChangeResult, after = '2.0.0') {
  const listBundles = vi.fn().mockResolvedValueOnce([bundle()]).mockResolvedValue([bundle(after)])
  const installBundle = vi.fn().mockResolvedValue(result)
  return { controller: new PluginUpdateController({ listBundles, installBundle }), listBundles, installBundle }
}
describe('official plugin update result projection', () => {
  it('keeps disk version separate from unknown runtime for restart-required', async () => {
    const f = fixture({ changed: true, application: 'restart-required', restartReason: 'package-moved', stage: 'enable', target: 'test-bundle', version: '2.0.0' })
    expect(await f.controller.update('test-bundle', '2.0.0')).toEqual({ name: 'test-bundle', phase: 'pending-restart', requestedVersion: '2.0.0', installedVersion: '2.0.0', restartReason: 'package-moved', rollbackSpec: 'test-bundle@1.0.0', rollback: 'available' })
    expect(f.installBundle).toHaveBeenCalledWith('test-bundle@2.0.0', { enabled: true, saveExact: true })
  })
  it.each(['no-hmr', 'host-module', 'unmanaged-plugin', 'module-comparison'])('retains host restart reason %s', async restartReason => {
    const f = fixture({ changed: true, application: 'restart-required', restartReason, stage: 'enable', target: 'test-bundle' })
    expect((await f.controller.update('test-bundle', '2.0.0')).restartReason).toBe(restartReason)
  })
  it('reports HMR already-installed failure without deleting the old bundle', async () => {
    const f = fixture({ changed: false, application: 'failed', stage: 'install', target: 'test-bundle', error: { code: 'already-installed' } }, '1.0.0')
    expect(await f.controller.update('test-bundle', '2.0.0')).toMatchObject({ phase: 'failed', installedVersion: '1.0.0', error: 'already-installed', rollback: 'not-needed' })
    expect(f.installBundle).toHaveBeenCalledTimes(1)
  })
  it.each(['failed', 'cancelled', 'overridden'] as const)('does not claim new code loaded after %s', async application => {
    const f = fixture({ changed: true, application, stage: 'enable', target: 'test-bundle', version: '2.0.0' })
    expect((await f.controller.update('test-bundle', '2.0.0')).loadedVersion).toBeUndefined()
  })
  it('records loaded version only after selected bundle applied', async () => {
    const f = fixture({ changed: true, application: 'applied', stage: 'enable', target: 'test-bundle', version: '2.0.0' })
    expect((await f.controller.update('test-bundle', '2.0.0')).loadedVersion).toBe('2.0.0')
  })
  it('preserves disabled selection and avoids claiming inactive code is loaded', async () => {
    const f = fixture({ changed: true, application: 'applied', stage: 'enable', target: 'test-bundle', version: '2.0.0' })
    f.listBundles.mockReset().mockResolvedValue([{ ...bundle(), enabled: false }])
    expect((await f.controller.update('test-bundle', '2.0.0')).loadedVersion).toBeUndefined()
    expect(f.installBundle).toHaveBeenCalledWith('test-bundle@2.0.0', { enabled: false, saveExact: true })
  })
  it('rejects ranges, shell text and duplicate concurrent operations', async () => {
    let settle!: (result: BundleChangeResult) => void
    const installBundle = vi.fn(() => new Promise<BundleChangeResult>(resolve => { settle = resolve }))
    const controller = new PluginUpdateController({ listBundles: async () => [bundle()], installBundle })
    await expect(controller.update('test-bundle', 'latest')).rejects.toThrow('exact-plugin-version-required')
    await expect(controller.update('test-bundle', '1.0.0;touch bad')).rejects.toThrow('exact-plugin-version-required')
    const pending = controller.update('test-bundle', '2.0.0')
    await Promise.resolve()
    await expect(controller.update('test-bundle', '2.0.1')).rejects.toThrow('plugin-operation-in-progress')
    expect(controller.snapshot()[0]?.phase).toBe('installing')
    settle({ changed: false, application: 'cancelled', stage: 'install', target: 'test-bundle' })
    await pending
  })
  it('never permits changing host, TUI, runtime dependencies or installation-owned bundles', () => {
    for (const b of [{ ...bundle(), name: '@jame100101/dsh-tui' }, { ...bundle(), official: true }, { ...bundle(), availability: 'installation' as const }, { ...bundle(), rows: [{ moduleName: '@deepseek-ai/dsh-hmr' }] }, { ...bundle(), readOnlyReason: 'management-required' }]) {
      expect(bundleUpdateBlockedReason(b)).toBeTruthy()
    }
  })
  it('does not infer rollback or installed version when host inventory cannot be read', async () => {
    const f = fixture({ changed: true, application: 'failed', stage: 'enable', target: 'test-bundle' })
    f.listBundles.mockReset().mockResolvedValueOnce([bundle()]).mockRejectedValue(new Error('inventory unavailable'))
    const state = await f.controller.update('test-bundle', '2.0.0')
    expect(state.installedVersion).toBeUndefined()
    expect(state.rollbackSpec).toBe('test-bundle@1.0.0')
  })
})


describe('exceptional plugin operation evidence', () => {
  it('re-reads disk after an operation throws following a partial package write', async () => {
    const listBundles = vi.fn().mockResolvedValueOnce([bundle()]).mockResolvedValue([bundle('2.0.0')])
    const controller = new PluginUpdateController({ listBundles, installBundle: async () => { throw new Error('transport disposed after package write') } })
    expect(await controller.update('test-bundle', '2.0.0')).toMatchObject({ phase: 'failed', installedVersion: '2.0.0', rollback: 'available' })
    expect(controller.snapshot()[0]?.loadedVersion).toBeUndefined()
  })
  it('never presents the old installed version as current when the operation and inventory both fail', async () => {
    const listBundles = vi.fn().mockResolvedValueOnce([bundle()]).mockRejectedValue(new Error('inventory unavailable'))
    const controller = new PluginUpdateController({ listBundles, installBundle: async () => { throw new Error('unknown outcome') } })
    const state = await controller.update('test-bundle', '2.0.0')
    expect(state.installedVersion).toBeUndefined()
    expect(state.rollback).toBe('unknown')
    expect(state.rollbackSpec).toBe('test-bundle@1.0.0')
  })
  it('clears prior activation acknowledgement when inventory observes the bundle disabled', async () => {
    let enabled = true
    const controller = new PluginUpdateController({ listBundles: async () => [{ ...bundle('2.0.0'), enabled }], installBundle: async () => ({ changed: false, application: 'applied', stage: 'enable', target: 'test-bundle', version: '2.0.0' }) })
    expect((await controller.update('test-bundle', '2.0.0')).loadedVersion).toBe('2.0.0')
    enabled = false
    expect((await controller.update('test-bundle', '2.0.0')).loadedVersion).toBeUndefined()
  })
})

describe('new plugin installation and independent activation', () => {
  it('installs a registry bundle disabled and never grants scripts or compatibility exemptions', async () => {
    const installBundle = vi.fn().mockResolvedValue({ changed: true, application: 'applied', stage: 'install', target: 'new-bundle', version: '1.2.3' })
    const listBundles = vi.fn().mockResolvedValueOnce([]).mockResolvedValue([{ ...bundle('1.2.3'), name: 'new-bundle', enabled: false }])
    const controller = new PluginUpdateController({ listBundles, installBundle })
    const result = await controller.install('new-bundle', '1.2.3')
    expect(installBundle).toHaveBeenCalledExactlyOnceWith('new-bundle@1.2.3', { enabled: false, saveExact: true })
    expect(result.loadedVersion).toBeUndefined()
    expect(result.installedVersion).toBe('1.2.3')
  })
  it('rejects replacing existing or protected packages through new-install controls', async () => {
    const installBundle = vi.fn()
    const controller = new PluginUpdateController({ listBundles: async () => [bundle()], installBundle })
    for (const name of ['test-bundle', '@deepseek-ai/dsh', 'react', '@jame100101/dsh-tui']) await expect(controller.install(name, '1.2.3')).rejects.toThrow('new-third-party')
    expect(installBundle).not.toHaveBeenCalled()
  })
  it('rechecks ownership before enabling and preserves restart-required evidence', async () => {
    const setBundleEnabled = vi.fn().mockResolvedValue({ changed: true, application: 'restart-required', restartReason: 'no-hmr', stage: 'enable', target: 'test-bundle' })
    const listBundles = vi.fn().mockResolvedValue([bundle()])
    const controller = new PluginUpdateController({ listBundles, setBundleEnabled, installBundle: vi.fn() })
    expect(await controller.setEnabled('test-bundle', true)).toMatchObject({ application: 'restart-required', restartReason: 'no-hmr' })
    listBundles.mockResolvedValue([{ ...bundle(), availability: 'installation' }])
    await expect(controller.setEnabled('test-bundle', false)).rejects.toThrow('profile-owned')
    expect(setBundleEnabled).toHaveBeenCalledTimes(1)
  })
})

it('accepts only exact registry specs in the install editor', () => {
  expect(parseExactBundleSpec('@example/bundle@1.2.3-rc.2')).toEqual({name:'@example/bundle',version:'1.2.3-rc.2'})
  for (const input of ['bundle@latest','bundle@^1.2.3','https://example.com/a.tgz','./local','bundle@1.2.3;touch bad']) expect(parseExactBundleSpec(input)).toBeNull()
})

it('removes only explicitly removable profile bundles after a fresh ownership check', async () => {
  const removeBundle=vi.fn().mockResolvedValue({changed:true,application:'restart-required',restartReason:'no-hmr',stage:'remove',target:'test-bundle'})
  const listBundles=vi.fn().mockResolvedValue([{...bundle(),removable:true}])
  const controller=new PluginUpdateController({listBundles,removeBundle,installBundle:vi.fn()})
  expect(await controller.remove('test-bundle')).toMatchObject({stage:'remove',application:'restart-required'})
  listBundles.mockResolvedValue([{...bundle(),removable:false}])
  await expect(controller.remove('test-bundle')).rejects.toThrow('not-removable')
  listBundles.mockResolvedValue([{...bundle(),removable:true,official:true}])
  await expect(controller.remove('test-bundle')).rejects.toThrow('protected-runtime')
  expect(removeBundle).toHaveBeenCalledTimes(1)
})
