/**
 * Styled colors for todo and goal dock status. Glyphs and labels stay on the
 * line, named colors follow the active theme, and requested TrueColor values
 * pass directly to Ink.
 * @module @deepseek-ai/dsh-tui/src/status-color
 */

import stringWidth from 'string-width'
import type { GoalRow, TodoItem } from './types'

/** Exact pending-todo foreground. */
export const TODO_PENDING_COLOR = '#C9B84A'
/** Exact completed-todo foreground. */
export const TODO_COMPLETED_COLOR = '#3FB950'
/** Exact goal glyph/title foreground. */
export const GOAL_TITLE_COLOR = '#61D6D6'
/** Exact dock separator foreground. */
export const DOCK_SEPARATOR_COLOR = '#666666'
/** Exact goal objective foreground. */
export const GOAL_BODY_COLOR = '#A7A7A7'

/**
 * Resolve the theme token for one todo status.
 * @param status - Durable todo status.
 * @returns The matching theme color token.
 */
export function todoStatusColor(status: TodoItem['status']): 'cyan' | '#C9B84A' | '#3FB950' {
  switch (status) {
    case 'in_progress':
      return 'cyan'
    case 'pending':
      return TODO_PENDING_COLOR
    case 'completed':
      return TODO_COMPLETED_COLOR
    default: {
      const exhaustive: never = status
      return exhaustive
    }
  }
}

/**
 * Resolve the theme token for one goal phase.
 * @param phase - Durable goal phase.
 * @returns The matching theme color token.
 */
export function goalPhaseColor(phase: GoalRow['phase']): 'blue' | 'yellow' | 'red' | 'green' {
  switch (phase) {
    case 'active':
      return 'blue'
    case 'paused':
      return 'yellow'
    case 'blocked':
      return 'red'
    case 'complete':
      return 'green'
    default: {
      const exhaustive: never = phase
      return exhaustive
    }
  }
}

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
 * Build the todo dock row: labels stay visible; each count uses its status color.
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
  const runs: DockRun[] = [
    { text: `${dockLabel} `, color: 'gray' },
    { text: inProgressLabel, color: todoStatusColor('in_progress') },
    exactRun(' · ', DOCK_SEPARATOR_COLOR),
    exactRun(pendingLabel, todoStatusColor('pending')),
    exactRun(' · ', DOCK_SEPARATOR_COLOR),
    exactRun(doneLabel, todoStatusColor('completed')),
  ]
  return { text: runs.map(run => run.text).join(''), color: 'gray', runs }
}

/**
 * Build the goal dock row with distinct title, phase, separators, round, and objective colors.
 * @param dockLabel - localized glyph/title, such as `◈ goal`.
 * @param phaseLabel - localized phase label without brackets.
 * @param roundLabel - current/max round label.
 * @param objective - bounded goal objective preview.
 * @param phase - durable goal phase.
 * @returns text plus styled runs.
 */
export function goalDockLine(
  dockLabel: string,
  phaseLabel: string,
  roundLabel: string,
  objective: string,
  phase: GoalRow['phase'],
): DockLine {
  const runs: DockRun[] = [
    exactRun(`${dockLabel} `, GOAL_TITLE_COLOR),
    { text: `[${phaseLabel}]`, color: goalPhaseColor(phase) },
    exactRun(' · ', DOCK_SEPARATOR_COLOR),
    { text: roundLabel, color: 'white' },
    exactRun(' · ', DOCK_SEPARATOR_COLOR),
    exactRun(objective, GOAL_BODY_COLOR),
  ]
  return {
    text: runs.map(run => run.text).join(''),
    color: GOAL_TITLE_COLOR,
    exactColor: true,
    runs,
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
