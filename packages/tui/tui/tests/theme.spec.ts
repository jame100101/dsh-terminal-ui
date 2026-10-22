import { describe, expect, it } from 'vitest'
import { panelTextColor, terminalTheme, themeColor, currentAppearance, isAppearance } from '../src/theme'

describe('panel semantic colors', () => {
  it.each(['claude-terminal-dark', 'claude-terminal-light'] as const)('preserves errors and warnings in %s', appearance => {
    const theme = terminalTheme(appearance)
    expect(panelTextColor(theme, 'red', true)).toBe(theme.colors.error)
    expect(panelTextColor(theme, 'yellow')).toBe(theme.colors.warning)
    expect(panelTextColor(theme, 'green')).toBe(theme.colors.success)
    expect(panelTextColor(theme, 'cyan')).toBe(theme.colors.foreground)
    expect(panelTextColor(theme, undefined, true)).toBe(theme.colors.muted)
    expect(themeColor(theme, 'foreground', 1)).toBeUndefined()
    expect(themeColor(theme, 'foreground', 4)).toBe(theme.mode === 'dark' ? 'white' : 'black')
  })
})

describe('current version appearance boundary', () => {
  it('reads legacy values without offering a switch to the legacy UI', () => {
    expect(currentAppearance('dsh-classic')).toBe('claude-terminal-dark')
    expect(currentAppearance()).toBe('claude-terminal-dark')
    expect(currentAppearance('claude-terminal-light')).toBe('claude-terminal-light')
    expect(isAppearance('dsh-classic')).toBe(false)
  })
})
