/** Real source entry, preserved acceptance credentials, no provider requests. */
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import * as nodePty from 'node-pty'
import xterm from '@xterm/headless'
const [home, destination] = process.argv.slice(2)
assert(home && destination)
const credential = join(home, '.credentials.yaml')
const before = await readFile(credential).catch(() => null)
const scratch = await mkdtemp(join(tmpdir(), 'dsh-source-test-'))
const image = join(scratch, 'test.png')
await writeFile(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGP4z8DwH4QZYAwAR8oH+WdZbrcAAAAASUVORK5CYII=', 'base64'))
const checks = []
for (let pass = 0; pass < 2; pass++) {
  const diagnostic = join(scratch, `runtime-${pass}.json`)
  const terminal = new xterm.Terminal({ cols: 120, rows: 40, allowProposedApi: true })
  const pty = nodePty.spawn(process.execPath, ['scripts/start-source.mjs'], {
    cwd: process.cwd(), cols: 120, rows: 40, name: 'xterm-256color',
    env: { PATH: process.env.PATH, HOME: process.env.HOME, DSH_TUI_ACCEPTANCE_HOME: home, DSH_TUI_RUNTIME_DIAGNOSTIC: diagnostic, TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: 'en_US.UTF-8' },
  })
  let parsed = Promise.resolve(), raw = '', exited = false
  pty.onExit(() => { exited = true })
  pty.onData(data => { raw += data; parsed = parsed.then(() => new Promise(resolve => terminal.write(data, resolve))) })
  terminal.onData(data => pty.write(data))
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
  const screen = () => Array.from({ length: 40 }, (_, y) => terminal.buffer.active.getLine(terminal.buffer.active.viewportY + y)?.translateToString(true) ?? '').join('\n')
  async function wait(test) {
    for (let n = 0; n < 500; n++) { await delay(100); await parsed; if (test(screen())) return; if (exited) break }
    throw new Error(`Source pass ${pass} failed:\n${screen()}\n${raw.slice(-3000)}`)
  }
  async function command(text) { pty.write(text); await delay(200); pty.write('\r') }
  try {
    await wait(text => text.includes('❯') && text.includes('DSH-TUI'))
    const runtime = JSON.parse(await readFile(diagnostic, 'utf8'))
    assert.equal(runtime.tuiModule, resolve('packages/tui/tui/lib/index.js'))
    assert(runtime.cordisContextIdentity && runtime.react.sameRuntime)
    if (pass === 0) {
      await command('/rename source-persistence-proof')
      await wait(text => text.includes('→ source-persistence-proof'))
      await command(`/attach ${image}`)
      await wait(text => text.includes('[Image #1]'))
      checks.push('source TUI reads and stores a real PNG attachment')
    } else {
      await command('/sessions source-persistence-proof')
      await wait(text => text.includes('source-persistence-proof') && /persisted|持久化/u.test(text))
      checks.push('session retained across two source builds and launches')
    }
  } finally { pty.kill(); await delay(300); terminal.dispose() }
}
const after = await readFile(credential).catch(() => null)
assert(before === null ? after === null : after !== null && before.equals(after), 'credential bytes changed')
checks.push('existing credential file unchanged; value not read into logs')
await writeFile(destination, JSON.stringify({ status: 'PASS', harness: '0.2.1-rc.2', sourceEntry: resolve('scripts/start-source.mjs'), home, checks, limitations: 'Named-pasteboard native conversion and keyboard tests are separate; no physical Cmd+V or provider image request.' }, null, 2) + '\n')
