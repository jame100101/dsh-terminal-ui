/** Exercise the built UI against the isolated official host created by the clean-room check. */
import assert from 'node:assert/strict'
import { readFile, writeFile, realpath } from 'node:fs/promises'
import { dirname, join, resolve, basename } from 'node:path'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import * as nodePty from 'node-pty'
import xterm from '@xterm/headless'
const [evidencePath, outputPath] = process.argv.slice(2)
assert(evidencePath && outputPath, 'usage: verify-settings-edit-host.mjs <cleanroom.json> <output.json>')
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
let raw = ''
let parsed = Promise.resolve()
pty.onData(data => { raw += data; parsed = parsed.then(() => new Promise(resolve => terminal.write(data, resolve))) })
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
  await command('/settings models')
  await waitFor(screen => screen.join('\n').includes('DEEPSEEK_API_KEY'), 'credential reference')
  pty.write('DEEPSEEK_API_KEY'); await delay(300); pty.write('\r')
  await waitFor(screen => screen.some(line => line.includes('输入 API Key') || line.includes('Enter API key')), 'credential editor')
  const secret = 'sk-dsh-ui-fixture-not-valid-000000000000'
  pty.write(secret)
  await waitFor(screen => screen.join('\n').includes('••••'), 'masked credential input')
  assert(!raw.includes(secret), 'secret must never enter terminal output')
  pty.write('\r')
  await waitFor(screen => screen.some(line => line.includes('再次按 Enter') || line.includes('Enter again')), 'confirmation')
  pty.write('\r')
  await waitFor(screen => screen.some(line => line.includes('已写入') || line.includes('written')), 'credential persisted')
  assert((await readFile(join(home, '.credentials.yaml'), 'utf8')).includes(secret), 'official store persisted fixture credential')
  assert(!raw.includes(secret), 'confirmation and save must stay value-free')
  pty.write('\x1b'); await delay(300); pty.write('\x1b'); await delay(300)
  await command('/model')
  await waitFor(screen => screen.some(line => /○ deepseek-/u.test(line)), 'catalog refresh after credential save')
  const available = lines().filter(line => /[●○] deepseek-/u.test(line)).map(line => line.trim())
  const next = lines().find(line => /○ deepseek-/u.test(line))?.match(/○ (deepseek-[^ ]+)/u)?.[1]
  assert(next, 'a second real adapter model must exist')
  pty.write('\x1b[B'); await delay(250); pty.write('\r')
  await waitFor(screen => screen[1].startsWith(next + ' ·'), 'actual route switch')
  assert(!lines().some(line => /^\s*[▸ ]*[○●] (off|low|high|max)( |$)/u.test(line)), 'model picker must not masquerade effort rows as models')
  checks.push('masked credential editor and explicit confirmation', 'official local credential persistence (synthetic key, no request)', 'live official catalog refresh after save', 'actual second model selected and displayed', 'model and reasoning choices separated')
  const sha256 = createHash('sha256').update(await readFile(evidence.pluginTgz)).digest('hex')
  await writeFile(outputPath, JSON.stringify({ status: 'PASS', host: manifest.version, clean, dshHome: home, artifactSha256: sha256, available, selected: next, checks, screen: lines(), limitation: 'Synthetic credential only; no authenticated network model request or native macOS pixel evidence.' }, null, 2) + '\n')
} finally { pty.kill(); terminal.dispose() }
