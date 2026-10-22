/** Terminal-only appearance tokens. Fonts and default foreground belong to the terminal. */
export const APPEARANCES = ['claude-terminal-dark', 'claude-terminal-light'] as const
// Legacy values remain readable for existing profiles, never selectable in this version.
export type AppearanceId = typeof APPEARANCES[number] | 'dsh-classic'
export function currentAppearance(value?: AppearanceId): typeof APPEARANCES[number] {
  return value === 'claude-terminal-light' ? value : 'claude-terminal-dark'
}
export type ColorRole = 'foreground' | 'info' | 'brand' | 'muted' | 'selected' | 'success' | 'warning' | 'error' | 'border' | 'added' | 'removed'
export interface TerminalTheme {
  id: AppearanceId
  mode: 'dark' | 'light'
  colors: Record<ColorRole, string>
  diffBackground: { added: string; removed: string; addedWord: string; removedWord: string }
  geometry: { headerRows: number; panelPadding: number; menuMaxRows: number }
}
const classic: TerminalTheme = {
  id: 'dsh-classic', mode: 'dark',
  colors: { info: 'cyan', foreground: 'white', brand: 'cyan', muted: 'gray', selected: 'yellowBright', success: 'greenBright', warning: 'yellowBright', error: 'redBright', border: 'gray', added: 'greenBright', removed: 'redBright' },
  diffBackground: { added: '#022800', removed: '#3d0100', addedWord: '#155b22', removedWord: '#802020' },
  geometry: { headerRows: 4, panelPadding: 1, menuMaxRows: 8 },
}
/** Dark tokens observed in the local Claude 2.1.273 onboarding ANSI capture.
 * Light tokens are a readable provisional palette, pending like-for-like capture.
 * These names describe our terminal theme, not a claim of completed visual parity.
 */
export const TERMINAL_THEMES: Readonly<Record<AppearanceId, TerminalTheme>> = {
  'dsh-classic': classic,
  'claude-terminal-dark': {
    id: 'claude-terminal-dark', mode: 'dark',
    colors: { info: '#00afff', foreground: '#e5e5e5', brand: '#d77757', muted: '#999999', selected: '#b1b9f9', success: '#4eba65', warning: '#ffc107', error: '#dc5a5a', border: '#888888', added: '#50c850', removed: '#dc5a5a' },
    diffBackground: { added: '#022800', removed: '#3d0100', addedWord: '#155b22', removedWord: '#802020' },
    geometry: { headerRows: 3, panelPadding: 1, menuMaxRows: 8 },
  },
  'claude-terminal-light': {
    id: 'claude-terminal-light', mode: 'light',
    colors: { info: '#006b9f', foreground: '#222222', brand: '#a84828', muted: '#666666', selected: '#5769f7', success: '#2c7a39', warning: '#806000', error: '#cf222e', border: '#afafaf', added: '#248a3d', removed: '#cf222e' },
    diffBackground: { added: '#e6f4e8', removed: '#fce8e8', addedWord: '#a9dcb3', removedWord: '#f1b4b4' },
    geometry: { headerRows: 3, panelPadding: 1, menuMaxRows: 8 },
  },
}
export function isAppearance(value: string): value is AppearanceId {
  return (APPEARANCES as readonly string[]).includes(value)
}
export function terminalTheme(appearance: AppearanceId = 'dsh-classic', legacyMode: 'dark' | 'light' = 'dark'): TerminalTheme {
  const selected = TERMINAL_THEMES[appearance]
  return appearance === 'dsh-classic' ? { ...selected, mode: legacyMode } : selected
}
/** Degrade deliberately when the terminal cannot paint true color. */
export function themeColor(theme: TerminalTheme, role: ColorRole): string
export function themeColor(theme: TerminalTheme, role: ColorRole, colorDepth: number): string | undefined
export function themeColor(theme: TerminalTheme, role: ColorRole, colorDepth = 24): string | undefined {
  if (colorDepth < 4) return undefined
  if (colorDepth >= 24 || theme.id === 'dsh-classic') return theme.colors[role]
  const fallback: Record<ColorRole, string> = {
    info: 'cyan', foreground: theme.mode === 'dark' ? 'white' : 'black', brand: 'yellow', muted: 'gray', selected: 'blueBright', success: 'green', warning: 'yellow', error: 'red', border: 'gray', added: 'green', removed: 'red',
  }
  return fallback[role]
}

/** Preserve status semantics while keeping ordinary panel text neutral. */
export function panelTextColor(theme: TerminalTheme, color?: string, dim = false): string {
  if (color === 'red' || color === 'redBright') return themeColor(theme, 'error')
  if (color === 'yellow' || color === 'yellowBright') return themeColor(theme, 'warning')
  if (color === 'green' || color === 'greenBright') return themeColor(theme, 'success')
  return themeColor(theme, dim || color === 'gray' ? 'muted' : 'foreground')
}
