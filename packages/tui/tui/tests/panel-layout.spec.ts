import { describe, expect, it } from 'vitest'
import stringWidth from 'string-width'
import { layoutPanelRows, panelActionIndex, wrapPanelText } from '../src/panel-layout'
import { filterSettingsRows } from '../src/settings-chrome'
import type { PanelRow } from '../src/settings-data'

describe('physical panel layout', () => {
  it.each([79, 119])('aligns settings values at x48 for frame width %i', width => {
    const rows = layoutPanelRows([{ key: 'setting', text: '设置 · value', columns: { label: '中文设置', value: 'value' }, action: 'toggle-thinking' }], width)
    expect(stringWidth(rows[0]!.text.split('value')[0]!)).toBe(43)
    expect(rows[0]!.action).toBe('toggle-thinking')
  })
  it('wraps a long description without inventing another action and resolves continuation clicks', () => {
    const row: PanelRow = { key: 'model', text: 'long model', columns: { label: '● 中文👨‍👩‍👧‍👦模型', value: 'official provider with a long description and image input support' }, action: 'select-model', meta: { provider: 'official', model: 'model' } }
    const rows = layoutPanelRows([row], 59, true)
    expect(rows.length).toBeGreaterThan(2)
    expect(rows.filter(row => row.action !== undefined)).toHaveLength(1)
    expect(rows.every(row => stringWidth(row.text) <= 51)).toBe(true)
    expect(rows[0]!.text).toContain('👨‍👩‍👧‍👦')
    expect(panelActionIndex(rows, 2)).toBe(0)
    expect(filterSettingsRows([row], 'image input')).toHaveLength(1)
  })
  it('stacks full labels and values in narrow terminals', () => {
    const rows = layoutPanelRows([{ key: 'setting', text: '', columns: { label: '中文设置', value: 'complete value' } }], 30)
    expect(rows.map(row => row.text)).toEqual(['中文设置', 'complete value'])
  })
  it('keeps ZWJ graphemes and wraps at word boundaries', () => {
    expect(wrapPanelText('one two three', 8)).toEqual(['one two', 'three'])
    expect(wrapPanelText('👨‍👩‍👧‍👦👨‍👩‍👧‍👦', 2)).toEqual(['👨‍👩‍👧‍👦', '👨‍👩‍👧‍👦'])
  })
  it('redacts complete secrets before dividing them into physical rows', () => {
    const rows = layoutPanelRows([{ key: 'secret', text: '', columns: { label: 'Source', value: 'password=do-not-display-this' } }], 50)
    expect(rows.map(row => row.text).join('')).not.toContain('do-not-display')
    expect(rows.map(row => row.text).join('')).toContain('[REDACTED]')
  })
})
