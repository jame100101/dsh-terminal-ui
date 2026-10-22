import { describe, expect, it } from 'vitest'
import { Config } from '../src/index'

describe('official schema appearance configuration', () => {
  it('defaults new and pre-appearance profiles to the current layout', () => {
    const config = Config({ theme: 'light', locale: 'en' })
    expect(config.appearance.get()).toBe('claude-terminal-dark')
    expect(config.theme.get()).toBe('light')
    expect(config.locale.get()).toBe('en')
  })
  it.each(['claude-terminal-dark', 'claude-terminal-light', 'dsh-classic'] as const)('accepts %s without changing execution settings', appearance => {
    const config = Config({ appearance, busyEnter: 'steer', keymap: 'legacy-dsh' })
    expect(config.appearance.get()).toBe(appearance)
    expect(config.busyEnter.get()).toBe('steer')
    expect(config.keymap.get()).toBe('legacy-dsh')
  })
  it('rejects unknown appearance names through the official schema validator', () => {
    expect(() => Config({ appearance: 'not-a-theme' })).toThrow()
  })
})
