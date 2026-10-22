/** User-configured external editing, independent of terminal ownership and host persistence. */
import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { chmod, lstat, mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Parse argv quoting only. No shell expansion, pipelines, substitutions or implicit executable. */
export function parseEditorCommand(value: string): { command: string; args: string[] } {
  const words: string[] = []
  let word = ''; let quote = ''; let started = false
  for (let i = 0; i < value.length; i++) {
    const char = value[i]!
    if (quote) {
      if (char === quote) { quote = ''; continue }
      if (quote === '"' && char === '\\' && value[i + 1] === '"') { word += value[++i]; continue }
      word += char; continue
    }
    if (char === '"' || char === "'") { quote = char; started = true; continue }
    if (/\s/u.test(char)) { if (started) { words.push(word); word = ''; started = false }; continue }
    if (/[;|&<>`$\n\r]/u.test(char)) throw new Error('EDITOR supports executable arguments, not shell syntax')
    if (char === '\\' && /[\s"']/u.test(value[i + 1] ?? '')) { word += value[++i]; started = true; continue }
    word += char; started = true
  }
  if (quote) throw new Error('EDITOR contains an unclosed quote')
  if (started) words.push(word)
  const command = words.shift()
  if (!command) throw new Error('Set VISUAL or EDITOR to an editor executable (with --wait when needed)')
  return { command, args: words }
}

function aborted(): Error { return Object.assign(new Error('External editing cancelled; draft preserved'), { name: 'AbortError' }) }

/** Caller suspends Ink while this owns inherited terminal I/O, and applies text only to the same draft revision. */
export async function runExternalEditor(text: string, options: {
  cwd: string; signal?: AbortSignal; env?: NodeJS.ProcessEnv
}): Promise<string> {
  const env = options.env ?? process.env
  const configured = env.VISUAL?.trim() || env.EDITOR?.trim() || ''
  const { command, args } = parseEditorCommand(configured)
  if (options.signal?.aborted) throw aborted()
  const directory = await mkdtemp(join(tmpdir(), 'dsh-tui-editor-'))
  const file = join(directory, 'draft.txt')
  try {
    await chmod(directory, 0o700)
    await writeFile(file, text, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    await new Promise<void>((resolve, reject) => {
      if (options.signal?.aborted) { reject(aborted()); return }
      const child = spawn(command, [...args, file], { cwd: options.cwd, env, shell: false, stdio: 'inherit' })
      let cancelled = false
      let escalation: ReturnType<typeof setTimeout> | undefined
      const cancel = (): void => {
        if (cancelled) return
        cancelled = true
        child.kill('SIGTERM')
        // Cleanup waits for actual child close; an editor ignoring TERM cannot retain the draft file forever.
        escalation = setTimeout(() => { child.kill('SIGKILL') }, 1000)
      }
      const cleanup = (): void => { if (escalation) clearTimeout(escalation); options.signal?.removeEventListener('abort', cancel) }
      options.signal?.addEventListener('abort', cancel, { once: true })
      child.once('error', error => { cleanup(); reject(cancelled ? aborted() : new Error(`Could not launch configured editor: ${error.message}`)) })
      child.once('close', (code, signal) => {
        cleanup()
        if (cancelled) reject(aborted())
        else if (code !== 0) reject(new Error(`Editor exited ${signal ?? code}; draft preserved`))
        else resolve()
      })
    })
    if (options.signal?.aborted) throw aborted()
    // Editors may atomically replace the file. Read their regular replacement,
    // but never follow a substituted symlink into production files.
    const stat = await lstat(file)
    if (!stat.isFile() || stat.nlink !== 1) throw new Error('Editor output must be a regular private file; draft preserved')
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      if (!(await handle.stat()).isFile()) throw new Error('Editor output is not a regular file; draft preserved')
      const edited = await handle.readFile('utf8')
      if (options.signal?.aborted) throw aborted()
      return edited
    } finally { await handle.close() }
  } finally { await rm(directory, { recursive: true, force: true }) }
}
