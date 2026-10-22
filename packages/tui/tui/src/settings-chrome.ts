import { displayTextMatches } from './display-redaction'
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
 * Labels for the settings pages, in display order.
 * @param locale - chrome language.
 * @returns the tabs.
 */
export function settingsTabLabels(locale: 'zh' | 'en'): readonly SettingsTab[] {
  const labels: Record<SettingsPageId, readonly [string, string]> = {
    general: ['General', '常规'], models: ['Models', '模型'], permissions: ['Permissions', '权限'],
    plugins: ['Plugins', '插件'], mcp: ['MCP', 'MCP'], presets: ['Presets', '预设'],
    appearance: ['Appearance', '外观'], diagnostics: ['Diagnostics', '诊断'], inventory: ['Inventory', '清单'],
  }
  return SETTINGS_PAGES.map(id => ({ id, label: labels[id][locale === 'en' ? 0 : 1] }))
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
  return rows.filter(row => row.dim === true || displayTextMatches([row.text, row.columns?.label ?? '', row.columns?.value ?? ''].join(' '), needle))
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

/** A tab viewport is shared by drawing and hit-testing, including clipped labels. */
export interface SettingsTabWindow {
  tabs: readonly (SettingsTab & { text: string; startColumn: number; endColumn: number })[]
  hiddenBefore: boolean
  hiddenAfter: boolean
}
export function settingsTabWindow(locale: 'zh' | 'en', active: SettingsPageId, width: number, startColumn = 2): SettingsTabWindow {
  const tabs = settingsTabLabels(locale)
  const budget = Math.max(0, Math.floor(width))
  const index = Math.max(0, tabs.findIndex(tab => tab.id === active))
  if (budget === 0) return { tabs: [], hiddenBefore: index > 0, hiddenAfter: index < tabs.length - 1 }
  let start = index
  let end = index + 1
  let cells = stringWidth(settingsTabCell(tabs[index]!.label))
  // Start with the active tab, then include its nearest neighbours when they fit.
  while (start > 0 || end < tabs.length) {
    const left = start > 0 ? stringWidth(settingsTabCell(tabs[start - 1]!.label)) : Infinity
    const right = end < tabs.length ? stringWidth(settingsTabCell(tabs[end]!.label)) : Infinity
    if (cells + left > budget && cells + right > budget) break
    if (cells + left <= budget && (index - start <= end - index - 1 || cells + right > budget)) { start--; cells += left }
    else { end++; cells += right }
  }
  let column = startColumn
  const shown = tabs.slice(start, end).map(tab => {
    let text = settingsTabCell(tab.label)
    if (stringWidth(text) > budget) {
      let clipped = ''
      for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text.trim())) {
        if (stringWidth(clipped + segment) > budget - 1) break
        clipped += segment
      }
      text = clipped + '…'
    }
    const result = { ...tab, text, startColumn: column, endColumn: column + stringWidth(text) }
    column = result.endColumn
    return result
  })
  return { tabs: shown, hiddenBefore: start > 0, hiddenAfter: end < tabs.length }
}
export function hitSettingsTabWindow(column: number, viewport: SettingsTabWindow): SettingsPageId | undefined {
  return viewport.tabs.find(tab => column >= tab.startColumn && column < tab.endColumn)?.id
}
