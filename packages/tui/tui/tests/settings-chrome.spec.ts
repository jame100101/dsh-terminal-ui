import { describe, expect, it } from 'vitest'
import {
  cycleSettingsPage, filterSettingsRows, hitSettingsTab, SETTINGS_CHROME_ROWS, settingsChromeHit, settingsHintText,
  settingsListIndex, settingsSearchText, settingsTabCell, settingsTabLabels, settingsTabWindow, hitSettingsTabWindow,
} from '../src/settings-chrome'
import type { SettingsPageId } from '../src/settings-data'
import stringWidth from 'string-width'

describe('settingsTabLabels', () => {
  it('uses short Chinese labels that fit a Claude Code-style strip', () => {
    expect(settingsTabLabels('zh').map(tab => tab.id)).toEqual([
      'general', 'models', 'permissions', 'plugins', 'mcp', 'presets', 'appearance', 'diagnostics', 'inventory',
    ])
    expect(settingsTabLabels('zh').map(tab => tab.label)).toEqual(['常规', '模型', '权限', '插件', 'MCP', '预设', '外观', '诊断', '清单'])
    expect(settingsTabLabels('en').map(tab => tab.label)).toEqual([
      'General', 'Models', 'Permissions', 'Plugins', 'MCP', 'Presets', 'Appearance', 'Diagnostics', 'Inventory',
    ])
  })
})

describe('hitSettingsTab', () => {
  it('maps a 1-based column onto the tab whose pill contains it', () => {
    const first = settingsTabCell('常规')
    expect(hitSettingsTab(2, 'zh')).toBe('general')
    expect(hitSettingsTab(1, 'zh')).toBeUndefined()
    expect(hitSettingsTab(2 + stringWidth(first), 'zh')).toBe('models')
    expect(hitSettingsTab(1 + stringWidth(first), 'zh', 1)).toBe('models')
    expect(hitSettingsTab(200, 'zh')).toBeUndefined()
  })
})

describe('cycleSettingsPage', () => {
  it('wraps Tab forward and left-arrow backward', () => {
    expect(cycleSettingsPage('general', 1)).toBe('models')
    expect(cycleSettingsPage('inventory', 1)).toBe('general')
    expect(cycleSettingsPage('general', -1)).toBe('inventory')
    expect(cycleSettingsPage('nope' as SettingsPageId, 1)).toBe('models')
  })
})

describe('filterSettingsRows', () => {
  it('keeps dim footers and substring matches', () => {
    const rows = [
      { key: 'busyEnter', text: 'busyEnter queue' },
      { key: 'theme', text: 'theme dark' },
      { key: 'foot', text: 'writes settings.yaml', dim: true },
    ]
    const filtered = filterSettingsRows(rows, 'THEME')
    expect(filtered.map(row => row.key)).toEqual(['theme', 'foot'])
    expect(filterSettingsRows(rows, '')).toHaveLength(3)
  })
})

describe('settingsSearchText', () => {
  it('shows a placeholder until the user types', () => {
    expect(settingsSearchText('en', '')).toBe('⌕ Search settings...')
    expect(settingsSearchText('zh', '')).toBe('⌕ 搜索设置…')
    expect(settingsSearchText('zh', 'theme')).toBe('⌕ theme')
  })
})

describe('settingsHintText', () => {
  it('names Tab / Enter / Esc the way Claude Code Config does', () => {
    expect(settingsHintText('en')).toContain('Tab to switch')
    expect(settingsHintText('zh')).toContain('Tab 切换')
  })
})

describe('settingsChromeHit', () => {
  it('maps rows under a 4-row header onto search, tabs, hint, then the list', () => {
    expect(SETTINGS_CHROME_ROWS).toBe(3)
    expect(settingsChromeHit(4, 4)).toBeUndefined()
    expect(settingsChromeHit(5, 4)).toBe('search')
    expect(settingsChromeHit(6, 4)).toBe('tab')
    expect(settingsChromeHit(7, 4)).toBe('hint')
    expect(settingsChromeHit(8, 4)).toBe('list')
    expect(settingsListIndex(8, 0, 4)).toBe(0)
    expect(settingsListIndex(10, 2, 4)).toBe(4)
  })
})


describe('settings tab viewport', () => {
  it.each(['en', 'zh'] as const)('keeps every active tab visible and mouse columns exact at narrow widths (%s)', locale => {
    for (const active of settingsTabLabels(locale)) {
      for (const width of [1, 2, 5, 12, 30, 78, 118]) {
        const viewport = settingsTabWindow(locale, active.id, width)
        expect(viewport.tabs.some(tab => tab.id === active.id)).toBe(true)
        expect(stringWidth(viewport.tabs.map(tab => tab.text).join(''))).toBeLessThanOrEqual(width)
        expect(hitSettingsTabWindow(1, viewport)).toBeUndefined()
        for (const tab of viewport.tabs) {
          for (let column = tab.startColumn; column < tab.endColumn; column++) expect(hitSettingsTabWindow(column, viewport)).toBe(tab.id)
        }
        expect(hitSettingsTabWindow(2 + width, viewport)).toBeUndefined()
      }
    }
  })
  it('has no invisible hit targets with no available cells', () => {
    const viewport = settingsTabWindow('en', 'appearance', 0)
    expect(viewport.tabs).toEqual([])
    expect(hitSettingsTabWindow(2, viewport)).toBeUndefined()
  })
  it('tracks hidden tabs at either end without changing page order', () => {
    expect(settingsTabWindow('en', 'general', 15)).toMatchObject({ hiddenBefore: false, hiddenAfter: true })
    expect(settingsTabWindow('en', 'inventory', 15)).toMatchObject({ hiddenBefore: true, hiddenAfter: false })
    const viewport = settingsTabWindow('en', 'appearance', 200, 4)
    expect(viewport).toMatchObject({ hiddenBefore: false, hiddenAfter: false })
    expect(viewport.tabs.map(tab => tab.id)).toEqual(settingsTabLabels('en').map(tab => tab.id))
    expect(hitSettingsTabWindow(4, viewport)).toBe('general')
  })
})
