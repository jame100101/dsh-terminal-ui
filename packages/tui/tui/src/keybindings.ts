/** Pure context/action translation. Both Ink consumers resolve the same stream;
 * translating before legacy handlers keeps editing, palette and draft semantics. */
export interface InputKey { [name: string]: boolean | number | string | undefined }
export type BindingContext = 'Global' | 'Chat' | 'Settings' | 'SessionPicker'
export interface Binding { context: BindingContext; keys: string[]; action: string | null }
export interface KeybindingConfig { bindings: readonly Binding[]; error?: string; path?: string; warnings?: readonly string[] }
const panelActions = new Set(['panel:up', 'panel:down', 'panel:pageUp', 'panel:pageDown', 'panel:close'])
const actions: Record<string, [string, string[]]> = {
  'panel:up': ['', ['upArrow']], 'panel:down': ['', ['downArrow']],
  'panel:pageUp': ['', ['pageUp']], 'panel:pageDown': ['', ['pageDown']],
  'panel:close': ['', ['escape']],
  'app:settings': ['', ['tuiSettings']],
  'chat:model': ['', ['tuiModel']], 'chat:permissions': ['', ['tuiPermissions']],
  'chat:sessions': ['', ['tuiSessions']], 'chat:background': ['', ['tuiBackground']],
  'chat:submit': ['', ['return']], 'chat:newline': ['', ['return', 'shift']],
  'chat:cancel': ['', ['escape']], 'chat:historySearch': ['r', ['ctrl']],
  'chat:stash': ['s', ['ctrl']],
  'chat:paste': ['v', ['ctrl']], 'chat:undo': ['_', ['ctrl']],
  'chat:redo': ['_', ['meta']], 'chat:yank': ['y', ['ctrl']],
  'chat:deleteWordBackward': ['w', ['ctrl']], 'chat:deleteToLineStart': ['u', ['ctrl']],
  'chat:deleteToLineEnd': ['k', ['ctrl']], 'chat:lineStart': ['a', ['ctrl']],
  'chat:lineEnd': ['e', ['ctrl']], 'app:clear': ['l', ['ctrl']],
  'app:exit': ['d', ['ctrl']], 'chat:cycleMode': ['', ['tab', 'shift']],
}
const names: Record<string, string> = { return: 'enter', escape: 'escape', tab: 'tab', backspace: 'backspace', delete: 'delete', upArrow: 'up', downArrow: 'down', leftArrow: 'left', rightArrow: 'right', home: 'home', end: 'end', pageUp: 'pageup', pageDown: 'pagedown' }
function normalize(value: string): string {
  return value.toLowerCase().replace(/command|cmd/g, 'super').replace(/option|alt/g, 'meta').replace(/return/g, 'enter').split('+').sort().join('+')
}
export function parseKeybindings(text: string): KeybindingConfig {
  if (new TextEncoder().encode(text).byteLength > 65536) throw new Error('Keybindings exceeds 64 KiB')
  const data = JSON.parse(text) as { bindings?: unknown }
  if (!data || !Array.isArray(data.bindings)) throw new Error('Expected bindings array')
  const result: Binding[] = []
  for (const section of data.bindings) {
    if (!section || !['Global', 'Chat', 'Settings', 'SessionPicker'].includes(section.context) || !section.bindings || typeof section.bindings !== 'object' || Array.isArray(section.bindings)) throw new Error('Supported contexts: Global, Chat, Settings, SessionPicker')
    for (const [sequence, action] of Object.entries(section.bindings)) {
      const keys = sequence.trim().split(/\s+/).map(normalize)
      const valid = (key: string): boolean => {
        const tokens = key.split('+'), modifiers = ['ctrl','shift','meta','super']
        const base = tokens.filter(token => !modifiers.includes(token))
        return new Set(tokens).size === tokens.length && base.length === 1 && (/^[a-z0-9_]$/.test(base[0]!) || Object.values(names).includes(base[0]!))
      }
      if (keys.length > 2 || keys.some(key => !valid(key))) throw new Error('Invalid key sequence')
      if (keys.includes(normalize('ctrl+c'))) throw new Error('Ctrl+C is reserved for interruption and copy')
      if (action !== null && (typeof action !== 'string' || !Object.hasOwn(actions, action))) throw new Error('Unknown action: ' + String(action))
      if (section.context === 'Global' && action !== null && !String(action).startsWith('app:')) throw new Error('Global accepts app actions only')
      const panel = section.context === 'Settings' || section.context === 'SessionPicker'
      if (action !== null && panel !== panelActions.has(String(action))) throw new Error('Panel actions require a panel context; panels accept navigation only')
      result.push({ context: section.context, keys, action: action as string | null })
      if (result.length > 256) throw new Error('At most 256 keybindings')
    }
  }
  const warnings = new Set<string>()
  for (let i = 0; i < result.length; i++) for (let j = i + 1; j < result.length; j++) {
    const a = result[i]!, b = result[j]!
    if (a.context !== b.context) continue
    if (a.keys.join(' ') === b.keys.join(' ')) warnings.add(`${a.context}: duplicate ${a.keys.join(' ')}; later binding wins`)
    else if (a.keys[0] === b.keys[0] && a.keys.length !== b.keys.length) warnings.add(`${a.context}: ambiguous chord prefix ${a.keys[0]}; use a unique prefix`)
  }
  return { bindings: result, ...(warnings.size ? { warnings: [...warnings] } : {}) }
}
export function inputStroke(input: string, key: InputKey): string | null {
  if (key.eventType === 'release' || input.includes('\x1b') || input.length > 1) return null
  const name = Object.keys(names).find(name => key[name])
  const letter = name ? names[name]! : input.toLowerCase()
  if (!letter) return null
  return normalize([...['ctrl','meta','super','shift'].filter(mod => key[mod]), letter].join('+'))
}
export class KeybindingResolver {
  reset(): void { this.pending = undefined }
  private pending: { keys: string[]; until: number; config: KeybindingConfig; context: string } | undefined
  resolve(config: KeybindingConfig | undefined, context: BindingContext | 'Protected', input: string, key: InputKey, now = Date.now()): { input: string; key: InputKey } | null {
    if (key.eventType === 'release') return null
    if (!config || context === 'Protected') { this.pending = undefined; return { input, key } }
    const stroke = inputStroke(input, key)
    if (!stroke) { this.pending = undefined; return { input, key } }
    if (this.pending && (this.pending.until < now || this.pending.config !== config || this.pending.context !== context)) this.pending = undefined
    if (this.pending && key.escape) { this.pending = undefined; return null }
    const prefix = this.pending?.keys ?? []
    this.pending = undefined
    const rules = [...config.bindings].reverse().filter(rule => rule.context === context || (context === 'Chat' && rule.context === 'Global'))
    // Chat owns conflicts ahead of Global; later entries override earlier entries.
    rules.sort((a,b) => Number(b.context === context)-Number(a.context === context))
    const sequence = [...prefix, stroke]
    let matched = sequence
    let rule = rules.find(rule => sequence.every((value,index) => rule.keys[index] === value))
    if (!rule && prefix.length) { matched = [stroke]; rule = rules.find(rule => rule.keys[0] === stroke) }
    if (!rule) return { input, key }
    if (rule.keys.length > matched.length) { this.pending = { keys: matched, until: now + 1000, config, context }; return null }
    if (rule.action === null) return null
    const [replacement, flags] = actions[rule.action]!
    return { input: replacement, key: Object.fromEntries(flags.map(flag => [flag, true])) }
  }
}

/** App owns these actions; the editor consumes them without touching the draft. */
export function keybindingCommand(key: InputKey): string | undefined {
  const commands: Record<string, string> = { tuiSettings: '/settings', tuiModel: '/model', tuiPermissions: '/permissions', tuiSessions: '/sessions', tuiBackground: '/bg' }
  return Object.entries(commands).find(([flag]) => key[flag] === true)?.[1]
}
