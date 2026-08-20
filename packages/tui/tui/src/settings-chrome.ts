/**
 * Claude Code-style settings chrome: a search field, a clickable tab strip,
 * and a one-line key hint. Geometry is pure so mouse hit-testing stays
 * unit-testable.
 * @module @deepseek-ai/dsh-tui/src/settings-chrome
 */

import stringWidth from 'string-width'
import type { SettingsPageId } from './settings-data'
import { SETTINGS_PAGES } from './settings-data'
import type { PanelRow } from './settings-data'

/** Search row + tab strip + key hint under the 4-row header. */
export const SETTINGS_CHROME_ROWS = 3

/** One settings tab's id and label. */
export interface SettingsTab {
  id: SettingsPageId
  label: string
}

/** Which chrome row a 1-based click lands on, or the list below. */
export type SettingsChromeHit = 'search' | 'tab' | 'hint' | 'list'

/**
 * Labels for the five settings pages, in display order.
 * @param locale - chrome language.
 * @returns the tabs.
 */
export function settingsTabLabels(locale: 'zh' | 'en'): readonly SettingsTab[] {
  return locale === 'en'
    ? [
      { id: 'general', label: 'General' },
      { id: 'models', label: 'Models' },
      { id: 'plugins', label: 'Plugins' },
      { id: 'inventory', label: 'Inventory' },
      { id: 'presets', label: 'Presets' },
    ]
    : [
      { id: 'general', label: '常规' },
      { id: 'models', label: '模型' },
      { id: 'plugins', label: '插件' },
      { id: 'inventory', label: '清单' },
      { id: 'presets', label: '预设' },
    ]
}

/**
 * Display cells for one tab, including the spaces that form the inverse pill.
 * @param label - the tab label.
 * @returns the padded cell text.
 */
export function settingsTabCell(label: string): string {
  return ` ${label} `
}

/**
 * Placeholder or live query shown on the settings search row.
 * @param locale - chrome language.
 * @param query - the current filter text.
 * @returns the search-row text.
 */
export function settingsSearchText(locale: 'zh' | 'en', query: string): string {
  if (query !== '') return `⌕ ${query}`
  return locale === 'en' ? '⌕ Search settings...' : '⌕ 搜索设置…'
}

/**
 * Dim hint under the tab strip (Claude Code Config chrome).
 * @param locale - chrome language.
 * @returns the hint.
 */
export function settingsHintText(locale: 'zh' | 'en'): string {
  return locale === 'en'
    ? 'Tab to switch · Enter to select · Esc to close'
    : 'Tab 切换 · Enter 选择 · Esc 关闭'
}

/**
 * Which settings page a 1-based terminal column hits on the tab strip.
 * Content starts at column 2 after the panel's left padding cell.
 * @param column - 1-based mouse column.
 * @param locale - chrome language.
 * @param startColumn - 1-based first content column (default 2).
 * @returns the page id, or undefined when the click missed every tab.
 */
export function hitSettingsTab(
  column: number,
  locale: 'zh' | 'en',
  startColumn = 2,
): SettingsPageId | undefined {
  let cursor = startColumn
  for (const tab of settingsTabLabels(locale)) {
    const width = stringWidth(settingsTabCell(tab.label))
    if (column >= cursor && column < cursor + width) return tab.id
    cursor += width
  }
  return undefined
}

/**
 * Classify a 1-based click row against the settings chrome under the header.
 * @param row - 1-based mouse row.
 * @param headerRows - header rows above the panel (DSH-TUI header is 4).
 * @returns the chrome region, or undefined when the click is still in the header.
 */
export function settingsChromeHit(row: number, headerRows: number): SettingsChromeHit | undefined {
  const offset = row - headerRows
  if (offset === 1) return 'search'
  if (offset === 2) return 'tab'
  if (offset === 3) return 'hint'
  if (offset >= 4) return 'list'
  return undefined
}

/**
 * Settings-list index for a click on a list row.
 * @param row - 1-based mouse row.
 * @param top - the panel's top-anchored offset.
 * @param headerRows - header rows above the panel.
 * @returns the row index in the filtered list.
 */
export function settingsListIndex(row: number, top: number, headerRows: number): number {
  return top + row - headerRows - SETTINGS_CHROME_ROWS - 1
}

/**
 * Keep rows whose text matches the query. Empty query returns the list
 * unchanged. Dim footer rows stay visible so the save hint is not lost.
 * @param rows - the page rows.
 * @param query - case-insensitive substring.
 * @returns the filtered rows.
 */
export function filterSettingsRows(rows: readonly PanelRow[], query: string): PanelRow[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return [...rows]
  return rows.filter(row => row.dim === true || row.text.toLowerCase().includes(needle))
}

/**
 * Cycle settings pages. `delta` of 1 is Tab / →; -1 is ←.
 * @param current - the active page.
 * @param delta - +1 or -1.
 * @returns the next page.
 */
export function cycleSettingsPage(current: SettingsPageId, delta: 1 | -1): SettingsPageId {
  const index = SETTINGS_PAGES.indexOf(current)
  const start = index < 0 ? 0 : index
  return SETTINGS_PAGES[(start + delta + SETTINGS_PAGES.length) % SETTINGS_PAGES.length] as SettingsPageId
}
