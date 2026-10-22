/** Exercise the built UI against the isolated official host created by the clean-room check. */
import assert from 'node:assert/strict'
import { readFile, writeFile, realpath } from 'node:fs/promises'
import { dirname, join, resolve, basename } from 'node:path'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import * as nodePty from 'node-pty'
import xterm from '@xterm/headless'
const [evidencePath, outputPath] = process.argv.slice(2)
assert(evidencePath && outputPath, 'usage: verify-phase2-ui-host.mjs <cleanroom.json> <output.json>')
const evidence = JSON.parse(await readFile(evidencePath, 'utf8'))
const clean = await realpath(evidence.clean)
const home = await realpath(evidence.dshHome)
assert(basename(clean).startsWith('dsh-official-clean-') && basename(home).startsWith('dsh-official-home-'), 'only a generated clean-room installation is supported')
assert.equal(evidence.installedDsh, '0.2.1-rc.2')
const require = createRequire(join(clean, 'package.json'))
const manifestPath = require.resolve('@deepseek-ai/dsh/package.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const binary = resolve(dirname(manifestPath), manifest.bin.dsh)
const terminal = new xterm.Terminal({ cols: 120, rows: 40, allowProposedApi: true })
const pty = nodePty.spawn(process.execPath, [binary, '--profile', 'tui'], { cols: 120, rows: 40, cwd: clean, name: 'xterm-256color', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, DSH_HOME: home, TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: 'en_US.UTF-8', FORCE_COLOR: '3' } })
let parsed = Promise.resolve()
pty.onData(data => { parsed = parsed.then(() => new Promise(resolve => terminal.write(data, resolve))) })
terminal.onData(data => pty.write(data))
const lines = () => Array.from({ length: 40 }, (_, y) => terminal.buffer.active.getLine(terminal.buffer.active.viewportY + y)?.translateToString(true) ?? '')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function waitFor(predicate, label) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) { await delay(50); await parsed; if (predicate(lines())) return }
  throw new Error(`${label}: ${lines().join('\n')}`)
}
async function command(text) { pty.write(text); await delay(200); pty.write('\r'); await delay(250) }
const checks = []
try {
  await waitFor(screen => screen.join('\n').includes('DSH-TUI'), 'official startup')
  await delay(400)
  await command('/theme claude-terminal-dark')
  await waitFor(screen => screen[0].includes('DSH-TUI') && screen[36].startsWith('❯') && terminal.buffer.active.cursorX === 2, 'host-persisted appearance')
  checks.push('appearance via official host adapter')
  await command('/keymap claude-fullscreen')
  await waitFor(screen => screen.join('\n').includes('keymap: claude-fullscreen'), 'host-persisted keymap')
  const draft = '隔离验收🙂草稿'
  pty.write(draft)
  await waitFor(screen => screen[36].includes(draft), 'Unicode draft')
  pty.write('\x13')
  await waitFor(screen => !screen[36].includes(draft), 'stash')
  await command('/settings appearance')
  await waitFor(screen => screen[2].includes('▔') && screen.some(line => line.includes('claude-terminal-dark')), 'settings')
  pty.write('\x1b')
  await waitFor(screen => screen[36].startsWith('❯') && terminal.buffer.active.cursorX === 2, 'settings closes')
  await command('/model')
  await waitFor(screen => screen[25].includes('▔') && /Select model|选择模型/u.test(screen[26]), 'model bottom sheet')
  pty.write('\x1b')
  await waitFor(screen => screen[36].startsWith('❯'), 'model closes')
  await command('/permissions')
  await waitFor(screen => screen.some(line => /Permissions and sandbox|权限与沙箱/u.test(line)) && screen.some(line => /Ask when required|需要时询问/u.test(line)), 'permission bottom sheet')
  const english = lines().some(line => line.includes('Ask when required'))
  pty.write(english ? 'Never' : '不询问'); await delay(250); pty.write('\r')
  await waitFor(screen => screen.some(line => /● Never prompt|● 不询问/u.test(line)), 'never policy applied')
  pty.write('\x1b'); await delay(250)
  pty.write(english ? 'Ask when required' : '需要时询问'); await delay(250); pty.write('\r')
  await waitFor(screen => screen.some(line => /● Ask when required|● 需要时询问/u.test(line)), 'ask policy restored')
  pty.write('\x1b'); await delay(250); pty.write('\x1b')
  await waitFor(screen => screen[36].startsWith('❯'), 'permissions closes')
  checks.push('model and ask/never approval selection via official adapter')
  pty.write('\x13')
  await waitFor(screen => screen[36].includes(draft), 'restore after settings')
  checks.push('Unicode draft stash and settings restore')
  pty.write('\x0c'); await delay(400); pty.write('\x0c')
  await waitFor(screen => screen[36].includes(draft), 'double Ctrl+L retains draft')
  checks.push('double Ctrl+L retains draft (session identity covered by App tests)')
  // Real installed artifact: title-only sessions need no credentials or model calls.
  pty.write('\x15'); await delay(200)
  await command('/rename switch-verification-A')
  await waitFor(screen => screen.some(line => line.includes('→ switch-verification-A')), 'rename A')
  await command('/new')
  await delay(500)
  await command('/rename switch-verification-B')
  await waitFor(screen => screen.some(line => line.includes('→ switch-verification-B')), 'rename B')
  for (const title of ['switch-verification-A', 'switch-verification-B']) {
    await command(`/sessions ${title}`)
    await waitFor(screen => screen.some(line => line.includes(title) && /persisted|持久化/u.test(line) && line.includes('○')), `persisted ${title}`)
    pty.write('\r')
    await waitFor(screen => screen.some(line => /resumed session|已恢复会话/u.test(line)), `resume ${title}`)
    // Confirm the adapter remains callable after old-handle teardown.
    await command(`/rename ${title}-resumed`)
    await waitFor(screen => screen.some(line => line.includes(`→ ${title}-resumed`)), `live ${title}`)
  }
  checks.push('installed artifact creates two durable sessions, resumes both and keeps the host responsive')
  const sha256 = createHash('sha256').update(await readFile(evidence.pluginTgz)).digest('hex')
  await writeFile(outputPath, JSON.stringify({ status: 'PASS', host: manifest.version, clean, dshHome: home, artifactSha256: sha256, checks, screen: lines(), limitation: 'PTY Unicode injection is not physical IME. No provider request or real tool execution was performed.' }, null, 2) + '\n')
} finally { pty.kill(); terminal.dispose() }
