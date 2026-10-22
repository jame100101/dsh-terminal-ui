import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as nodePty from 'node-pty'
import xterm from '@xterm/headless'
import { expect, it } from 'vitest'

// Exercise the mounted plugin's Cordis injection boundary, not the root test
// context: root-level adapter tests cannot detect missing plugin dependencies.
it('rewinds to an earlier completed turn in a new session without changing workspace files', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-switch-test-'))
  const terminal = new xterm.Terminal({ cols: 110, rows: 35, allowProposedApi: true })
  const fixture = fileURLToPath(new URL('./fixtures/pipe-host.ts', import.meta.url))
  const child = nodePty.spawn(process.execPath, ['--import', 'tsx/esm', fixture], {
    cwd: process.cwd(), cols: 110, rows: 35, name: 'xterm-256color',
    env: { ...process.env, DSH_HOME: home, HOME: home, CI: 'false', TERM: 'xterm-256color' },
  })
  let output = ''
  let exited = false
  let parsed = Promise.resolve()
  child.onExit(() => { exited = true })
  child.onData(data => {
    output += data
    parsed = parsed.then(() => new Promise<void>(resolve => terminal.write(data, resolve)))
  })
  terminal.onData(data => child.write(data))
  const screen = () => Array.from({ length: terminal.rows }, (_, y) => terminal.buffer.active.getLine(y)?.translateToString(true) ?? '').join('\n')
  const until = async (predicate: (screen: string) => boolean) => {
    await expect.poll(async () => {
      await parsed
      if (exited) throw new Error(`Host exited during session switch:\n${output}`)
      return predicate(screen())
    }, { timeout: 15_000 }).toBe(true).catch(error => { throw new Error(`${String(error)}\n${screen()}`) })
  }
  const command = async (text: string) => {
    child.write(text)
    await until(frame => frame.split('\n').some(line => line.trim().startsWith('❯') && line.trim().replace(/^❯\s*/u, '') === text))
    child.write('\r')
    await until(frame => !frame.split('\n').some(line => line.trim().startsWith('❯') && line.trim().replace(/^❯\s*/u, '') === text))
  }
  // Inspect the official session header, independent of the selected appearance.
  const sessionId = async () => {
    await command('/session-source')
    await until(text => /"id": "session-[a-f0-9-]+"/u.test(text))
    const id = screen().match(/"id": "(session-[a-f0-9-]+)"/u)?.[1]
    child.write('\x1b')
    await until(text => !text.includes('DSH-TUI masked session source'))
    return id
  }
  try {
    await until(text => text.includes('DSH-TUI'))
    const a = await sessionId()
    expect(a).toBeTruthy()
    const sentinel = join(home, 'workspace', 'keep.txt')
    await writeFile(sentinel, 'untouched workspace data')
    await command('first turn')
    await until(text => text.includes('fixture plain answer'))
    await command('second turn')
    await until(text => text.includes('fixture second answer'))
    await command('/rewind')
    await until(text => text.includes('After turn 1') && text.includes('After turn 2'))
    child.write('\x1b[B')
    await new Promise(resolve => setTimeout(resolve, 200))
    child.write('\r')
    await until(text => text.includes('Conversation restored; files unchanged'))
    expect(await sessionId()).not.toBe(a)
    expect(screen()).toContain('fixture plain answer')
    expect(screen()).not.toContain('fixture second answer')
    expect(await readFile(sentinel, 'utf8')).toBe('untouched workspace data')
    await command('continue after rewind')
    await until(text => text.includes('fixture third answer'))
    expect(output).not.toContain('without inject')
    expect(output).not.toContain('registration is not active')
    expect(exited).toBe(false)
  } finally {
    child.kill()
    await new Promise(resolve => setTimeout(resolve, 200))
    terminal.dispose()
    await rm(home, { recursive: true, force: true })
  }
}, 75_000)
