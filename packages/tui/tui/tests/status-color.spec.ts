import { describe, expect, it } from 'vitest'
import stringWidth from 'string-width'
import {
  fitDockLine, GOAL_LINE_COLOR, goalDockLine, TODO_LINE_COLOR, todoDockLine,
} from '../src/status-color'

describe('todo and goal status colors', () => {
  it('uses one quiet exact color for the complete todo line', () => {
    const line = todoDockLine('todo', '2 in progress', '3 pending', '1 done')
    expect(line.text).toBe('todo 2 in progress · 3 pending · 1 done')
    expect(line.color).toBe(TODO_LINE_COLOR)
    expect(line.exactColor).toBe(true)
    expect(line.runs).toEqual([{ text: line.text, color: TODO_LINE_COLOR, exactColor: true }])
  })

  it('uses one quiet exact color for the complete goal line', () => {
    const line = goalDockLine('◈ goal', 'blocked', 'round 1/12', 'stop')
    expect(line.text).toBe('◈ goal [blocked] · round 1/12 · stop')
    expect(line.color).toBe(GOAL_LINE_COLOR)
    expect(line.color).toBe('#61D6D6')
    expect(line.exactColor).toBe(true)
    expect(line.runs).toEqual([{ text: line.text, color: GOAL_LINE_COLOR, exactColor: true }])
  })

  it('retains the uniform goal color when the objective is truncated', () => {
    const line = goalDockLine('◈ goal', 'active', 'round 1/12', 'long objective text')
    const fitted = fitDockLine(line, stringWidth(line.text) - 5)
    expect(stringWidth(fitted.text)).toBeLessThanOrEqual(stringWidth(line.text) - 5)
    expect(fitted.text.endsWith('…')).toBe(true)
    expect(fitted.runs.at(-1)?.color).toBe(GOAL_LINE_COLOR)
    expect(fitted.runs.at(-1)?.exactColor).toBe(true)
  })
})
