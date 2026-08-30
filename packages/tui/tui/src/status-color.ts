/**
 * Uniform colors for todo and goal dock rows. Requested TrueColor values pass
 * directly to Ink so status changes do not make the compact dock visually noisy.
 * @module @deepseek-ai/dsh-tui/src/status-color
 */

import stringWidth from 'string-width'

/** Exact foreground for the complete todo row. */
export const TODO_LINE_COLOR = '#8A8A8A'
/** Exact foreground for the complete goal row. */
export const GOAL_LINE_COLOR = '#61D6D6'

/** One styled run on a dock row. Glyph and label text stay in `text`. */
export interface DockRun {
  /** Visible substring, including counts and status words. */
  text: string
  /** Named theme token or exact TrueColor value. */
  color: string
  /** Pass the color to Ink unchanged instead of resolving it through the theme. */
  exactColor?: boolean
}

/** One fully styled dock row. */
export interface DockLine {
  text: string
  color: string
  exactColor?: boolean
  runs: DockRun[]
}

const DOCK_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** Build one exact-color run. */
function exactRun(text: string, color: string): DockRun {
  return { text, color, exactColor: true }
}

/**
 * Build the todo dock row with one quiet foreground for every segment.
 * @param dockLabel - `todo` / localized dock word.
 * @param inProgressLabel - localized in-progress fragment including the count.
 * @param pendingLabel - localized pending fragment including the count.
 * @param doneLabel - localized completed fragment including the count.
 * @returns text plus colored runs.
 */
export function todoDockLine(
  dockLabel: string,
  inProgressLabel: string,
  pendingLabel: string,
  doneLabel: string,
): DockLine {
  const text = `${dockLabel} ${inProgressLabel} · ${pendingLabel} · ${doneLabel}`
  return {
    text,
    color: TODO_LINE_COLOR,
    exactColor: true,
    runs: [exactRun(text, TODO_LINE_COLOR)],
  }
}

/**
 * Build the goal dock row with one quiet foreground for every segment.
 * @param dockLabel - localized glyph/title, such as `◈ goal`.
 * @param phaseLabel - localized phase label without brackets.
 * @param roundLabel - current/max round label.
 * @param objective - bounded goal objective preview.
 * @returns text plus styled runs.
 */
export function goalDockLine(
  dockLabel: string,
  phaseLabel: string,
  roundLabel: string,
  objective: string,
): DockLine {
  const text = `${dockLabel} [${phaseLabel}] · ${roundLabel} · ${objective}`
  return {
    text,
    color: GOAL_LINE_COLOR,
    exactColor: true,
    runs: [exactRun(text, GOAL_LINE_COLOR)],
  }
}

/**
 * Truncate one styled dock row to a cell budget while retaining run colors.
 * @param line - complete styled dock row.
 * @param width - terminal-cell budget.
 * @returns the original row when it fits, otherwise a grapheme-safe styled prefix plus ellipsis.
 */
export function fitDockLine(line: DockLine, width: number): DockLine {
  const budget = Math.max(0, Math.floor(width))
  if (stringWidth(line.text) <= budget) return line
  if (budget === 0) return { ...line, text: '', runs: [] }
  const contentBudget = budget - 1
  const runs: DockRun[] = []
  let used = 0
  let complete = false
  for (const run of line.runs) {
    let text = ''
    for (const { segment } of DOCK_SEGMENTER.segment(run.text)) {
      const segmentWidth = stringWidth(segment)
      if (used + segmentWidth > contentBudget) {
        complete = true
        break
      }
      text += segment
      used += segmentWidth
    }
    if (text !== '') runs.push({ ...run, text })
    if (complete) break
  }
  const last = runs.at(-1)
  if (last === undefined) runs.push({ text: '…', color: line.color, ...(line.exactColor === true ? { exactColor: true } : {}) })
  else last.text += '…'
  return { ...line, text: runs.map(run => run.text).join(''), runs }
}
