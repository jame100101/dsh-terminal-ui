import { APPEARANCES, currentAppearance } from './theme'
import { bundleUpdateBlockedReason } from './controller/plugin-updates'
import { displayTextMatches } from './display-redaction'
/**
 * Pure projections for the /settings pages and the /jobs, /subagents,
 * and /workflows panels: walking serialized schemastery schema JSON for
 * `credential-ref` fields (value-free by construction — only the reference
 * name, never the secret), grouping the model routes by provider, and
 * formatting the live service rows. Zero Cordis imports: unit-testable.
 * @module @deepseek-ai/dsh-tui/src/settings-data
 */

import type { JobRow, PluginConfigField, SessionEntry, SettingsData, SettingsProviderRow, SubagentRow, WorkflowRow, TuiSnapshot } from './store'

/** One /settings page id. */
export type SettingsPageId = 'general' | 'models' | 'permissions' | 'plugins' | 'mcp' | 'presets' | 'appearance' | 'diagnostics' | 'inventory'

/** Settings pages in keyboard-cycle order; Inventory remains a compatibility entry. */
export const SETTINGS_PAGES: readonly SettingsPageId[] = ['general', 'models', 'permissions', 'plugins', 'mcp', 'presets', 'appearance', 'diagnostics', 'inventory']

/** One displayed panel row, built by the pure projections in this module. */
export interface PanelRow {
  key: string
  text: string
  columns?: { label: string; value: string }
  continuationOf?: string
  color?: string
  dim?: boolean
  /** Which renderer action Enter triggers; absent rows are inert. */
  action?: 'remove-bundle' | 'set-permission-default' | 'toggle-bundle' | 'install-plugin' | 'manage-mcp' | 'select-permission-preset' | 'rewind-session' | 'toggle-notifications' | 'set-approval-policy' | 'inspect-task' | 'set-appearance' | 'update-plugin' | 'cycle-keymap' | 'toggle-busy-enter' | 'toggle-thinking' | 'toggle-locale' | 'select-model' | 'select-reasoning-effort' | 'edit-credential' | 'kill-job' | 'inspect-job' | 'request-job-stop' | 'resume-session' | 'toggle-plugin' | 'toggle-config-boolean' | 'edit-config-number' | 'edit-config-secret' | 'edit-config-string' | 'select-preset'
  meta?: { name?: string; version?: string; provider?: string; model?: string; ref?: string; id?: string; effort?: string; ns?: string; field?: string; enabled?: boolean }
}

/** The reasoning-effort facts the models page needs. */
export interface ReasoningView {
  /** The currently selected effort for the default route, if any. */
  effort: string | undefined
  /** Adapter-exposed selectable levels for the current route. */
  levels: readonly string[]
}

/** Value-free credential state (`configured (src)`/`not configured`, plus `read-only`). */
function credentialState(configured: boolean, source: string | undefined, writable: boolean, locale: 'zh' | 'en'): string {
  const state = locale === 'en'
    ? (configured ? `configured (${source ?? ''})` : 'not configured')
    : (configured ? `已配置 (${source ?? ''})` : '未配置')
  const suffix = writable ? '' : (locale === 'en' ? ' · read-only' : ' · 只读')
  return `${state}${suffix}`
}

/**
 * Project the actual host facts into the settings pages.
 * @param snapshot - the settings snapshot plus the current model and reasoning view.
 * @param page - which page to project.
 * @param locale - the surface language; `en` renders English copy, `zh` Chinese.
 * @returns the panel rows for the requested page.
 */
export function buildSettingsRows(
  snapshot: { settings: SettingsData | null; provider: string; model: string; reasoning: ReasoningView }
    & Partial<Pick<TuiSnapshot, 'permissionCatalog' | 'approval' | 'sandbox' | 'plan' | 'goal' | 'cwd' | 'sessionId'>>,
  page: SettingsPageId,
  locale: 'zh' | 'en',
): PanelRow[] {
  const data = snapshot.settings
  if (data === null) return [{ key: 'loading', text: locale === 'en' ? 'Loading settings…' : '正在加载设置…', dim: true }]
  switch (page) {
    case 'general':
      return ([
        {
          key: 'busyEnter',
          text: locale === 'en'
            ? `Send while running · now ${data.general.busyEnter === 'steer' ? 'steer' : 'queue'}`
            : `运行时发送行为 · 当前 ${data.general.busyEnter === 'steer' ? 'Steer 转向' : 'Queue 排队'}`,
          action: 'toggle-busy-enter',
        },
        {
          key: 'thinking',
          text: locale === 'en'
            ? `Thinking default display · now ${data.general.thinking === 'expanded' ? 'expanded' : 'collapsed'}`
            : `思考过程默认显示 · 当前 ${data.general.thinking === 'expanded' ? '展开' : '折叠'}`,
          action: 'toggle-thinking',
        },
        {
          key: 'locale',
          text: locale === 'en'
            ? `Interface language · now ${data.general.locale === 'en' ? 'English' : '中文'}`
            : `界面语言 · 当前 ${data.general.locale === 'en' ? 'English' : '中文'}`,
          action: 'toggle-locale',
        },
        { key: 'keymap', text: locale === 'en' ? `Keyboard mode · ${data.general.keymap ?? 'legacy-dsh'} · Enter changes` : `键位模式 · ${data.general.keymap ?? 'legacy-dsh'} · Enter 切换`, action: 'cycle-keymap' },
        { key: 'taskNotifications', text: locale === 'en' ? `Task notifications · ${data.general.taskNotifications ?? 'off'}` : `任务完成通知 · ${data.general.taskNotifications === 'always' ? '开启' : '关闭'}`, action: 'toggle-notifications' },
        { key: 'g-foot', text: locale === 'en' ? 'Changes persist in the profile settings layer (tui namespace) and apply immediately' : '变更写入 profile 设置层（tui 命名空间）并立即生效', dim: true },
      ] satisfies PanelRow[]).map(row => {
        if (row.action === undefined) return row
        const [label = '', ...values] = row.text.split(' · ')
        return { ...row, columns: { label, value: values.join(' · ') } }
      })
    case 'appearance':
      return [
        ...APPEARANCES.map(id => ({
          key: `appearance-${id}`,
          text: `${currentAppearance(data.general.appearance) === id ? '●' : '○'} ${id}`,
          action: 'set-appearance' as const,
          meta: { id },
        })),
        { key: 'appearance-source', text: locale === 'en' ? 'Source: profile settings · tui.appearance · applies immediately' : '来源：profile 设置 · tui.appearance · 立即生效', dim: true },
        { key: 'appearance-font', text: locale === 'en' ? 'Font, size and line spacing belong to your terminal application.' : '字体、字号与行距由终端应用设置。', dim: true },
      ]
    case 'permissions': {
      const namespaces = data.inventory.namespaces.filter(item => /permission|sandbox|plan-mode/.test(item.ns))
      const approval = snapshot.approval
      return [
        { key: 'perm-sandbox', dim: true, text: `Sandbox · ${snapshot.sandbox ?? (locale === 'en' ? 'unavailable' : '不可用')}` },
        { key: 'perm-plan', dim: true, text: `Plan · ${snapshot.plan === undefined ? (locale === 'en' ? 'unavailable' : '不可用') : snapshot.plan.pending ? (locale === 'en' ? 'pending host confirmation' : '等待宿主确认') : snapshot.plan.active ? 'on' : 'off'}` },
        { key: 'perm-preset', dim: true, text: `Agent preset · ${data.currentPreset ?? (locale === 'en' ? 'unavailable' : '不可用')}` },
        { key: 'permission-presets-heading', text: locale === 'en' ? 'Host permission presets (sandbox + approval)' : '宿主权限组合（沙箱 + 审批）', dim: true },
        ...(snapshot.permissionCatalog?.options ?? []).map(option => ({ key: `permission-preset-${option.value}`,
          text: `${snapshot.permissionCatalog?.current === option.value ? '●' : '○'} ${option.name}${option.value === 'auto' ? ' · EXP · model review / no file sandbox' : ''}`,
          action: 'select-permission-preset' as const, meta: { id: option.value } })),
        ...((snapshot.permissionCatalog?.options ?? []).some(option => option.value === 'auto') ? [] : [{ key: 'auto-unavailable', text: locale === 'en' ? 'Auto review unavailable: enable the official experimental plugin first' : 'Auto review 不可用：需先启用官方实验插件', dim: true }]),
        { key: 'permission-default-heading', text: locale === 'zh' ? '新会话默认权限（不改变当前或旧会话）' : 'New-session default (current and saved sessions unchanged)', dim: true },
        ...(snapshot.permissionCatalog?.defaultOptions ?? []).map(option => ({ key: `permission-default-${option.value}`, text: `${snapshot.permissionCatalog?.defaultPreset === option.value ? '●' : '○'} ${option.name}`,
          ...(snapshot.permissionCatalog?.defaultWritable ? { action: 'set-permission-default' as const, meta: { id: option.value } } : { dim: true }) })),
        { key: 'approval-heading', text: locale === 'en' ? 'Approval requests' : '审批请求', dim: true },
        ...(['ask', 'never'] as const).map(policy => ({
          key: `approval-${policy}`,
          text: `${approval?.policy === policy ? '●' : '○'} ${policy === 'ask' ? (locale === 'en' ? 'Ask when required' : '需要时询问') : (locale === 'en' ? 'Never prompt — reject requests' : '不询问，自动拒绝审批请求')}`,
          ...(approval === undefined ? { dim: true } : { action: 'set-approval-policy' as const, meta: { id: policy } }),
        })),
        { key: 'approval-source', text: approval === undefined
          ? (locale === 'en' ? 'Approval service unavailable' : '审批服务不可用')
          : (locale === 'en' ? `Source: ${approval.source} · current session; survives resume` : `来源：${approval.source === 'session' ? '会话覆盖' : 'profile 默认'} · 当前会话生效，恢复后保留`), dim: true },
        { key: 'approval-help', text: locale === 'en' ? 'Allowed operations continue automatically. Never rejects operations needing approval; it does not grant access or change sandbox/Plan.' : '已有权限的操作继续自动执行；never 会拒绝需要审批的操作，不会授予权限或改变沙箱、Plan。', dim: true },
        ...readOnlyNamespaces(data, namespaces.map(item => item.ns), locale, 'permission'),
        { key: 'perm-source', text: locale === 'en' ? 'Source: resolved sandbox policy, committed plan events and public settings descriptors.' : '来源：已解析沙箱策略、已提交 Plan 事件及公开设置描述。', dim: true },
        { key: 'perm-foot', text: locale === 'en' ? 'Preset, permission, sandbox and Plan are separate. No policy is changed by opening this page.' : '预设、权限、沙箱与 Plan 相互独立；打开此页不会变更策略。', dim: true },
      ]
    }
    case 'mcp': {
      const plugins = data.plugins.filter(item => /(?:^|[-/@])mcp(?:$|[-/])/.test(`${item.id}/${item.name}`))
      const namespaces = data.inventory.namespaces.filter(item => /(?:^|[-/@])mcp(?:$|[-/])/.test(item.ns))
      return [
        ...plugins.map(plugin => ({ key: `mcp-plugin-${plugin.id}`, text: `${plugin.id} · ${plugin.name} · ${plugin.enabled ? 'enabled' : 'disabled'} · ${plugin.loaded ? 'loaded' : 'not loaded'}`, dim: !plugin.toggleable || plugin.name !== '@deepseek-ai/dsh-mcp-client', ...(plugin.toggleable && plugin.name === '@deepseek-ai/dsh-mcp-client' ? { action: 'manage-mcp' as const, meta: { id: plugin.id, enabled: plugin.enabled } } : {}) })),
        ...plugins.filter(plugin => plugin.name === '@deepseek-ai/dsh-mcp-client' && plugin.enabled && plugin.toggleable).map(plugin => ({ key: `mcp-reconnect-${plugin.id}`, text: `  ${locale === 'en' ? 'Reconnect' : '重新连接'} ${plugin.id}`, action: 'manage-mcp' as const, meta: { id: plugin.id, name: 'reconnect' } })),
        ...(data.mcp ?? []).map(server => ({ key: `mcp-tools-${server.id}`, text: `  ${server.server} · ${server.transport} · ${server.toolCount} visible tools${server.tools.length ? ': ' + server.tools.join(', ') : ''}`, dim: true })),
        { key: 'mcp-management', text: '/mcp add /absolute/server.json · update <entry-id> /absolute/server.json · enable|disable|reconnect|remove <entry-id>', dim: true },
        { key: 'mcp-auth', text: locale === 'en' ? 'HTTP headers / stdio env: configure in local JSON. OAuth login is not exposed by Harness rc.2.' : 'HTTP headers / stdio env：在本地 JSON 配置；Harness rc.2 未公开 OAuth 登录接口。', dim: true },
        ...(plugins.length === 0 ? [{ key: 'mcp-empty', text: locale === 'en' ? 'No MCP plugin entries exposed by the current profile.' : '当前 profile 未提供 MCP 插件条目。', dim: true }] : []),
        ...readOnlyNamespaces(data, namespaces.map(item => item.ns), locale, 'mcp'),
        { key: 'mcp-connections', text: locale === 'en' ? 'Server connections and tool discovery: unavailable in this snapshot; loaded plugin does not prove a connected server.' : '服务器连接与工具发现：当前快照不可用；插件已加载不代表服务器已连接。', dim: true },
        { key: 'mcp-source', text: locale === 'en' ? 'Source: official loader inventory and public settings descriptors. Manage enablement on Plugins.' : '来源：官方 Loader 清单与公开设置描述；在 Plugins 页管理启停。', dim: true },
      ]
    }
    case 'diagnostics': {
      const unknown = locale === 'en' ? 'unavailable' : '不可用'
      return [
        { key: 'diag-session', text: `Session · ${snapshot.sessionId ?? unknown}` },
        { key: 'diag-cwd', text: `Workspace · ${snapshot.cwd ?? unknown}` },
        { key: 'diag-model', text: `Model · ${snapshot.provider}/${snapshot.model}` },
        { key: 'diag-effort', text: `Reasoning effort · ${snapshot.reasoning.effort ?? (locale === 'en' ? 'not selected' : '未选择')}` },
        { key: 'diag-ptc', text: `PTC · ${data.ptc === undefined ? unknown : data.ptc.available ? 'available' : 'unavailable'} · ${data.ptc?.executionMode ?? unknown}` },
        { key: 'diag-goal', text: `Goal · ${snapshot.goal === undefined ? unknown : snapshot.goal === null ? (locale === 'en' ? 'none' : '无') : `${snapshot.goal.phase} · ${snapshot.goal.roundsStarted}/${snapshot.goal.maxGoalRounds}`}` },
        ...buildSettingsRows(snapshot, 'inventory', locale).map(row => ({ ...row, key: `diag-${row.key}` })),
      ]
    }
    case 'models': {
      const rows: PanelRow[] = []
      const defaultProvider = snapshot.provider
      if (data.models.credentials.some(credential => !credential.configured)) rows.push({
        key: 'm-credentials-needed', text: locale === 'en' ? 'Configure API credentials in /settings models to discover available models.' : '请在 /settings models 配置 API 凭据，随后刷新可用模型。', dim: true,
      })
      if (!data.models.providers.some(provider => provider.provider === snapshot.provider && provider.models.some(model => model.id === snapshot.model))) {
        rows.push({ key: 'm-current-unavailable', text: locale === 'en'
          ? `Current: ${snapshot.provider}/${snapshot.model} · unavailable in refreshed catalog`
          : `当前：${snapshot.provider}/${snapshot.model} · 刷新后的目录中不可用`, color: 'yellow' })
      }
      for (const provider of data.models.providers) {
        rows.push({ key: `p-${provider.provider}`, text: provider.provider, color: 'cyan' })
        for (const model of provider.models) {
          const isDefault = provider.provider === snapshot.provider && model.id === snapshot.model
          rows.push({
            key: `m-${provider.provider}-${model.id}`,
            text: `${isDefault ? '●' : '○'} ${model.id}${model.acceptsImage === true ? (locale === 'en' ? ' · image' : ' · 图') : ''}${isDefault ? (locale === 'en' ? ' · default' : ' · 默认') : ''}`,
            columns: { label: `${isDefault ? '●' : '○'} ${model.id}`, value: `${provider.provider}${model.acceptsImage === true ? (locale === 'en' ? ' · image input' : ' · 图片输入') : ''}${isDefault ? (locale === 'en' ? ' · current model' : ' · 当前模型') : ''}` },
            action: 'select-model',
            meta: { provider: provider.provider, model: model.id },
          })
        }
      }
      // Reasoning-effort rows for the default route, when the adapter exposes
      // selectable levels (the Web model selector's effort control).
      if (defaultProvider !== undefined && snapshot.reasoning.levels.length > 0) {
        rows.push({ key: 'r-head', text: locale === 'en' ? 'Reasoning effort · Enter sets it for the default model' : '推理等级 reasoningEffort · Enter 设为当前默认模型', color: 'cyan' })
        for (const level of snapshot.reasoning.levels) {
          const selected = snapshot.reasoning.effort === level
          rows.push({
            key: `r-${level}`,
            text: `${selected ? '●' : '○'} ${level}${selected ? (locale === 'en' ? ' · current' : ' · 当前') : ''}`,
            action: 'select-reasoning-effort',
            meta: { provider: defaultProvider, model: snapshot.model, effort: level },
          })
        }
      }
      rows.push({ key: 'm-creds', text: locale === 'en' ? 'API credentials · value-free: shows config state only, input not echoed' : 'API 凭据 · value-free：只显配置状态，输入不回显', color: 'cyan' })
      for (const credential of data.models.credentials) {
        rows.push({
          key: `c-${credential.ref}`,
          text: `🔑 ${credential.ref} · ${credentialState(credential.configured, credential.source, credential.writable, locale)}`,
          ...(credential.writable ? { action: 'edit-credential' as const } : {}),
          meta: { ref: credential.ref },
        })
      }
      rows.push({ key: 'm-foot', text: locale === 'en' ? 'Credentials write to $DSH_HOME/.credentials.yaml; process env unchanged' : '凭据写入 $DSH_HOME/.credentials.yaml，进程环境不变', dim: true })
      return rows
    }
    case 'plugins': {
      const rows: PanelRow[] = data.bundles === undefined ? [] : [{ key: 'bundle-install', text: locale === 'en' ? 'Install third-party bundle…' : '安装第三方插件包…', action: 'install-plugin' }]
      if (data.plugins.length === 0) {
        rows.push({ key: 'pl-empty', text: locale === 'en' ? '(no plugin entries)' : '（当前没有插件条目）', dim: true })
      }
      for (const plugin of data.plugins) {
        const fixed = plugin.toggleBlockedReason === 'conditional'
          ? (locale === 'en' ? ' · conditional' : ' · 条件控制')
          : plugin.toggleBlockedReason === 'dependency'
            ? (locale === 'en' ? ' · active dependents' : ' · 存在活跃依赖方')
            : plugin.toggleBlockedReason === 'managed'
              ? (locale === 'en' ? ' · profile managed' : ' · profile 管理')
              : plugin.toggleBlockedReason === 'surface'
                ? (locale === 'en' ? ' · current surface' : ' · 当前界面')
                : plugin.toggleBlockedReason === 'unavailable'
                  ? (locale === 'en' ? ' · read-only launch' : ' · 当前启动只读')
                  : ''
        rows.push({
          key: `pl-${plugin.id}`,
          text: `${plugin.enabled ? '●' : '○'} ${plugin.id} · ${plugin.name}${plugin.loaded ? (locale === 'en' ? ' · active' : ' · 已激活') : (locale === 'en' ? ' · not loaded' : ' · 未加载')}${plugin.enabled ? '' : (locale === 'en' ? ' · disabled' : ' · 已禁用')}${fixed}`,
          // Capability comes from the adapter; the host still rechecks on activation.
          ...(plugin.toggleable ? { action: 'toggle-plugin' as const } : { dim: true }),
          meta: { id: plugin.id, enabled: plugin.enabled },
        })
      }
      for (const bundle of data.bundles ?? []) {
        rows.push({ key: `bundle-${bundle.name}`, text: locale === 'en'
          ? `Bundle ${bundle.name}${bundle.version ? `@${bundle.version}` : ''} · ${bundle.installed ? 'profile-installed' : 'not profile-installed'} · ${bundle.enabled ? 'selected' : 'not selected'} · files: ${bundle.availability}`
          : `插件包 ${bundle.name}${bundle.version ? `@${bundle.version}` : ''} · ${bundle.installed ? 'profile 已安装' : 'profile 未安装'} · ${bundle.enabled ? '已选择' : '未选择'} · 文件：${bundle.availability}`, dim: true })
      }
      for (const bundle of data.bundles ?? []) {
        const blocked = bundleUpdateBlockedReason(bundle)
        if (!blocked) rows.push({ key: `bundle-select-${bundle.name}`, text: `${bundle.enabled ? '●' : '○'} ${locale === 'zh' ? '启用插件包' : 'Enable bundle'} ${bundle.name}`, action: 'toggle-bundle', meta: { name: bundle.name, enabled: bundle.enabled } })
        rows.push({ key: `bundle-update-${bundle.name}`, text: locale === 'en'
          ? `${bundle.name} · ${blocked ? `version change unavailable: ${blocked}` : 'Install exact version…'}`
          : `${bundle.name} · ${blocked ? `不可变更版本：${blocked}` : '安装指定精确版本…'}`,
          ...(blocked ? { dim: true } : { action: 'update-plugin' as const, meta: { name: bundle.name, ...(bundle.version ? { version: bundle.version } : {}) } }),
        })
      }
      for (const bundle of data.bundles ?? []) {
        if (bundle.removable && !bundleUpdateBlockedReason(bundle)) rows.push({ key: `bundle-remove-${bundle.name}`, text: `${locale === 'zh' ? '移除插件包' : 'Remove bundle'} ${bundle.name}…`, action: 'remove-bundle', meta: { name: bundle.name } })
      }
      for (const update of data.pluginUpdates ?? []) {
        const phase = locale === 'en' ? update.phase : ({ installing: '正在安装', applied: '已应用', 'pending-restart': '待重启', overridden: '被覆盖', failed: '失败', cancelled: '已取消' } as const)[update.phase]
        rows.push({ key: `bundle-result-${update.name}`, text: locale === 'en'
          ? `${update.name} · ${phase} · installed: ${update.installedVersion ?? 'unknown'} · last applied: ${update.loadedVersion ?? 'unknown'}${update.restartReason ? ` · ${update.restartReason}` : ''}`
          : `${update.name} · ${phase} · 已安装：${update.installedVersion ?? '未知'} · 最近确认应用：${update.loadedVersion ?? '未知'}${update.restartReason ? ` · ${update.restartReason}` : ''}`,
          color: update.phase === 'failed' ? 'red' : update.phase === 'pending-restart' ? 'yellow' : 'cyan' })
        if (update.error) rows.push({ key: `bundle-error-${update.name}`, text: update.error === 'already-installed'
          ? (locale === 'en' ? 'Host HMR refuses replacing an installed package. Stop this profile and use the official dsh plugin CLI; current version remains installed.' : '宿主 HMR 拒绝替换已安装包。请先停止此 profile，再用官方 dsh plugin CLI 更新；当前安装版本保留。')
          : update.error, color: 'red' })
        if (update.rollbackSpec) rows.push({ key: `bundle-rollback-${update.name}`, text: locale === 'en'
          ? `Rollback target: ${update.rollbackSpec} · ${update.rollback}; requires a separate explicit version change`
          : `回退目标：${update.rollbackSpec} · ${update.rollback}；需要另一次显式版本变更`, dim: true })
      }
      rows.push({
        key: 'pl-foot',
        text: locale === 'en'
          ? 'Enter toggles eligible root-profile rows; blocked rows are read-only'
          : 'Enter 启停可改的根 profile 条目；受限条目只读并显示原因',
        dim: true,
      })
      rows.push({
        key: 'pl-agent',
        text: locale === 'en'
          ? 'Preset/conditional rows and the running TUI stay fixed; failed activation rolls back its owned write'
          : 'preset 管理项、条件控制项与当前 TUI 保持固定；热应用失败会回滚本次独占写入',
        dim: true,
      })
      return rows
    }
    case 'inventory': {
      const rows: PanelRow[] = []
      rows.push({ key: 'i-ns', text: locale === 'en' ? `${data.inventory.namespaces.length} settings namespaces` : `设置命名空间 ${data.inventory.namespaces.length} 个`, color: 'yellow' })
      for (const namespace of data.inventory.namespaces) {
        rows.push({
          key: `ns-${namespace.ns}`,
          text: locale === 'en'
            ? `${namespace.ns} · ${namespace.applies === 'live' ? 'live' : 'restart'} · rev ${namespace.revision} · secret slots ${namespace.secretSet}/${namespace.secretSlots}`
            : `${namespace.ns} · ${namespace.applies === 'live' ? '即时生效' : '重启生效'} · rev ${namespace.revision} · 密钥槽 ${namespace.secretSet}/${namespace.secretSlots}`,
        })
      }
      rows.push({ key: 'i-creds', text: locale === 'en' ? `${data.inventory.credentials.length} credential refs` : `凭据引用 ${data.inventory.credentials.length} 个`, color: 'yellow' })
      for (const credential of data.inventory.credentials) {
        rows.push({
          key: `ic-${credential.ref}`,
          text: `${credential.ref} · ${credentialState(credential.configured, credential.source, credential.writable, locale)}`,
        })
      }
      rows.push({ key: 'i-inspect', text: locale === 'en' ? `cordisInspect providers · ${data.inventory.inspectProviders}` : `cordisInspect providers · ${data.inventory.inspectProviders} 个` })
      rows.push({ key: 'i-foot', text: locale === 'en' ? 'Projected from settings.describe + credentials.describe + the loader tree' : '由 settings.describe + credentials.describe + loader 树投影', dim: true })
      return rows
    }
    case 'presets': {
      const rows: PanelRow[] = []
      const mode = data.ptc?.executionMode
      rows.push({ key: 'ptc-runtime', text: locale === 'en'
        ? `PTC runtime · ${data.ptc === undefined ? 'unknown' : data.ptc.available ? 'available' : 'unavailable'} · execution mode: ${mode ?? 'unknown'}`
        : `PTC 运行时 · ${data.ptc === undefined ? '未知' : data.ptc.available ? '可用' : '不可用'} · 执行模式：${mode ?? '未知'}`, dim: true })
      if (mode !== undefined) rows.push({ key: 'ptc-memory', text: locale === 'en'
        ? mode === 'persistent-in-memory' ? 'PTC memory belongs to its owner and is lost on restart, owner release, cancellation, timeout or sandbox change; session resume does not restore it' : 'PTC starts a fresh process for each call; variables do not persist between calls'
        : mode === 'persistent-in-memory' ? 'PTC 内存归所属 owner 持有；重启、owner 释放、取消、超时或沙箱变更后丢失，会话恢复不会恢复该内存' : 'PTC 每次调用启动新进程；调用之间不保留变量', dim: true })
      if (data.presets.length === 0) {
        rows.push({ key: 'p-empty', text: locale === 'en' ? '(no agent presets composed — the agent-preset-registry service is not mounted in this profile)' : '（没有可用的 agent 预设——当前 profile 未挂载 agent-preset-registry 服务）', dim: true })
        return rows
      }
      for (const preset of data.presets) {
        const current = preset.id === data.currentPreset
        rows.push({
          key: `p-${preset.id}`,
          text: `${current ? '●' : '○'} ${preset.id} · ${preset.name}${preset.id === data.general.preferredPreset ? (locale === 'en' ? ' · new-session default' : ' · 新会话默认') : ''}${current ? (locale === 'en' ? ' · current' : ' · 当前') : ''}${preset.trust === 'user' ? (locale === 'en' ? ' · user' : ' · 用户') : ''}${preset.broken !== undefined ? (locale === 'en' ? ` · broken: ${preset.broken}` : ` · 损坏：${preset.broken}`) : ''}`,
          ...(preset.broken !== undefined ? { dim: true } : {}),
          ...((current && (!data.general.preferredPreset || data.general.preferredPreset === preset.id)) || preset.broken !== undefined ? {} : { action: 'select-preset' as const, meta: { id: preset.id } }),
        })
      }
      rows.push({ key: 'p-foot', text: locale === 'en' ? 'Blank idle sessions switch in place; started sessions save a new-session default. Use /new to apply; running turns cannot switch' : '空白闲置会话原地切换；已有对话只保存新会话默认，/new 后应用；运行中不可切换', dim: true })
      return rows
    }
  }
}

/** Render only already-redacted descriptor values; never imply a runtime connection. */
function readOnlyNamespaces(data: SettingsData, names: readonly string[], locale: 'zh' | 'en', prefix: string): PanelRow[] {
  const rows: PanelRow[] = []
  for (const name of names) {
    const descriptor = data.inventory.namespaces.find(item => item.ns === name)!
    rows.push({ key: `${prefix}-ns-${name}`, text: `${name} · ${descriptor.applies} · rev ${descriptor.revision}`, color: 'cyan' })
    for (const field of data.configs[name] ?? []) {
      rows.push({ key: `${prefix}-field-${name}-${field.key}`, text: `${field.key} · ${field.kind === 'secret' ? (locale === 'en' ? '[secret hidden]' : '【密钥隐藏】') : field.display}` })
    }
  }
  return rows
}

/**
 * One session-title observation result as returned by session-query
 * (`readTitleSnapshots`): a fulfilled value carries the folded title, and
 * every result names the session it folded. Declared structurally so this
 * zero-Cordis module stays decoupled from the query service.
 */
export interface TitleObservationResult {
  sessionId: string
  status: 'fulfilled' | 'rejected'
  value?: { title?: { title?: string } }
}

/**
 * Key session-title observations by session id. The query returns one result
 * per requested id in input order, but the caller then filters a SUBSET of
 * the requested sessions (live ids are dropped from the corpus rows), so
 * index-aligned lookups shift by one for every row after a live session —
 * each row showed the NEXT record's title and Enter resumed the session one
 * below the row the user picked. Id-keyed lookups are immune to filtering.
 * @param results - the title observations to index.
 * @returns fulfilled non-empty titles keyed by session id.
 */
export function sessionTitlesById(results: readonly TitleObservationResult[]): Map<string, string> {
  const titles = new Map<string, string>()
  for (const result of results) {
    if (result.status !== 'fulfilled') continue
    const title = result.value?.title?.title
    if (title !== undefined && title !== '') titles.set(result.sessionId, title)
  }
  return titles
}

/**
 * One job row; elapsedMs is live for running jobs, final duration otherwise.
 * @param jobs - the job rows to project.
 * @param locale - the surface language; `en` renders English copy, `zh` Chinese.
 * @returns one panel row per job, plus the panel header.
 */
export function buildJobsRows(jobs: readonly JobRow[], locale: 'zh' | 'en'): PanelRow[] {
  const rows: PanelRow[] = [{ key: 'jobs-head', text: locale === 'en' ? 'Background jobs · Enter views details' : '后台任务 Jobs · Enter 查看详情', color: 'cyan' }]
  if (jobs.length === 0) {
    rows.push({ key: 'jobs-empty', text: locale === 'en' ? '(no background jobs)' : '（无后台任务）', dim: true })
    return rows
  }
  for (const job of jobs) {
    const seconds = Math.max(0, Math.round(job.elapsedMs / 1000))
    const live = job.status === 'running' || job.status === 'stopping'
    rows.push({
      key: `job-${job.id}`,
      text: `${live ? '●' : '○'} ${job.id} · ${job.kind} · ${job.label} · ${job.status} · ${seconds}s${job.detail !== undefined ? ` · ${job.detail}` : ''}`,
      action: 'inspect-job', meta: { id: job.id },
    })
  }
  return rows
}

/** Job details are a projection, never a new execution-state owner. */
export function buildJobDetailRows(job: JobRow | undefined, locale: 'zh' | 'en', confirm = false): PanelRow[] {
  if (job === undefined) return [{ key: 'job-missing', text: locale === 'en' ? 'Job no longer available · Esc returns to list' : '任务已不可用 · Esc 返回列表', dim: true }]
  const rows: PanelRow[] = [
    { key: 'job-detail-title', text: `${job.id} · ${job.kind} · ${job.label}`, color: 'cyan' },
    { key: 'job-detail-state', text: `${locale === 'en' ? 'Host status' : '宿主状态'}: ${job.status} · ${Math.max(0, Math.round(job.elapsedMs / 1000))}s` },
    ...(job.detail ? [{ key: 'job-detail-output', text: job.detail }] : []),
  ]
  // A repeated stop request is never offered while the host is already stopping.
  if (job.status === 'running') rows.push({
    key: confirm ? 'job-confirm-stop' : 'job-request-stop',
    text: confirm
      ? (locale === 'en' ? 'Confirm stop this job · Enter requests cancellation' : '确认停止此任务 · Enter 请求取消')
      : (locale === 'en' ? 'Stop this job…' : '停止此任务…'),
    action: confirm ? 'kill-job' : 'request-job-stop', meta: { id: job.id }, color: 'yellow',
  })
  rows.push({ key: 'job-detail-back', text: locale === 'en' ? 'Esc returns to jobs · status comes from Harness' : 'Esc 返回任务列表 · 状态来自 Harness', dim: true })
  return rows
}

/**
 * One session row: live agents and persisted corpus sessions, optionally filtered.
 * @param sessions - the session rows to project.
 * @param filter - optional case-insensitive substring filter.
 * @param locale - the surface language; `en` renders English copy, `zh` Chinese.
 * @returns the matching session rows with the panel header.
 */
export function buildSessionRows(sessions: readonly SessionEntry[], filter: string | undefined, locale: 'zh' | 'en'): PanelRow[] {
  const query = filter?.trim().toLowerCase() ?? ''
  const matching = sessions.filter(entry =>
    query === ''
    || entry.id.toLowerCase().includes(query)
    || displayTextMatches(entry.model, query)
    || displayTextMatches(entry.title ?? '', query))
  const rows: PanelRow[] = [{
    key: 'sess-head',
    text: locale === 'en'
      ? `Live / persisted sessions · ${matching.length}${query === '' ? '' : ` · filter "${filter?.trim() ?? ''}"`} · Enter resumes a persisted session`
      : `活动会话 / 持久化会话 · ${matching.length} 条${query === '' ? '' : ` · 过滤 "${filter?.trim() ?? ''}"`} · Enter 恢复持久化会话`,
    color: 'cyan',
  }]
  if (matching.length === 0) {
    rows.push({ key: 'sess-empty', text: locale === 'en' ? '(no matching sessions)' : '（没有匹配的会话）', dim: true })
    return rows
  }
  for (const entry of matching) {
    const live = entry.live === true || (entry.live === undefined && entry.status !== 'persisted')
    const created = entry.createdAt === undefined ? '' : ` · ${new Date(entry.createdAt).toLocaleString()}`
    // The first-prompt summary title LEADS the row (the Web sidebar style);
    // the raw id trails it for stable reference/filtering.
    const hasTitle = entry.title !== undefined && entry.title !== ''
    const head = hasTitle ? `${entry.title} · ${entry.id.slice(0, 12)}` : entry.id.slice(0, 12)
    rows.push({
      key: `sess-${entry.id}`,
      text: `${live ? '●' : '○'} ${head} · ${entry.model === '' ? '—' : entry.model}${live ? (entry.resident ? ` · ${locale === 'en' ? 'background' : '后台'} · ${entry.status}` : ' · live') : ` · ${locale === 'en' ? 'persisted' : '持久化'}${created}`}`,
      ...(live && !entry.resident ? {} : { action: 'resume-session' as const, meta: { id: entry.id } }),
    })
  }
  return rows
}

/**
 * One subagent tree entry, indented by depth (root's children start at 1).
 * @param subagents - the subagent rows to project.
 * @param locale - the surface language; `en` renders English copy, `zh` Chinese.
 * @returns the indented subagent rows with the panel header.
 */
export function buildSubagentRows(subagents: readonly SubagentRow[], locale: 'zh' | 'en'): PanelRow[] {
  const rows: PanelRow[] = [{ key: 'sub-head', text: locale === 'en' ? 'Subagents · read-only tree' : '子代理 Subagents · 只读树', color: 'cyan' }]
  if (subagents.length === 0) {
    rows.push({ key: 'sub-empty', text: locale === 'en' ? '(this session has no subagents)' : '（当前会话没有子代理）', dim: true })
    return rows
  }
  for (const subagent of subagents) {
    const indent = '  '.repeat(Math.max(0, subagent.depth - 1))
    const activity = subagent.activity === 'running'
      ? (locale === 'en' ? '● running' : '● 运行中')
      : subagent.activity === 'inactive'
        ? (locale === 'en' ? '○ persisted' : '○ 持久化')
        : '⚠'
    const mode = subagent.mode === 'one-shot' ? 'one-shot' : subagent.mode === 'continuable' ? 'continuable' : subagent.mode === 'external' ? 'external' : (locale === 'en' ? 'unparseable' : '无法解析')
    rows.push({
      key: `sub-${subagent.id}`,
      text: `${indent}${activity} ${String(subagent.id).slice(0, 8)} · ${mode} · ${subagent.label}${subagent.mode === 'diagnostic' ? '' : locale === 'en' ? ` · preset: ${subagent.preset ?? 'unknown'}` : ` · 预设：${subagent.preset ?? '未知'}`}`,
      ...(subagent.activity === 'running' ? {} : { dim: true }),
    })
  }
  return rows
}

/**
 * One workflow run, newest event facts folded onto the row.
 * @param workflows - the workflow rows to project.
 * @param locale - the surface language; `en` renders English copy, `zh` Chinese.
 * @returns the workflow rows with the panel header.
 */
export function buildWorkflowRows(workflows: readonly WorkflowRow[], locale: 'zh' | 'en'): PanelRow[] {
  const rows: PanelRow[] = [{ key: 'wf-head', text: locale === 'en' ? 'Workflow runs · read-only progress' : 'Workflow 运行 · 只读进度', color: 'cyan' }]
  if (workflows.length === 0) {
    rows.push({ key: 'wf-empty', text: locale === 'en' ? '(no running or recently finished workflows)' : '（没有正在运行或最近结束的 workflow）', dim: true })
    return rows
  }
  rows.push({ key: 'wf-history', text: locale === 'en' ? 'Active runs and latest 256 finished runs · full history in session log' : '运行中与最近 256 个已结束任务 · 完整历史保存在会话日志', dim: true })
  for (const run of workflows) {
    const status = run.status === 'running'
      ? (locale === 'en' ? '● running' : '● 运行中')
      : run.status === 'completed' ? (locale === 'en' ? '○ completed' : '○ 已完成') : run.status === 'cancelled' ? (locale === 'en' ? '○ cancelled' : '○ 已取消') : (locale === 'en' ? '× failed' : '× 失败')
    const phase = run.phase !== undefined ? ` · ${locale === 'en' ? 'phase' : '阶段'} ${run.phase}` : ''
    const agents = run.agentsStarted > 0 ? (locale === 'en' ? ` · ${run.agentsStarted} agent()` : ` · ${run.agentsStarted} 个 agent()`) : ''
    const log = run.lastLog !== undefined ? ` · ${run.lastLog}` : ''
    const error = run.error !== undefined ? ` · ${locale === 'en' ? 'error' : '错误'} ${run.error}` : ''
    rows.push({
      key: `wf-${run.id}`,
      text: `${status} ${run.name}${phase}${agents}${log}${error}`,
      ...(run.status === 'running' ? {} : { dim: true }),
    })
  }
  return rows
}

/** Whether a value is a plain data object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Resolve one serialized schema node id through the refs table. */
function resolveRef(node: unknown, refs: Record<string, unknown>): unknown {
  return typeof node === 'number' ? refs[String(node)] : node
}

/**
 * Enumerate the TOP-LEVEL editable fields of one settings namespace schema.
 * Secret VALUES never cross this function: redacted descriptors carry the
 * marker, so the display shows set/not-set only. Nested containers surface as
 * read-only `other` rows.
 * @param schemaJson - the serialized schemastery schema from a settings descriptor.
 * @param value - the descriptor's resolved value.
 * @param locale - the surface language; `en` renders English copy, `zh` Chinese.
 * @returns the fields in schema order.
 */
export function collectPluginFields(schemaJson: unknown, value: unknown, locale: 'zh' | 'en' = 'zh'): PluginConfigField[] {
  if (!isRecord(schemaJson)) return []
  const root = schemaJson as SerializedSchema
  if (typeof root.uid !== 'number' || !isRecord(root.refs)) return []
  const resolved = resolveRef(root.uid, root.refs)
  if (!isRecord(resolved) || resolved.type !== 'object' || !isRecord(resolved.dict)) return []
  const source = isRecord(value) ? value : {}
  const fields: PluginConfigField[] = []
  for (const [key, childUid] of Object.entries(resolved.dict)) {
    const child = resolveRef(childUid, root.refs)
    const kind = classifyField(child)
    const current = source[key]
    if (kind === 'boolean') {
      fields.push({ key, kind, display: current === true ? 'true' : 'false' })
    } else if (kind === 'secret') {
      fields.push({ key, kind, display: typeof current === 'string' && current !== '' ? (locale === 'en' ? '••• set' : '••• 已设置') : (locale === 'en' ? 'unset' : '未设置') })
    } else if (kind === 'number') {
      fields.push({ key, kind, display: typeof current === 'number' ? String(current) : String(current ?? '') })
    } else if (kind === 'string') {
      fields.push({ key, kind, display: typeof current === 'string' ? current : '' })
    } else {
      const text = JSON.stringify(current)
      fields.push({ key, kind: 'other', display: text === undefined ? '' : text.slice(0, 80) })
    }
  }
  return fields
}

/** Classify one resolved schema node into an editable field kind. */
function classifyField(node: unknown): PluginConfigField['kind'] {
  if (!isRecord(node)) return 'other'
  const meta = isRecord(node.meta) ? node.meta : {}
  if (meta.role === 'secret') return 'secret'
  switch (node.type) {
    case 'boolean': return 'boolean'
    case 'string': return 'string'
    case 'number':
    case 'int':
    case 'float':
      return 'number'
    default: return 'other'
  }
}

/**
 * Rows of one plugin-config editor panel.
 * @param fields - the editable fields to render.
 * @param ns - the settings namespace owning the fields.
 * @param locale - the surface language; `en` renders English copy, `zh` Chinese.
 * @returns the editor panel rows.
 */
export function buildPluginConfigRows(fields: readonly PluginConfigField[], ns: string, locale: 'zh' | 'en'): PanelRow[] {
  const rows: PanelRow[] = [{ key: 'pc-head', text: locale === 'en' ? 'Plugin config · Enter toggles/edits · writes $DSH_HOME/settings.yaml' : '插件配置 · Enter 切换/编辑 · 写入 $DSH_HOME/settings.yaml', color: 'cyan' }]
  if (fields.length === 0) {
    rows.push({ key: 'pc-empty', text: locale === 'en' ? '(this plugin has no editable top-level config)' : '（该插件没有可编辑的顶层配置）', dim: true })
    return rows
  }
  for (const field of fields) {
    if (field.kind === 'boolean') {
      rows.push({
        key: `pc-${field.key}`,
        text: `${field.display === 'true' ? '●' : '○'} ${field.key} = ${field.display} · ${locale === 'en' ? 'Enter toggles' : 'Enter 切换'}`,
        action: 'toggle-config-boolean',
        meta: { field: field.key, ns },
      })
    } else if (field.kind === 'other') {
      rows.push({ key: `pc-${field.key}`, text: locale === 'en' ? `${field.key} = ${field.display} (nested object, read-only)` : `${field.key} = ${field.display}（嵌套对象，只读）`, dim: true })
    } else {
      rows.push({
        key: `pc-${field.key}`,
        text: `${field.key} = ${field.display} · ${locale === 'en' ? 'Enter edits' : 'Enter 编辑'}`,
        action: field.kind === 'number' ? 'edit-config-number' : field.kind === 'secret' ? 'edit-config-secret' : 'edit-config-string',
        meta: { field: field.key, ns },
      })
    }
  }
  return rows
}

/** One declared credential reference found in a settings descriptor. */
export interface CredentialRefSlot {
  /** The reference name (e.g. `DEEPSEEK_API_KEY`). */
  ref: string
  /** Path from the namespace section root to the declaring field. */
  path: string[]
}

/**
 * The serialized schema root: `{ uid, refs }` where `refs` maps every node's
 * uid to a JSON round-trip of the live schema node (`{ type, meta, dict,
 * inner, … }`) and nested property values are uids resolved through `refs`.
 */
interface SerializedSchema {
  uid?: unknown
  refs?: unknown
}

function resolveNode(node: unknown, refs: Record<string, unknown>): unknown {
  return typeof node === 'number' ? refs[String(node)] : node
}

function walk(node: unknown, value: unknown, path: string[], refs: Record<string, unknown>, out: CredentialRefSlot[]): void {
  const resolved = resolveNode(node, refs)
  if (!isRecord(resolved)) return
  const meta = isRecord(resolved.meta) ? resolved.meta : {}
  if (meta.role === 'credential-ref') {
    out.push({ ref: typeof value === 'string' ? value : '', path: [...path] })
    return
  }
  switch (resolved.type) {
    case 'object': {
      const properties = isRecord(resolved.dict) ? resolved.dict : {}
      const source = isRecord(value) ? value : {}
      for (const [key, child] of Object.entries(properties)) {
        walk(child, source[key], [...path, key], refs, out)
      }
      return
    }
    case 'dict': {
      if (!isRecord(value)) return
      for (const [key, entry] of Object.entries(value)) {
        walk(resolved.inner, entry, [...path, key], refs, out)
      }
      return
    }
    case 'array': {
      if (!Array.isArray(value)) return
      value.forEach((entry, index) => walk(resolved.inner, entry, [...path, String(index)], refs, out))
      return
    }
    default:
      return
  }
}

/**
 * Enumerate every `role('credential-ref')` field declared by one namespace
 * schema and read its reference name from the descriptor value. Secret VALUES
 * never cross this function: the slot carries the reference name only, which
 * the caller passes to `ctx.credentials.describe`.
 * @param schemaJson - the serialized schemastery schema from a settings descriptor.
 * @param value - the descriptor's resolved value.
 * @returns the declared reference slots, in schema order.
 */
export function collectCredentialRefs(schemaJson: unknown, value: unknown): CredentialRefSlot[] {
  const out: CredentialRefSlot[] = []
  if (!isRecord(schemaJson)) return out
  const root = schemaJson as SerializedSchema
  if (typeof root.uid !== 'number' || !isRecord(root.refs)) return out
  walk(root.uid, value, [], root.refs, out)
  return out
}

/**
 * Group the flat model routes by provider, in first-seen order.
 * @param models - the routes (provider + model ids).
 * @returns one row per provider with its model ids.
 */
export function groupProviders(models: readonly { provider: string; model: string; acceptsImage?: boolean }[]): SettingsProviderRow[] {
  const rows: SettingsProviderRow[] = []
  const byProvider = new Map<string, { id: string; acceptsImage?: boolean }[]>()
  for (const entry of models) {
    const modelsOf = byProvider.get(entry.provider)
    const row = {
      id: entry.model,
      ...(entry.acceptsImage === true ? { acceptsImage: true as const } : {}),
    }
    if (modelsOf === undefined) byProvider.set(entry.provider, [row])
    else if (!modelsOf.some(model => model.id === entry.model)) modelsOf.push(row)
  }
  for (const [provider, ids] of byProvider) rows.push({ provider, models: ids })
  return rows
}
