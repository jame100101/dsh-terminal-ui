/**
 * Pure projections for the /settings five pages and the /jobs, /subagents,
 * and /workflows panels: walking serialized schemastery schema JSON for
 * `credential-ref` fields (value-free by construction — only the reference
 * name, never the secret), grouping the model routes by provider, and
 * formatting the live service rows. Zero Cordis imports: unit-testable.
 * @module @deepseek-ai/dsh-tui/src/settings-data
 */

import type { JobRow, PluginConfigField, SessionEntry, SettingsData, SettingsProviderRow, SubagentRow, WorkflowRow } from './store'

/** One /settings page id. */
export type SettingsPageId = 'general' | 'models' | 'plugins' | 'inventory' | 'presets'

export const SETTINGS_PAGES: readonly SettingsPageId[] = ['general', 'models', 'plugins', 'inventory', 'presets']

/** One displayed panel row, built by the pure projections in this module. */
export interface PanelRow {
  key: string
  text: string
  color?: string
  dim?: boolean
  /** Which renderer action Enter triggers; absent rows are inert. */
  action?: 'toggle-busy-enter' | 'toggle-thinking' | 'toggle-locale' | 'select-model' | 'select-reasoning-effort' | 'edit-credential' | 'kill-job' | 'resume-session' | 'toggle-config-boolean' | 'edit-config-number' | 'edit-config-secret' | 'edit-config-string' | 'select-preset'
  meta?: { provider?: string; model?: string; ref?: string; id?: string; effort?: string; ns?: string; field?: string; enabled?: boolean }
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
 * Project the /settings pages (general/models/plugins/inventory/presets).
 * @param snapshot - the settings snapshot plus the current model and reasoning view.
 * @param page - which page to project.
 * @param locale - the surface language; `en` renders English copy, `zh` Chinese.
 * @returns the panel rows for the requested page.
 */
export function buildSettingsRows(
  snapshot: { settings: SettingsData | null; model: string; reasoning: ReasoningView },
  page: SettingsPageId,
  locale: 'zh' | 'en',
): PanelRow[] {
  const data = snapshot.settings
  if (data === null) return [{ key: 'loading', text: locale === 'en' ? 'Loading settings…' : '正在加载设置…', dim: true }]
  switch (page) {
    case 'general':
      return [
        {
          key: 'busyEnter',
          text: locale === 'en'
            ? `busyEnter behavior while running · now ${data.general.busyEnter === 'steer' ? 'steer' : 'queue'}`
            : `busyEnter 运行中 Enter 的行为 · 当前 ${data.general.busyEnter === 'steer' ? 'Steer 转向' : 'Queue 排队'}`,
          action: 'toggle-busy-enter',
        },
        {
          key: 'thinking',
          text: locale === 'en'
            ? `thinking default display · now ${data.general.thinking === 'expanded' ? 'expanded' : 'collapsed'}`
            : `thinking 思考默认显示 · 当前 ${data.general.thinking === 'expanded' ? '展开' : '折叠'}`,
          action: 'toggle-thinking',
        },
        {
          key: 'locale',
          text: locale === 'en'
            ? `locale UI language · now ${data.general.locale === 'en' ? 'English' : '中文'}`
            : `locale 界面语言 · 当前 ${data.general.locale === 'en' ? 'English' : '中文'}`,
          action: 'toggle-locale',
        },
        { key: 'g-foot', text: locale === 'en' ? 'Changes write to $DSH_HOME/settings.yaml (tui namespace) and apply immediately' : '变更写入 $DSH_HOME/settings.yaml（tui 命名空间）并立即生效', dim: true },
      ]
    case 'models': {
      const rows: PanelRow[] = []
      const defaultProvider = data.models.providers.find(provider => provider.models.some(model => model.id === snapshot.model))?.provider
      for (const provider of data.models.providers) {
        rows.push({ key: `p-${provider.provider}`, text: provider.provider, color: 'cyan' })
        for (const model of provider.models) {
          const isDefault = model.id === snapshot.model
          rows.push({
            key: `m-${provider.provider}-${model.id}`,
            text: `${isDefault ? '●' : '○'} ${model.id}${isDefault ? (locale === 'en' ? ' · default' : ' · 默认') : ''}`,
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
          action: 'edit-credential',
          meta: { ref: credential.ref },
        })
      }
      rows.push({ key: 'm-foot', text: locale === 'en' ? 'Credentials write to $DSH_HOME/.credentials.yaml; process env unchanged' : '凭据写入 $DSH_HOME/.credentials.yaml，进程环境不变', dim: true })
      return rows
    }
    case 'plugins': {
      const rows: PanelRow[] = []
      if (data.plugins.length === 0) {
        rows.push({ key: 'pl-empty', text: locale === 'en' ? '(no plugin entries)' : '（当前没有插件条目）', dim: true })
      }
      for (const plugin of data.plugins) {
        rows.push({
          key: `pl-${plugin.id}`,
          text: `${plugin.enabled ? '●' : '○'} ${plugin.id} · ${plugin.name}${plugin.loaded ? '' : (locale === 'en' ? ' · not loaded' : ' · 未加载')}${plugin.enabled ? '' : (locale === 'en' ? ' · disabled' : ' · 已禁用')}`,
          ...(plugin.enabled ? {} : { dim: true }),
        })
      }
      rows.push({
        key: 'pl-foot',
        text: locale === 'en'
          ? 'To enable or disable plugins, edit $DSH_HOME/profiles/<profile>/cordis.patch.yml'
          : '启停插件请编辑 $DSH_HOME/profiles/<profile>/cordis.patch.yml',
        dim: true,
      })
      rows.push({
        key: 'pl-agent',
        text: locale === 'en'
          ? 'Tip: ask the Agent to update that configuration file for you'
          : '提示：也可以直接让 Agent 为你修改该配置文件',
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
      if (data.presets.length === 0) {
        rows.push({ key: 'p-empty', text: locale === 'en' ? '(no agent presets composed — the agent-presets service is not mounted in this profile)' : '（没有可用的 agent 预设——当前 profile 未挂载 agent-presets 服务）', dim: true })
        return rows
      }
      for (const preset of data.presets) {
        const current = preset.id === data.currentPreset
        rows.push({
          key: `p-${preset.id}`,
          text: `${current ? '●' : '○'} ${preset.id} · ${preset.name}${current ? (locale === 'en' ? ' · current' : ' · 当前') : ''}${preset.trust === 'user' ? (locale === 'en' ? ' · user' : ' · 用户') : ''}${preset.broken !== undefined ? (locale === 'en' ? ` · broken: ${preset.broken}` : ` · 损坏：${preset.broken}`) : ''}`,
          ...(preset.broken !== undefined ? { dim: true } : {}),
          ...(current || preset.broken !== undefined ? {} : { action: 'select-preset' as const, meta: { id: preset.id } }),
        })
      }
      rows.push({ key: 'p-foot', text: locale === 'en' ? 'A blank session switches in place; once the conversation starts its preset is fixed (switch after /new)' : '空白会话原地切换；会话开始后预设锁定（请 /new 后切换）', dim: true })
      return rows
    }
  }
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
  const rows: PanelRow[] = [{ key: 'jobs-head', text: locale === 'en' ? 'Background jobs · Enter kills the selected job' : '后台任务 Jobs · Enter 杀掉选中任务', color: 'cyan' }]
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
      ...(live ? { action: 'kill-job' as const, meta: { id: job.id } } : {}),
    })
  }
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
    || entry.model.toLowerCase().includes(query)
    || (entry.title ?? '').toLowerCase().includes(query))
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
      text: `${live ? '●' : '○'} ${head} · ${entry.model === '' ? '—' : entry.model}${live ? ' · live' : ` · ${locale === 'en' ? 'persisted' : '持久化'}${created}`}`,
      ...(live ? {} : { action: 'resume-session' as const, meta: { id: entry.id } }),
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
    const mode = subagent.mode === 'one-shot' ? 'one-shot' : subagent.mode === 'continuable' ? 'continuable' : (locale === 'en' ? 'unparseable' : '无法解析')
    rows.push({
      key: `sub-${subagent.id}`,
      text: `${indent}${activity} ${String(subagent.id).slice(0, 8)} · ${mode} · ${subagent.label}`,
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
      rows.push({ key: `pc-${field.key}`, text: locale === 'en' ? `▸ ${field.key} = ${field.display} (nested object, read-only)` : `▸ ${field.key} = ${field.display}（嵌套对象，只读）`, dim: true })
    } else {
      rows.push({
        key: `pc-${field.key}`,
        text: `▸ ${field.key} = ${field.display} · ${locale === 'en' ? 'Enter edits' : 'Enter 编辑'}`,
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
export function groupProviders(models: readonly { provider: string; model: string }[]): SettingsProviderRow[] {
  const rows: SettingsProviderRow[] = []
  const byProvider = new Map<string, string[]>()
  for (const entry of models) {
    const modelsOf = byProvider.get(entry.provider)
    if (modelsOf === undefined) byProvider.set(entry.provider, [entry.model])
    else if (!modelsOf.includes(entry.model)) modelsOf.push(entry.model)
  }
  for (const [provider, ids] of byProvider) rows.push({ provider, models: ids.map(id => ({ id })) })
  return rows
}
