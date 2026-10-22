import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as nodePty from 'node-pty'
import xterm from '@xterm/headless'
import { expect, it } from 'vitest'

// Exercise the mounted plugin's Cordis injection boundary, not the root test
// context: root-level adapter tests cannot detect missing plugin dependencies.
it('parks a running Agent and resumes the same live session without losing its completion', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-switch-test-'))
  const terminal = new xterm.Terminal({ cols: 110, rows: 35, allowProposedApi: true })
  const fixture = fileURLToPath(new URL('./fixtures/pipe-host.ts', import.meta.url))
  const child = nodePty.spawn(process.execPath, ['--import', 'tsx/esm', fixture], {
    cwd: process.cwd(), cols: 110, rows: 35, name: 'xterm-256color',
    env: { ...process.env, DSH_HOME: home, HOME: home, CI: 'false', TUI_PIPE_DELAY: '1', TUI_PIPE_NOTIFY: '1', TERM_PROGRAM: 'iTerm.app', TERM: 'xterm-256color' },
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
    }, { timeout: 15_000 }).toBe(true).catch(error => { throw new Error(`${String(error)}\nLast terminal frame:\n${screen()}`) })
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
    await command('resident task')
    await until(text => text.includes('resident task'))
    await command('/bg')
    await until(text => text.includes('Live / persisted sessions'))
    child.write('\x1b')
    await until(text => text.includes('Welcome to DSH-TUI'))
    expect(await sessionId()).not.toBe(a)
    await new Promise(resolve => setTimeout(resolve, 3000))
    await command('/sessions resident task')
    await until(text => text.includes('resident task') && text.includes('Live / persisted sessions'))
    child.write('\r')
    await until(text => text.includes('fixture plain answer'))
    expect(await sessionId()).toBe(a)
    expect(output.split('\x1b]9;DSH-TUI: Task complete\x07').length - 1).toBe(1)
    await command('after resident resume')
    await until(text => text.includes('fixture second answer'))
    expect(output).not.toContain('cancelled')
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
