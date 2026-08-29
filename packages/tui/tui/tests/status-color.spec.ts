import { describe, expect, it } from 'vitest'
import stringWidth from 'string-width'
import {
  DOCK_SEPARATOR_COLOR, fitDockLine, GOAL_BODY_COLOR, GOAL_TITLE_COLOR, goalDockLine, goalPhaseColor,
  TODO_COMPLETED_COLOR, TODO_PENDING_COLOR, todoDockLine, todoStatusColor,
} from '../src/status-color'

describe('todo and goal status colors', () => {
  it('maps todo statuses and keeps labels in the dock line', () => {
    expect(todoStatusColor('in_progress')).toBe('cyan')
    expect(todoStatusColor('pending')).toBe('#C9B84A')
    expect(todoStatusColor('completed')).toBe('#3FB950')
    const line = todoDockLine('todo', '2 in progress', '3 pending', '1 done')
    expect(line.text).toContain('2 in progress')
    expect(line.text).toContain('3 pending')
    expect(line.text).toContain('1 done')
    expect(line.runs.map(run => run.color)).toEqual([
      'gray', 'cyan', DOCK_SEPARATOR_COLOR, TODO_PENDING_COLOR, DOCK_SEPARATOR_COLOR, TODO_COMPLETED_COLOR,
    ])
    expect(line.runs.filter(run => run.color.startsWith('#')).every(run => run.exactColor === true)).toBe(true)
  })

  it('maps goal phases and keeps the phase label in the dock line', () => {
    expect(goalPhaseColor('active')).toBe('blue')
    expect(goalPhaseColor('paused')).toBe('yellow')
    expect(goalPhaseColor('blocked')).toBe('red')
    expect(goalPhaseColor('complete')).toBe('green')
    const line = goalDockLine('◈ goal', 'blocked', 'round 1/12', 'stop', 'blocked')
    expect(line.text).toContain('[blocked]')
    expect(line.color).toBe(GOAL_TITLE_COLOR)
    expect(line.runs.map(run => run.color)).toEqual([
      GOAL_TITLE_COLOR, 'red', DOCK_SEPARATOR_COLOR, 'white', DOCK_SEPARATOR_COLOR, GOAL_BODY_COLOR,
    ])
    expect(line.runs[0]?.exactColor).toBe(true)
    expect(line.runs.at(-1)?.exactColor).toBe(true)
  })

  it('retains run colors when a goal objective is truncated', () => {
    const line = goalDockLine('◈ goal', 'active', 'round 1/12', 'long objective text', 'active')
    const fitted = fitDockLine(line, stringWidth(line.text) - 5)
    expect(stringWidth(fitted.text)).toBeLessThanOrEqual(stringWidth(line.text) - 5)
    expect(fitted.text.endsWith('…')).toBe(true)
    expect(fitted.runs.at(-1)?.color).toBe(GOAL_BODY_COLOR)
    expect(fitted.runs.at(-1)?.exactColor).toBe(true)
  })
})
