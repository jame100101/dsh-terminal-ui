import { describe, expect, it } from 'vitest'
import { PermissionCycleGate, isPermissionCycleKey } from '../src/permission-cycle'

function key(partial: Partial<{ shift: boolean; tab: boolean; return: boolean; eventType: 'press' | 'repeat' | 'release' }>): {
  shift: boolean
  tab: boolean
  return: boolean
  eventType?: 'press' | 'repeat' | 'release'
} {
  return {
    shift: partial.shift === true,
    tab: partial.tab === true,
    return: partial.return === true,
    ...(partial.eventType === undefined ? {} : { eventType: partial.eventType }),
  }
}

describe('permission cycle gate', () => {
  it('accepts Shift+Tab press and CSI Z, not Enter or Kitty release/repeat', () => {
    expect(isPermissionCycleKey('', key({ shift: true, tab: true }))).toBe(true)
    expect(isPermissionCycleKey('\x1b[Z', key({}))).toBe(true)
    expect(isPermissionCycleKey('', key({ shift: true, tab: true, eventType: 'press' }))).toBe(true)
    expect(isPermissionCycleKey('', key({ shift: true, tab: true, eventType: 'release' }))).toBe(false)
    expect(isPermissionCycleKey('', key({ shift: true, tab: true, eventType: 'repeat' }))).toBe(false)
    expect(isPermissionCycleKey('\r', key({ shift: true, tab: true, return: true }))).toBe(false)
    expect(isPermissionCycleKey('\x1b[Z\r', key({ shift: true, tab: true }))).toBe(false)
    expect(isPermissionCycleKey('', key({ tab: true }))).toBe(false)
  })

  it('rotates once for a Kitty press/repeat/release sequence', () => {
    const runs: number[] = []
    const gate = new PermissionCycleGate()
    expect(gate.request('', key({ shift: true, tab: true, eventType: 'press' }), () => { runs.push(1) })).toBe(true)
    expect(gate.request('', key({ shift: true, tab: true, eventType: 'repeat' }), () => { runs.push(2) })).toBe(false)
    expect(gate.request('', key({ shift: true, tab: true, eventType: 'release' }), () => { runs.push(3) })).toBe(false)
    expect(runs).toEqual([1])
  })

  it('rotates every distinct legacy Shift+Tab even when presses are close together', () => {
    const runs: number[] = []
    const gate = new PermissionCycleGate()
    expect(gate.request('\x1b[Z', key({}), () => { runs.push(1) })).toBe(true)
    expect(gate.request('\x1b[Z', key({}), () => { runs.push(2) })).toBe(true)
    expect(runs).toEqual([1, 2])
  })
})
