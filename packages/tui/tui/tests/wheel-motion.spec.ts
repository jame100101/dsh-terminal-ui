import { describe, it, expect } from 'vitest'
import { createWheelMotion, wheelMotionStep, scrollOffsetForWheel } from '../src/mouse'
describe('reference wheel cadence', () => {
  it('moves one row per isolated native event, then ramps only in a tight burst', () => {
    const state = createWheelMotion()
    expect([0, 100, 200].map(time => wheelMotionStep(state, 'up', time))).toEqual([1, 1, 1])
    const burst = Array.from({ length: 30 }, (_, index) => wheelMotionStep(state, 'up', 210 + index * 10))
    expect(burst[0]).toBe(1)
    expect(burst.at(-1)).toBe(6)
    expect(Math.max(...burst)).toBe(6)
    expect(wheelMotionStep(state, 'up', 1000)).toBe(1)
    expect(wheelMotionStep(state, 'down', 1010)).toBe(1)
  })
  it('uses bounded decay for VS Code and does not amplify same-batch events', () => {
    const state = createWheelMotion(true)
    expect(wheelMotionStep(state, 'up', 0)).toBe(2)
    expect(wheelMotionStep(state, 'up', 1)).toBe(1)
    expect(wheelMotionStep(state, 'up', 20)).toBeGreaterThan(2)
    expect(wheelMotionStep(state, 'up', 1000)).toBe(2)
    expect(wheelMotionStep(state, 'down', 1020)).toBe(2)
  })
  it('clamps accumulated motion to history and restores follow at zero', () => {
    expect(scrollOffsetForWheel(9, 10, 'up', 6)).toBe(10)
    expect(scrollOffsetForWheel(2, 10, 'down', 6)).toBe(0)
  })
})
