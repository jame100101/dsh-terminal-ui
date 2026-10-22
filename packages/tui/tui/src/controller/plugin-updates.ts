import type { PluginUpdateState } from '../harness/adapter'
export type { PluginUpdateState } from '../harness/adapter'
/** Structural subset of the official rc.2 PluginManager public API; no second runtime import. */
export interface ManagedBundle {
  name: string
  version?: string
  installed: boolean
  enabled: boolean
  availability: 'installation' | 'profile' | 'missing'
  removable?: boolean
  official?: boolean
  readOnlyReason?: string
  rows?: readonly { moduleName: string }[]
}
export interface BundleChangeResult {
  changed: boolean
  application: 'applied' | 'restart-required' | 'overridden' | 'failed' | 'cancelled'
  stage: 'install' | 'enable' | 'remove'
  target: string
  restartReason?: string
  version?: string
  error?: { code: string; diagnostic?: string }
}
export interface BundleManager {
  listBundles(): Promise<ManagedBundle[]>
  removeBundle?(name: string): Promise<BundleChangeResult>
  setBundleEnabled?(name: string, enabled: boolean): Promise<BundleChangeResult>
  installBundle(spec: string, options: { enabled: boolean; saveExact: boolean }): Promise<BundleChangeResult>
}
const protectedName = (name: string) => name.startsWith('@deepseek-ai/') || name === '@jame100101/dsh-tui'
  || name === 'react' || name === 'ink' || name.includes('dsh-tui')
const exactVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
export function bundleUpdateBlockedReason(bundle: ManagedBundle): string | undefined {
  if (!bundle.installed || bundle.availability !== 'profile') return 'profile-owned-bundle-required'
  if (bundle.official || bundle.readOnlyReason || protectedName(bundle.name)
    || bundle.rows?.some(row => protectedName(row.moduleName))) return 'protected-runtime-bundle'
  return undefined
}

/** Serializes operations and re-reads profile ownership before every explicit version change. */
export class PluginUpdateController {
  private busy = false
  private readonly states = new Map<string, PluginUpdateState>()
  constructor(private readonly manager: BundleManager, private readonly changed: () => void = () => {}) {}
  snapshot(): readonly PluginUpdateState[] { return [...this.states.values()].map(state => ({ ...state })) }
  private publish(state: PluginUpdateState): PluginUpdateState {
    this.states.set(state.name, state)
    this.changed()
    return { ...state }
  }
  async setEnabled(name: string, enabled: boolean): Promise<BundleChangeResult> {
    if (this.busy) throw new Error('plugin-operation-in-progress')
    if (!this.manager.setBundleEnabled) throw new Error('bundle-selection-unavailable')
    this.busy = true
    try {
      const bundle = (await this.manager.listBundles()).find(item => item.name === name)
      if (!bundle) throw new Error('unknown-plugin-bundle')
      const blocked = bundleUpdateBlockedReason(bundle)
      if (blocked) throw new Error(blocked)
      return await this.manager.setBundleEnabled(name, enabled)
    } finally { this.busy = false }
  }
  async remove(name: string): Promise<BundleChangeResult> {
    if (this.busy) throw new Error('plugin-operation-in-progress')
    if (!this.manager.removeBundle) throw new Error('bundle-removal-unavailable')
    this.busy = true
    try {
      const bundle = (await this.manager.listBundles()).find(item => item.name === name)
      if (!bundle?.removable) throw new Error('bundle-not-removable')
      const blocked = bundleUpdateBlockedReason(bundle)
      if (blocked) throw new Error(blocked)
      return await this.manager.removeBundle(name)
    } finally { this.busy = false }
  }
  async install(name: string, version: string): Promise<PluginUpdateState> {
    return this.change(name, version, true)
  }
  async update(name: string, version: string): Promise<PluginUpdateState> {
    return this.change(name, version, false)
  }
  private async change(name: string, version: string, installNew: boolean): Promise<PluginUpdateState> {
    if (this.busy) throw new Error('plugin-operation-in-progress')
    if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(name)) throw new Error('invalid-plugin-name')
    if (!exactVersion.test(version)) throw new Error('exact-plugin-version-required')
    this.busy = true
    try {
      const found = (await this.manager.listBundles()).find(bundle => bundle.name === name)
      if (installNew && (protectedName(name) || found?.installed || found?.availability === 'installation' || found?.official || found?.readOnlyReason)) throw new Error('new-third-party-bundle-required')
      if (!installNew && !found) throw new Error('unknown-plugin-bundle')
      // New bundles are installed inactive; activation is a separate user decision.
      const before: ManagedBundle = found ?? { name, installed: false, enabled: false, availability: 'missing' }
      const blocked = installNew ? undefined : bundleUpdateBlockedReason(before)
      if (blocked) throw new Error(blocked)
      const prior = this.states.get(name)
      const base: PluginUpdateState = {
        name, requestedVersion: version, phase: 'installing', rollback: 'not-needed',
        ...(before.version ? { installedVersion: before.version, rollbackSpec: `${name}@${before.version}` } : {}),
        ...(before.enabled && prior?.loadedVersion ? { loadedVersion: prior.loadedVersion } : {}),
      }
      this.publish(base)
      let result: BundleChangeResult
      try {
        // Preserve selection; never grant build-script or compatibility exemptions here.
        result = await this.manager.installBundle(`${name}@${version}`, { enabled: installNew ? false : before.enabled, saveExact: true })
      } catch (error) {
        const { installedVersion: _beforeVersion, ...unknownBase } = base
        void _beforeVersion
        let observed: ManagedBundle | undefined
        try { observed = (await this.manager.listBundles()).find(bundle => bundle.name === name) } catch { /* A thrown operation establishes no disk outcome. */ }
        return this.publish({ ...unknownBase, phase: 'failed',
          ...(observed?.version ? { installedVersion: observed.version } : {}),
          rollback: !observed?.version ? 'unknown' : observed.version === before.version ? 'not-needed' : before.version ? 'available' : 'unknown',
          error: String(error) })
      }
      let after: ManagedBundle | undefined
      try { after = (await this.manager.listBundles()).find(bundle => bundle.name === name) } catch { /* Keep disk state unknown. */ }
      const { installedVersion: _oldInstalled, ...observed } = base
      void _oldInstalled
      const phase = result.application === 'restart-required' ? 'pending-restart' : result.application
      const state: PluginUpdateState = {
        ...observed, phase,
        ...(after?.version ? { installedVersion: after.version } : {}),
        ...(result.restartReason ? { restartReason: result.restartReason } : {}),
        ...(result.error ? { error: result.error.code + (result.error.diagnostic ? `: ${result.error.diagnostic}` : '') } : {}),
        rollback: !after?.version ? 'unknown' : after.version === before.version ? 'not-needed' : before.version ? 'available' : 'unknown',
      }
      // Only an explicit successful application for a selected bundle establishes loaded version.
      if (result.application === 'applied' && !installNew && before.enabled && result.version) state.loadedVersion = result.version
      return this.publish(state)
    } finally { this.busy = false }
  }
}

/** Registry-only exact specs; no tags, URLs, local paths or implicit scripts. */
export function parseExactBundleSpec(spec: string): { name: string; version: string } | null {
  const match = /^(?<name>(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*)@(?<version>.+)$/.exec(spec.trim())
  return match?.groups && exactVersion.test(match.groups.version!) ? { name: match.groups.name!, version: match.groups.version! } : null
}
