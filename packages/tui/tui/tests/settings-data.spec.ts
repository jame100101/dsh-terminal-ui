import { describe, expect, it } from 'vitest'
import {
  buildJobsRows, buildPluginConfigRows, buildSessionRows, buildSettingsRows, buildSubagentRows, buildWorkflowRows,
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
  it('renders every plugin row as read-only status', () => {
    const fixture = modelsSettings()
    fixture.settings.plugins = [
      { id: 'storage', name: 'storage', enabled: true, loaded: true, namespace: 'storage' },
      { id: 'off', name: 'off', enabled: false, loaded: false },
    ]
    const rows = buildSettingsRows(fixture, 'plugins', 'zh')
    expect(rows[0]?.text).toBe('● storage · storage')
    const storage = rows.find(row => row.key === 'pl-storage')
    expect(storage?.action).toBeUndefined()
    expect(storage?.meta).toBeUndefined()
    expect(storage?.text).toBe('● storage · storage')
    const off = rows.find(row => row.key === 'pl-off')
    expect(off?.action).toBeUndefined()
    expect(off?.meta).toBeUndefined()
    expect(off?.text).toBe('○ off · off · 未加载 · 已禁用')
    expect(off?.dim).toBe(true)
    expect(storage?.dim).toBeUndefined()
    expect(rows.filter(row => row.key.startsWith('pl-') && row.key !== 'pl-head' && row.key !== 'pl-foot')
      .every(row => row.action === undefined)).toBe(true)
    expect(rows.at(-1)?.text).toContain('让 Agent 为你修改该配置文件')
  })

  it('renders the read-only guidance in English', () => {
    const fixture = modelsSettings()
    fixture.settings.plugins = [{ id: 'storage', name: 'storage', enabled: true, loaded: true }]
    const rows = buildSettingsRows(fixture, 'plugins', 'en')
    expect(rows[0]?.text).toBe('● storage · storage')
    expect(rows.some(row => row.key === 'pl-storage' && row.text === '● storage · storage')).toBe(true)
    expect(rows.at(-1)?.text).toContain('ask the Agent to update that configuration file')
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
  it('projects jobs with elapsed seconds and a kill action only for live jobs', () => {
    const rows = buildJobsRows([
      { id: 'bash-1', kind: 'bash', label: 'pnpm test', status: 'running', elapsedMs: 65000 },
      { id: 'bash-2', kind: 'bash', label: 'pnpm lint', status: 'completed', detail: 'exit code: 0', elapsedMs: 1200 },
    ], 'zh')
    const head = rows[0]
    expect(head?.text).toContain('后台任务 Jobs')
    const live = rows.find(row => row.key === 'job-bash-1')
    expect(live?.text).toContain('● bash-1 · bash · pnpm test · running · 65s')
    expect(live?.action).toBe('kill-job')
    expect(live?.meta?.id).toBe('bash-1')
    const done = rows.find(row => row.key === 'job-bash-2')
    expect(done?.text).toContain('○ bash-2 · bash · pnpm lint · completed · 1s · exit code: 0')
    expect(done?.action).toBeUndefined()
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
    expect(child?.text).toBe('● 运行中 sess-aaa · continuable · 子任务 A')
    expect(child?.dim).toBeUndefined()
    const grandchild = rows.find(row => row.key === 'sub-sess-bbb')
    expect(grandchild?.text).toBe('  ○ 持久化 sess-bbb · one-shot · 孙任务 B')
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
    expect(rows[0]?.text).toContain('kills the selected job')
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
      { id: 'sessions', name: 'sessions', enabled: true, loaded: true },
      { id: 'optional', name: 'optional', enabled: false, loaded: false },
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
    expect(rows[0]?.text).toContain('没有可用的 agent 预设')
  })

  it('navigates to the presets page through the five-page Tab cycle', () => {
    expect(SETTINGS_PAGES).toEqual(['general', 'models', 'plugins', 'inventory', 'presets'])
  })

  it('keeps every settings page free of the old cyan title row', () => {
    for (const page of SETTINGS_PAGES) {
      const rows = buildSettingsRows(presetsFixture(), page, 'zh')
      expect(rows[0]?.text.includes('Tab 切换模块')).toBe(false)
    }
  })
})
