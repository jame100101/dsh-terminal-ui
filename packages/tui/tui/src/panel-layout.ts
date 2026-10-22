/** Display-only physical rows; continuation cells never create another host action. */
import stringWidth from 'string-width'
import { graphemes } from './input/editor-state'
import { redactDisplayText } from './display-redaction'
import { padEndDisplay } from './wrap'
import type { PanelRow } from './settings-data'

export function wrapPanelText(text: string, width: number): string[] {
  const budget = Math.max(2, width)
  const lines: string[] = []
  let line = ''
  for (const { segment } of graphemes(redactDisplayText(text))) {
    if (segment === '\n') { lines.push(line.trimEnd()); line = ''; continue }
    if (line !== '' && stringWidth(line + segment) > budget) {
      const space = line.lastIndexOf(' ')
      if (space > 0) { lines.push(line.slice(0, space)); line = line.slice(space + 1) }
      if (stringWidth(line + segment) > budget) { lines.push(line.trimEnd()); line = '' }
    }
    if (segment !== '\n') line += segment
  }
  lines.push(line.trimEnd())
  return lines
}

/** Labels start at x5; wide settings values at x48 and model descriptions at x32. */
export function layoutPanelRows(rows: readonly PanelRow[], width: number, models = false): PanelRow[] {
  const available = Math.max(2, width - 8)
  const column = models ? 27 : Math.min(43, Math.max(12, available - 24))
  return rows.flatMap(row => {
    if (row.columns === undefined) return [{ ...row, text: redactDisplayText(row.text) }]
    // Very narrow terminals stack complete values instead of hiding either column.
    const stacked = available < 36
    const labels = wrapPanelText(row.columns.label, stacked ? available : column - 2)
    const values = wrapPanelText(row.columns.value, stacked ? available : available - column)
    const physical = stacked ? [...labels, ...values] : Array.from({ length: Math.max(labels.length, values.length) }, (_, i) =>
      padEndDisplay(labels[i] ?? '', column) + (values[i] ?? ''))
    return physical.map((text, i): PanelRow => i === 0 ? { ...row, text } : {
      key: `${row.key}:line:${i}`, text, continuationOf: row.key,
      ...(row.dim === undefined ? {} : { dim: row.dim }),
      ...(row.color === undefined ? {} : { color: row.color }),
    })
  })
}

/** Mouse clicks on wrapped cells resolve to the one original action. */
export function panelActionIndex(rows: readonly PanelRow[], index: number): number {
  const parent = rows[index]?.continuationOf
  return parent === undefined ? index : rows.findIndex(row => row.key === parent)
}
