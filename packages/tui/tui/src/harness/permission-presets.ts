import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { TuiSnapshot } from '../store'

/** Optional rc.2 public service. No runtime import or second registry instance. */
interface PermissionPresets {
  catalog(): { options: { value: string; name: string; description?: string }[]; defaultOptions?: { value: string; name: string }[]; defaultPreset?: string }
  current(session: Session): string
  set(session: Session, name: string): void
}
function service(ctx: Context): PermissionPresets | undefined {
  const value = ctx.get('permissionPresets') as PermissionPresets | undefined
  return value && typeof value.catalog === 'function' && typeof value.current === 'function' && typeof value.set === 'function' ? value : undefined
}
export function readPermissionPresets(ctx: Context, agent: Agent): TuiSnapshot['permissionCatalog'] {
  const presets = service(ctx)
  if (!presets) return undefined
  const catalog = presets.catalog()
  return { current: presets.current(agent.session), options: catalog.options.map(option => ({ ...option })),
    ...(catalog.defaultOptions ? { defaultOptions: catalog.defaultOptions.map(option => ({ ...option })) } : {}),
    ...(catalog.defaultPreset ? { defaultPreset: catalog.defaultPreset } : {}), defaultWritable: ctx.get('settings') !== undefined }

}
export function selectPermissionPreset(ctx: Context, agent: Agent, name: string): void {
  const presets = service(ctx)
  if (!presets || !presets.catalog().options.some(option => option.value === name)) throw new Error('Permission preset is no longer available')
  presets.set(agent.session, name)
}

/** Resolve the actual Loader namespace, never assume a profile's entry id. */
function defaultDescriptor(ctx: Context) {
  const loader = ctx.get('loader'), settings = ctx.get('settings')
  if (!loader || !settings) return undefined
  const ids = new Set([...loader.entries()].filter(entry => entry.options.name === '@deepseek-ai/dsh-permission-presets').map(entry => entry.options.id))
  const found = settings.describe({ redactSecrets: true }).filter(item => ids.has(item.ns))
  return found.length === 1 ? found[0] : undefined
}
export async function setPermissionDefault(ctx: Context, name: string): Promise<void> {
  const presets = service(ctx), descriptor = defaultDescriptor(ctx)
  if (!presets?.catalog().defaultOptions?.some(option => option.value === name) || !descriptor) throw new Error('Permission default is unavailable')
  // The host excludes experimental Auto from defaults. Do not modify any Session.
  await ctx.settings.update(descriptor.ns, { defaultPreset: name }, descriptor.revision)
}
