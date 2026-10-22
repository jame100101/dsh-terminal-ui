import { readFile, stat } from 'node:fs/promises'
import { watchFile, unwatchFile } from 'node:fs'
import { parseKeybindings, type KeybindingConfig } from './keybindings'
/** Watch a profile-local file, retain last valid bindings on invalid atomic saves. */
export function watchKeybindings(path: string, publish: (config: KeybindingConfig) => void): () => void {
  let closed = false, generation = 0
  let current: KeybindingConfig = { bindings: [], path }
  const reload = async (): Promise<void> => {
    const gen = ++generation
    let next: KeybindingConfig
    try {
      if ((await stat(path)).size > 65536) throw new Error('Keybindings exceeds 64 KiB')
      next = { ...parseKeybindings(await readFile(path, 'utf8')), path }
    } catch (error) {
      next = (error as NodeJS.ErrnoException).code === 'ENOENT' ? { bindings: [], path } : { ...current, error: error instanceof Error ? error.message : String(error) }
    }
    if (!closed && gen === generation) { current = next; publish(next) }
  }
  const listener = (): void => { void reload() }
  watchFile(path, { interval: 500, persistent: false }, listener)
  void reload()
  return () => { closed = true; generation++; unwatchFile(path, listener) }
}
