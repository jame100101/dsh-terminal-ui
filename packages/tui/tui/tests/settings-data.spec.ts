import { describe, expect, it } from 'vitest'
import {
  buildJobDetailRows, buildJobsRows, buildPluginConfigRows, buildSessionRows, buildSettingsRows, buildSubagentRows, buildWorkflowRows,
  collectCredentialRefs, collectPluginFields, groupProviders, sessionTitlesById, SETTINGS_PAGES,
} from '../src/settings-data'
import type { SettingsData } from '../src/store'

/** A minimal /settings models fixture with one provider and two models. */
function modelsSettings(): {
  settings: SettingsData
  provider: string
  model: string
  reasoning: { effort: string | undefined; levels: readonly string[] }
} {
  return {
    settings: {
      general: { busyEnter: 'queue', thinking: 'collapsed', theme: 'dark', locale: 'zh' },
      models: {
        providers: [{ provider: 'deepseek-official', models: [{ id: 'deepseek-v4-pro' }, { id: 'deepseek-v4-flash' }] }],
        credentials: [],
      },
      plugins: [],
      configs: {},
      inventory: { namespaces: [], credentials: [], inspectProviders: 0 },
      presets: [],
      currentPreset: undefined,
    },
    provider: 'deepseek-official',
    model: 'deepseek-v4-pro',
    reasoning: { effort: undefined, levels: [] },
  }
}

describe('collectPluginFields', () => {
  const schema = {
    uid: 1,
    refs: {
      '1': { type: 'object', dict: { maxParallelToolCalls: 2, verbose: 3, apiKey: 4, nested: 5 } },
      '2': { type: 'number' },
      '3': { type: 'boolean' },
      '4': { type: 'string', meta: { role: 'secret' } },
      '5': { type: 'object', dict: { a: 2 } },
    },
  }

  it('classifies top-level fields by their resolved schema kinds', () => {
    const fields = collectPluginFields(schema, { maxParallelToolCalls: 8, verbose: true, apiKey: '[redacted]', nested: { a: 1 } })
    expect(fields).toEqual([
      { key: 'maxParallelToolCalls', kind: 'number', display: '8' },
      { key: 'verbose', kind: 'boolean', display: 'true' },
      { key: 'apiKey', kind: 'secret', display: '••• 已设置' },
      { key: 'nested', kind: 'other', display: '{"a":1}' },
    ])
  })

  it('shows unset secrets and empty strings without leaking values', () => {
    const fields = collectPluginFields(schema, {})
    const secret = fields.find(field => field.key === 'apiKey')
    expect(secret?.display).toBe('未设置')
    expect(JSON.stringify(fields)).not.toContain('[redacted]')
  })

  it('builds editor rows with actions bound to the namespace', () => {
    const rows = buildPluginConfigRows(
      [
        { key: 'verbose', kind: 'boolean', display: 'false' },
        { key: 'apiKey', kind: 'secret', display: '未设置' },
        { key: 'limit', kind: 'number', display: '8' },
      ],
      'agent-loop',
      'zh',
    )
    expect(rows[1]).toMatchObject({ action: 'toggle-config-boolean', meta: { field: 'verbose', ns: 'agent-loop' } })
    expect(rows[2]).toMatchObject({ action: 'edit-config-secret', meta: { field: 'apiKey', ns: 'agent-loop' } })
    expect(rows[3]).toMatchObject({ action: 'edit-config-number', meta: { field: 'limit', ns: 'agent-loop' } })
  })
})

describe('buildSettingsRows reasoning effort', () => {
  it('shows no effort rows when the route exposes no levels', () => {
    const rows = buildSettingsRows(modelsSettings(), 'models', 'zh')
    expect(rows.some(row => row.action === 'select-reasoning-effort')).toBe(false)
  })

  it('lists the adapter levels with the current one marked', () => {
    const fixture = modelsSettings()
    fixture.reasoning = { effort: 'high', levels: ['low', 'medium', 'high', 'max'] }
    const rows = buildSettingsRows(fixture, 'models', 'zh')
    const effortRows = rows.filter(row => row.action === 'select-reasoning-effort')
    expect(effortRows.map(row => row.text)).toEqual([
      '○ low',
      '○ medium',
      '● high · 当前',
      '○ max',
    ])
    expect(effortRows[2]?.meta).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-pro', effort: 'high' })
  })

  it('marks models that accept image input', () => {
    const fixture = modelsSettings()
    fixture.settings.models.providers = [{
      provider: 'deepseek-official',
      models: [
        { id: 'deepseek-v4-pro' },
        { id: 'vision', acceptsImage: true },
      ],
    }]
    const rows = buildSettingsRows(fixture, 'models', 'zh')
    expect(rows.some(row => row.text.includes('vision') && row.text.includes('· 图'))).toBe(true)
    expect(rows.some(row => row.text.includes('deepseek-v4-pro') && row.text.includes('· 图'))).toBe(false)
  })

  it('marks the exact provider/model pair when providers reuse a model id', () => {
    const fixture = modelsSettings()
    fixture.provider = 'text-provider'
    fixture.model = 'shared'
    fixture.settings.models.providers = [
      { provider: 'text-provider', models: [{ id: 'shared' }] },
      { provider: 'vision-provider', models: [{ id: 'shared', acceptsImage: true }] },
    ]
    const rows = buildSettingsRows(fixture, 'models', 'en')
    expect(rows.find(row => row.key === 'm-text-provider-shared')?.text).toContain('●')
    expect(rows.find(row => row.key === 'm-vision-provider-shared')?.text).toContain('○')
  })
})

describe('buildSettingsRows locale', () => {
  it('offers a locale toggle and no theme switcher on the general page', () => {
    const fixture = modelsSettings()
    fixture.settings.general = { ...fixture.settings.general, theme: 'light', locale: 'en' }
    const rows = buildSettingsRows(fixture, 'general', 'zh')
    expect(rows.some(row => row.action === 'toggle-locale' && row.text.includes('English'))).toBe(true)
    expect(rows.some(row => row.key === 'theme' || row.text.includes('终端主题'))).toBe(false)
  })
})

describe('buildSettingsRows plugin inventory', () => {
  it('only makes host-toggleable plugin rows actionable', () => {
    const fixture = modelsSettings()
    fixture.settings.plugins = [
      { id: 'storage', name: 'storage', enabled: true, loaded: true, toggleable: true, namespace: 'storage' },
      { id: 'off', name: 'off', enabled: false, loaded: false, toggleable: true },
      { id: 'pwsh', name: 'pwsh', enabled: false, loaded: false, toggleable: false, toggleBlockedReason: 'conditional' },
      { id: 'session', name: 'session', enabled: true, loaded: true, toggleable: false, toggleBlockedReason: 'dependency' },
      { id: 'tool-bash', name: 'tool-bash', enabled: false, loaded: false, toggleable: false, toggleBlockedReason: 'managed' },
    ]
    const rows = buildSettingsRows(fixture, 'plugins', 'zh')
    expect(rows[0]?.text).toBe('● storage · storage · 已激活')
    const storage = rows.find(row => row.key === 'pl-storage')
    expect(storage?.action).toBe('toggle-plugin')
    expect(storage?.meta).toEqual({ id: 'storage', enabled: true })
    expect(storage?.text).toBe('● storage · storage · 已激活')
    const off = rows.find(row => row.key === 'pl-off')
    expect(off?.action).toBe('toggle-plugin')
    expect(off?.meta).toEqual({ id: 'off', enabled: false })
    expect(off?.text).toBe('○ off · off · 未加载 · 已禁用')
    expect(off?.dim).toBeUndefined()
    expect(storage?.dim).toBeUndefined()
    const pwsh = rows.find(row => row.key === 'pl-pwsh')
    expect(pwsh).toMatchObject({
      dim: true,
      meta: { id: 'pwsh', enabled: false },
      text: '○ pwsh · pwsh · 未加载 · 已禁用 · 条件控制',
    })
    expect(rows.find(row => row.key === 'pl-session')).toMatchObject({
      meta: { id: 'session', enabled: true },
      text: '● session · session · 已激活 · 存在活跃依赖方',
    })
    expect(rows.find(row => row.key === 'pl-tool-bash')).toMatchObject({
      text: '○ tool-bash · tool-bash · 未加载 · 已禁用 · profile 管理',
      dim: true,
    })
    expect(rows.filter(row => ['pl-pwsh', 'pl-session', 'pl-tool-bash'].includes(row.key)).every(row => row.action === undefined)).toBe(true)
    expect(rows.at(-2)?.text).toContain('受限条目只读')
  })

  it('renders toggle guidance in English', () => {
    const fixture = modelsSettings()
    fixture.settings.plugins = [{ id: 'storage', name: 'storage', enabled: true, loaded: true, toggleable: true }]
    const rows = buildSettingsRows(fixture, 'plugins', 'en')
    expect(rows[0]?.text).toBe('● storage · storage · active')
    expect(rows.some(row => row.key === 'pl-storage' && row.action === 'toggle-plugin')).toBe(true)
    expect(rows.at(-2)?.text).toContain('blocked rows are read-only')
  })
})

describe('collectCredentialRefs', () => {
  it('finds a credential-ref field on a flat object schema', () => {
    const schema = {
      uid: 1,
      refs: {
        '1': { type: 'object', dict: { apiKeyEnv: 2, baseURL: 3 } },
        '2': { type: 'string', meta: { role: 'credential-ref' } },
        '3': { type: 'string' },
      },
    }
    const slots = collectCredentialRefs(schema, { apiKeyEnv: 'DEEPSEEK_API_KEY', baseURL: 'https://x' })
    expect(slots).toEqual([{ ref: 'DEEPSEEK_API_KEY', path: ['apiKeyEnv'] }])
  })

  it('walks dict containers for per-provider references', () => {
    const schema = {
      uid: 1,
      refs: {
        '1': { type: 'object', dict: { providers: 2 } },
        '2': { type: 'dict', inner: 3 },
        '3': { type: 'object', dict: { apiKeyEnv: 4 } },
        '4': { type: 'string', meta: { role: 'credential-ref' } },
      },
    }
    const slots = collectCredentialRefs(schema, {
      providers: {
        openai: { apiKeyEnv: 'OPENAI_API_KEY' },
        anthropic: { apiKeyEnv: 'ANTHROPIC_API_KEY' },
      },
    })
    expect(slots.map(slot => slot.ref)).toEqual(['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'])
    expect(slots[1]?.path).toEqual(['providers', 'anthropic', 'apiKeyEnv'])
  })

  it('walks array items', () => {
    const schema = {
      uid: 1,
      refs: {
        '1': { type: 'array', inner: 2 },
        '2': { type: 'string', meta: { role: 'credential-ref' } },
      },
    }
    const slots = collectCredentialRefs(schema, ['A_KEY', 'B_KEY'])
    expect(slots.map(slot => slot.ref)).toEqual(['A_KEY', 'B_KEY'])
  })

  it('records an empty reference instead of a value when the field is unset', () => {
    const schema = {
      uid: 1,
      refs: {
        '1': { type: 'object', dict: { apiKeyEnv: 2 } },
        '2': { type: 'string', meta: { role: 'credential-ref' } },
      },
    }
    expect(collectCredentialRefs(schema, {})).toEqual([{ ref: '', path: ['apiKeyEnv'] }])
  })

  it('returns no slots for schemas without credential roles or malformed roots', () => {
    const plain = {
      uid: 1,
      refs: {
        '1': { type: 'object', dict: { theme: 2 } },
        '2': { type: 'string' },
      },
    }
    expect(collectCredentialRefs(plain, { theme: 'dark' })).toEqual([])
    expect(collectCredentialRefs(null, {})).toEqual([])
    expect(collectCredentialRefs({}, {})).toEqual([])
  })
})

describe('groupProviders', () => {
  it('groups routes by provider in first-seen order without duplicates', () => {
    const rows = groupProviders([
      { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
      { provider: 'openai', model: 'gpt-5' },
      { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    ])
    expect(rows).toEqual([
      { provider: 'deepseek-official', models: [{ id: 'deepseek-v4-flash' }, { id: 'deepseek-v4-pro' }] },
      { provider: 'openai', models: [{ id: 'gpt-5' }] },
    ])
    expect(groupProviders([
      { provider: 'deepseek-official', model: 'vision', acceptsImage: true },
    ])).toEqual([
      { provider: 'deepseek-official', models: [{ id: 'vision', acceptsImage: true }] },
    ])
  })

  it('returns an empty list for no routes', () => {
    expect(groupProviders([])).toEqual([])
  })
})

describe('panel row builders', () => {
  it('projects all jobs as inspectable details, never immediate stop actions', () => {
    const rows = buildJobsRows([
      { id: 'bash-1', kind: 'bash', label: 'pnpm test', status: 'running', elapsedMs: 65000 },
      { id: 'bash-2', kind: 'bash', label: 'pnpm lint', status: 'completed', detail: 'exit code: 0', elapsedMs: 1200 },
    ], 'zh')
    const head = rows[0]
    expect(head?.text).toContain('后台任务 Jobs')
    const live = rows.find(row => row.key === 'job-bash-1')
    expect(live?.text).toContain('● bash-1 · bash · pnpm test · running · 65s')
    expect(live?.action).toBe('inspect-job')
    expect(live?.meta?.id).toBe('bash-1')
    const done = rows.find(row => row.key === 'job-bash-2')
    expect(done?.text).toContain('○ bash-2 · bash · pnpm lint · completed · 1s · exit code: 0')
    expect(done?.action).toBe('inspect-job')
  })

  it('shows an empty placeholder when no jobs are registered', () => {
    const rows = buildJobsRows([], 'zh')
    expect(rows[1]?.text).toContain('无后台任务')
  })

  it('projects the subagent tree with depth indentation', () => {
    const rows = buildSubagentRows([
      { id: 'sess-aaa', label: '子任务 A', mode: 'continuable', activity: 'running', depth: 1 },
      { id: 'sess-bbb', label: '孙任务 B', mode: 'one-shot', activity: 'inactive', depth: 2 },
      { id: 'sess-ccc', label: 'corrupt', mode: 'diagnostic', activity: 'diagnostic', depth: 1 },
    ], 'zh')
    const child = rows.find(row => row.key === 'sub-sess-aaa')
    expect(child?.text).toBe('● 运行中 sess-aaa · continuable · 子任务 A · 预设：未知')
    expect(child?.dim).toBeUndefined()
    const grandchild = rows.find(row => row.key === 'sub-sess-bbb')
    expect(grandchild?.text).toBe('  ○ 持久化 sess-bbb · one-shot · 孙任务 B · 预设：未知')
    expect(grandchild?.dim).toBe(true)
    const diagnostic = rows.find(row => row.key === 'sub-sess-ccc')
    expect(diagnostic?.text).toContain('无法解析')
  })

  it('projects workflow runs with phase, log, and agent counts', () => {
    const rows = buildWorkflowRows([
      { id: 'wf-1', name: 'audit', status: 'running', phase: '扫描', agentsStarted: 3, lastLog: '扫到 42 个文件' },
      { id: 'wf-2', name: 'migrate', status: 'error', agentsStarted: 1, error: 'boom' },
    ], 'zh')
    const running = rows.find(row => row.key === 'wf-wf-1')
    expect(running?.text).toContain('● 运行中 audit · 阶段 扫描 · 3 个 agent() · 扫到 42 个文件')
    expect(running?.dim).toBeUndefined()
    const failed = rows.find(row => row.key === 'wf-wf-2')
    expect(failed?.text).toContain('× 失败 migrate · 1 个 agent() · 错误 boom')
    expect(failed?.dim).toBe(true)
  })

  it('shows an empty placeholder when no workflow runs exist', () => {
    const rows = buildWorkflowRows([], 'zh')
    expect(rows[1]?.text).toContain('没有正在运行或最近结束的 workflow')
  })
})

describe('en locale', () => {
  it('renders the general page header and busy-enter value in English', () => {
    const fixture = modelsSettings()
    fixture.settings.general = { busyEnter: 'steer', thinking: 'expanded', theme: 'light', locale: 'en' }
    const rows = buildSettingsRows(fixture, 'general', 'en')
    expect(rows[0]?.key).toBe('busyEnter')
    expect(rows.some(row => row.key === 'busyEnter' && row.text.includes('now steer'))).toBe(true)
  })

  it('marks the default model with English copy', () => {
    const rows = buildSettingsRows(modelsSettings(), 'models', 'en')
    expect(rows.some(row => row.action === 'select-model' && row.text.includes(' · default'))).toBe(true)
  })

  it('renders provider names as cyan section titles without a pointer', () => {
    const rows = buildSettingsRows(modelsSettings(), 'models', 'zh')
    const provider = rows.find(row => row.key === 'p-deepseek-official')
    expect(provider?.text).toBe('deepseek-official')
    expect(provider?.color).toBe('cyan')
    expect(provider?.text.startsWith('▸')).toBe(false)
  })

  it('renders session headers in English', () => {
    const rows = buildSessionRows([{ id: 'sess-1', model: 'deepseek-v4-pro', status: 'persisted', live: false }], undefined, 'en')
    expect(rows[0]?.text).toContain('persisted sessions')
  })

  it('renders the jobs header in English', () => {
    const rows = buildJobsRows([], 'en')
    expect(rows[0]?.text).toContain('Enter views details')
  })

  it('renders the workflow empty state in English', () => {
    const rows = buildWorkflowRows([], 'en')
    expect(rows[1]?.text).toContain('no running or recently finished workflows')
  })

  it('renders the plugin-config header in English', () => {
    const rows = buildPluginConfigRows([], 'agent-loop', 'en')
    expect(rows[0]?.text).toContain('Enter toggles/edits')
  })

  it('localizes secret set/unset markers', () => {
    const schema = {
      uid: 1,
      refs: {
        '1': { type: 'object', dict: { apiKey: 2 } },
        '2': { type: 'string', meta: { role: 'secret' } },
      },
    }
    expect(collectPluginFields(schema, { apiKey: '[redacted]' }, 'en')[0]?.display).toBe('••• set')
    expect(collectPluginFields(schema, { apiKey: '[redacted]' }, 'zh')[0]?.display).toBe('••• 已设置')
  })

  it('keeps renderer-owned copy English across every panel projection', () => {
    const fixture = modelsSettings()
    fixture.settings.general = { busyEnter: 'steer', thinking: 'expanded', theme: 'light', locale: 'en' }
    fixture.settings.plugins = [
      { id: 'sessions', name: 'sessions', enabled: true, loaded: true, toggleable: true },
      { id: 'optional', name: 'optional', enabled: false, loaded: false, toggleable: true },
    ]
    fixture.settings.inventory = {
      namespaces: [{ ns: 'tui', applies: 'live', revision: 1, secretSlots: 0, secretSet: 0 }],
      credentials: [{ ref: 'API_KEY', configured: false, writable: true }],
      inspectProviders: 2,
    }
    fixture.settings.presets = [{ id: 'standard', name: 'Standard', trust: 'system' }]
    fixture.settings.currentPreset = 'standard'
    const rows = [
      ...SETTINGS_PAGES.flatMap(page => buildSettingsRows(fixture, page, 'en')),
      ...buildJobsRows([], 'en'),
      ...buildSessionRows([{ id: 'session-1', model: 'model', status: 'persisted', live: false }], undefined, 'en'),
      ...buildSubagentRows([], 'en'),
      ...buildWorkflowRows([], 'en'),
      ...buildPluginConfigRows([{ key: 'limit', kind: 'number', display: '1' }], 'sample', 'en'),
    ]
    expect(rows.map(row => row.text).join('\n')).not.toMatch(/\p{Script=Han}/u)
  })
})

describe('sessionTitlesById', () => {
  it('keys fulfilled non-empty titles by session id', () => {
    const titles = sessionTitlesById([
      { sessionId: 's-1', status: 'fulfilled', value: { title: { title: '修好测试' } } },
      { sessionId: 's-2', status: 'fulfilled', value: { title: { title: '重构计划' } } },
    ])
    expect(titles.get('s-1')).toBe('修好测试')
    expect(titles.get('s-2')).toBe('重构计划')
  })

  it('skips rejected observations and missing or empty titles', () => {
    const titles = sessionTitlesById([
      { sessionId: 's-1', status: 'rejected' },
      { sessionId: 's-2', status: 'fulfilled', value: {} },
      { sessionId: 's-3', status: 'fulfilled', value: { title: { title: '' } } },
      { sessionId: 's-4', status: 'fulfilled', value: { title: { title: '  有标题  ' } } },
    ])
    expect(titles.size).toBe(1)
    expect(titles.get('s-4')).toBe('  有标题  ')
  })

  it('survives the corpus filter that dropped a live session from the requested list (the first-open off-by-one)', () => {
    // loadSessionRows requests titles for [live, r1, r2] in listSessions
    // order, then filters the LIVE id out of the corpus rows. The old
    // index-aligned lookup gave r1 the live title, r2 the r1 title, … — so
    // the row the user picked (by its displayed title) resumed the session
    // ONE BELOW it. Id-keyed lookups give every row its own title.
    const observations = [
      { sessionId: 'session-live0001', status: 'fulfilled' as const, value: { title: { title: '当前会话' } } },
      { sessionId: 'session-old0001', status: 'fulfilled' as const, value: { title: { title: '修好测试' } } },
      { sessionId: 'session-old0002', status: 'fulfilled' as const, value: { title: { title: '重构计划' } } },
    ]
    const titles = sessionTitlesById(observations)
    const liveIds = new Set(['session-live0001'])
    const corpusIds = ['session-old0001', 'session-old0002']
    const rows = corpusIds.map(id => ({ id, title: titles.get(id) }))
    // Each row carries its own title — the display and the resumed session
    // always agree, no matter which requested ids the caller later drops.
    expect(rows).toEqual([
      { id: 'session-old0001', title: '修好测试' },
      { id: 'session-old0002', title: '重构计划' },
    ])
    expect([...liveIds].every(id => titles.get(id) !== undefined)).toBe(true)
  })
})

describe('buildSettingsRows presets page', () => {
  const presetsFixture = (): Parameters<typeof buildSettingsRows>[0] => {
    const fixture = modelsSettings()
    fixture.settings.presets = [
      { id: 'code', name: 'Coding agent', trust: 'system' },
      { id: 'minimal', name: 'Minimal', trust: 'system' },
      { id: 'local', name: '本地预设', trust: 'user' },
      { id: 'broken', name: 'Broken', trust: 'system', broken: 'unparsable agent.cordis.yml' },
    ]
    fixture.settings.currentPreset = 'code'
    return fixture
  }

  it('marks the current preset and binds select actions to every other usable preset', () => {
    const rows = buildSettingsRows(presetsFixture(), 'presets', 'zh')
    const code = rows.find(row => row.key === 'p-code')
    const minimal = rows.find(row => row.key === 'p-minimal')
    expect(code?.text).toContain('● code · Coding agent · 当前')
    expect(code?.action).toBeUndefined()
    expect(minimal?.text).toContain('○ minimal · Minimal')
    expect(minimal?.action).toBe('select-preset')
    expect(minimal?.meta).toEqual({ id: 'minimal' })
  })

  it('allows restoring the current preset as the future default', () => {
    const fixture = presetsFixture()
    fixture.settings.general.preferredPreset = 'minimal'
    const rows = buildSettingsRows(fixture, 'presets', 'en')
    expect(rows.find(row => row.key === 'p-code')?.action).toBe('select-preset')
    expect(rows.find(row => row.key === 'p-minimal')?.text).toContain('new-session default')
  })

  it('labels user-authored presets and renders broken presets dimmed and inert', () => {
    const rows = buildSettingsRows(presetsFixture(), 'presets', 'zh')
    const local = rows.find(row => row.key === 'p-local')
    const broken = rows.find(row => row.key === 'p-broken')
    expect(local?.text).toContain('· 用户')
    expect(local?.action).toBe('select-preset')
    expect(broken?.text).toContain('· 损坏：unparsable agent.cordis.yml')
    expect(broken?.dim).toBe(true)
    expect(broken?.action).toBeUndefined()
  })

  it('shows the empty placeholder when no preset service is composed', () => {
    const rows = buildSettingsRows(modelsSettings(), 'presets', 'zh')
    expect(rows.find(row => row.key === 'p-empty')?.text).toContain('没有可用的 agent 预设')
  })

  it('navigates to the presets page through the complete settings Tab cycle', () => {
    expect(SETTINGS_PAGES).toEqual(['general', 'models', 'permissions', 'plugins', 'mcp', 'presets', 'appearance', 'diagnostics', 'inventory'])
  })

  it('keeps every settings page free of the old cyan title row', () => {
    for (const page of SETTINGS_PAGES) {
      const rows = buildSettingsRows(presetsFixture(), page, 'zh')
      expect(rows[0]?.text.includes('Tab 切换模块')).toBe(false)
    }
  })
})


describe('task and settings safety projections', () => {
  it('requires a separate confirmation and never offers a repeated stop', () => {
    const job = { id: 'job-1', kind: 'shell', label: 'sleep', status: 'running', elapsedMs: 3000 }
    expect(buildJobDetailRows(job, 'en').filter(row => row.action).map(row => row.action)).toEqual(['request-job-stop'])
    expect(buildJobDetailRows(job, 'en', true).filter(row => row.action).map(row => row.action)).toEqual(['kill-job'])
    for (const status of ['stopping', 'stopped', 'failed', 'completed', 'interrupted']) {
      const rows = buildJobDetailRows({ ...job, status }, 'en', true)
      expect(rows.some(row => row.action)).toBe(false)
      expect(rows[1]?.text).toContain(status)
    }
    expect(buildJobDetailRows(undefined, 'en', true).some(row => row.action)).toBe(false)
  })

  it('keeps actual model visible when refreshed catalog removes it', () => {
    const fixture = modelsSettings()
    fixture.settings.models.providers = []
    const rows = buildSettingsRows(fixture, 'models', 'en')
    expect(rows[0]?.text).toContain(fixture.model)
    expect(rows[0]?.text).toContain('unavailable')
    expect(rows[0]?.action).toBeUndefined()
  })

  it('does not offer edits for environment-owned credential references', () => {
    const fixture = modelsSettings()
    fixture.settings.models.credentials = [{ ref: 'TEST_KEY', configured: true, source: 'environment', writable: false }]
    const row = buildSettingsRows(fixture, 'models', 'en').find(row => row.key === 'c-TEST_KEY')
    expect(row?.text).toContain('environment')
    expect(row?.text).toContain('read-only')
    expect(row?.action).toBeUndefined()
  })
})


describe('authoritative runtime capabilities', () => {
  it.each(['en', 'zh'] as const)('separates bundle install, selection and entry activation (%s)', locale => {
    const fixture = modelsSettings()
    fixture.settings.plugins = [{ id: 'x', name: 'plugin', enabled: true, loaded: false, toggleable: false }]
    fixture.settings.bundles = [{ name: 'bundle', installed: true, enabled: true, availability: 'profile' }]
    const rows = buildSettingsRows(fixture, 'plugins', locale)
    expect(rows.find(row => row.key === 'pl-x')?.text).toContain(locale === 'en' ? 'not loaded' : '未加载')
    expect(rows.find(row => row.key === 'bundle-bundle')?.text).toContain(locale === 'en' ? 'profile-installed' : 'profile 已安装')
  })
  it.each(['en', 'zh'] as const)('reports PTC lifecycle without inventing a live worker (%s)', locale => {
    const fixture = modelsSettings()
    expect(buildSettingsRows(fixture, 'presets', locale).find(row => row.key === 'ptc-runtime')?.text).toContain(locale === 'en' ? 'unknown' : '未知')
    fixture.settings.ptc = { available: true, executionMode: 'persistent-in-memory' }
    const rows = buildSettingsRows(fixture, 'presets', locale)
    expect(rows.find(row => row.key === 'ptc-memory')?.text).toContain(locale === 'en' ? 'lost on restart' : '重启')
    fixture.settings.ptc.executionMode = 'per-call'
    expect(buildSettingsRows(fixture, 'presets', locale).find(row => row.key === 'ptc-memory')?.text).toContain(locale === 'en' ? 'fresh process' : '新进程')
  })
  it.each(['en', 'zh'] as const)('keeps independently observed child presets and external mode (%s)', locale => {
    const rows = buildSubagentRows([{ id: 'child', label: 'Task', mode: 'external', activity: 'inactive', depth: 1, preset: 'minimal' }], locale)
    expect(rows[1]?.text).toContain('external')
    expect(rows[1]?.text).toContain('minimal')
  })
})


describe('phase 2 settings pages', () => {
  it('offers current appearances and maps old profiles to the current dark selection', () => {
    const fixture = modelsSettings()
    const rows = buildSettingsRows(fixture, 'appearance', 'en')
    expect(rows.filter(row => row.action === 'set-appearance').map(row => row.meta?.id)).toEqual(['claude-terminal-dark', 'claude-terminal-light'])
    expect(rows.find(row => row.text.startsWith('●'))?.meta?.id).toBe('claude-terminal-dark')
    expect(rows.find(row => row.key === 'appearance-font')?.action).toBeUndefined()
    fixture.settings.general.appearance = 'claude-terminal-light'
    expect(buildSettingsRows(fixture, 'appearance', 'en').find(row => row.text.startsWith('●'))?.meta?.id).toBe('claude-terminal-light')
  })
  it('keeps sandbox, Plan and preset facts separate and does not offer implicit permission changes', () => {
    const fixture = modelsSettings()
    fixture.settings.currentPreset = 'ptc'
    const rows = buildSettingsRows({ ...fixture, sandbox: 'read-only', plan: { active: false, pending: true } }, 'permissions', 'en')
    expect(rows.find(row => row.key === 'perm-sandbox')?.text).toContain('read-only')
    expect(rows.find(row => row.key === 'perm-plan')?.text).toContain('pending host confirmation')
    expect(rows.find(row => row.key === 'perm-preset')?.text).toContain('ptc')
    expect(rows.every(row => row.action === undefined)).toBe(true)
    expect(buildSettingsRows(fixture, 'permissions', 'en').find(row => row.key === 'perm-sandbox')?.text).toContain('unavailable')
  })
  it('shows actual MCP loader/configuration facts without claiming connectivity or exposing secrets', () => {
    const fixture = modelsSettings()
    fixture.settings.plugins = [{ id: 'mcp', name: '@deepseek-ai/dsh-mcp', enabled: true, loaded: true, toggleable: false }]
    fixture.settings.inventory.namespaces = [{ ns: 'mcp', applies: 'live', revision: 7, secretSlots: 1, secretSet: 1 }]
    fixture.settings.configs = { mcp: [{ key: 'timeout', kind: 'number', display: '30000' }, { key: 'token', kind: 'secret', display: 'MUST-NOT-LEAK' }] }
    const text = buildSettingsRows(fixture, 'mcp', 'en').map(row => row.text).join('\n')
    expect(text).toContain('@deepseek-ai/dsh-mcp')
    expect(text).toContain('rev 7')
    expect(text).toContain('timeout · 30000')
    expect(text).toContain('does not prove a connected server')
    expect(text).not.toContain('MUST-NOT-LEAK')
    expect(buildSettingsRows(modelsSettings(), 'mcp', 'en').some(row => row.key === 'mcp-empty')).toBe(true)
  })
  it('diagnostics carries observed session, PTC and credential sources with explicit unknowns', () => {
    const fixture = modelsSettings()
    fixture.settings.ptc = { available: true, executionMode: 'persistent-in-memory' }
    fixture.settings.inventory.credentials = [{ ref: 'KEY', configured: true, source: 'project-env', writable: false }]
    const rows = buildSettingsRows({ ...fixture, sessionId: 'session-1', cwd: '/fixture', goal: null }, 'diagnostics', 'en')
    const text = rows.map(row => row.text).join('\n')
    expect(text).toContain('Session · session-1')
    expect(text).toContain('Workspace · /fixture')
    expect(text).toContain('persistent-in-memory')
    expect(text).toContain('project-env')
    expect(text).toContain('Goal · none')
    expect(buildSettingsRows(fixture, 'diagnostics', 'en').find(row => row.key === 'diag-session')?.text).toContain('unavailable')
    expect(new Set(rows.map(row => row.key)).size).toBe(rows.length)
  })
})

it('offers only host-backed ask/never choices and explains automatic rejection', () => {
  const fixture = modelsSettings()
  const rows = buildSettingsRows({ ...fixture, approval: { policy: 'never', source: 'session' } }, 'permissions', 'en')
  expect(rows.filter(row => row.action !== undefined).map(row => row.meta?.id)).toEqual(['ask', 'never'])
  expect(rows.find(row => row.key === 'approval-never')?.text).toBe('● Never prompt — reject requests')
  expect(rows.find(row => row.key === 'approval-source')?.text).toContain('session')
  expect(rows.find(row => row.key === 'approval-help')?.text).toContain('does not grant access')
})


it('MCP management only selects official client rows, not shared resource services', () => {
 const fixture=modelsSettings()
 fixture.settings.plugins=[
  {id:'mcp-resources',name:'@deepseek-ai/dsh-mcp-resources',enabled:true,loaded:true,toggleable:true},
  {id:'mcp-demo',name:'@deepseek-ai/dsh-mcp-client',enabled:true,loaded:true,toggleable:true},
 ]
 const rows=buildSettingsRows(fixture,'mcp','en')
 expect(rows.find(row=>row.key==='mcp-plugin-mcp-resources')?.action).toBeUndefined()
 expect(rows.filter(row=>row.action).every(row=>row.meta?.id==='mcp-demo')).toBe(true)
 expect(rows.some(row=>row.key==='mcp-reconnect-mcp-demo')).toBe(true)
})
