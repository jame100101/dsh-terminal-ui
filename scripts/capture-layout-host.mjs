/** Capture actual isolated official-host PTY cells; HTML is a read-only replay, not the TUI renderer. */
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join, resolve, basename } from 'node:path'
import * as nodePty from 'node-pty'
import xterm from '@xterm/headless'
const [evidencePath, output] = process.argv.slice(2)
assert(evidencePath && output, 'usage: capture-layout-host.mjs <cleanroom.json> <output-directory>')
const evidence = JSON.parse(await readFile(evidencePath, 'utf8'))
const clean = await realpath(evidence.clean)
const home = await realpath(evidence.dshHome)
assert(basename(clean).startsWith('dsh-official-clean-') && basename(home).startsWith('dsh-official-home-'))
assert.equal(evidence.installedDsh, '0.2.1-rc.2')
const require = createRequire(join(clean, 'package.json'))
const manifestPath = require.resolve('@deepseek-ai/dsh/package.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const binary = resolve(dirname(manifestPath), manifest.bin.dsh)
await mkdir(output, { recursive: true })
const terminal = new xterm.Terminal({ cols: 80, rows: 24, allowProposedApi: true })
const pty = nodePty.spawn(process.execPath, [binary, '--profile', 'tui'], { cols: 80, rows: 24, cwd: clean, name: 'xterm-256color', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, DSH_HOME: home, TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: 'en_US.UTF-8', FORCE_COLOR: '3' } })
let raw = '', parsed = Promise.resolve()
pty.onData(data => { raw += data; parsed = parsed.then(() => new Promise(resolve => terminal.write(data, resolve))) })
terminal.onData(data => pty.write(data))
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const lines = () => Array.from({ length: terminal.rows }, (_, y) => terminal.buffer.active.getLine(y)?.translateToString(true) ?? '')
async function waitFor(predicate, label) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) { await delay(50); await parsed; if (predicate(lines())) return }
  throw new Error(`${label}: ${lines().join('\n')}`)
}
async function command(value) { pty.write(value); await delay(200); pty.write('\r'); await delay(250) }
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const palette = ['#000000','#cd3131','#0dbc79','#e5e510','#2472c8','#bc3fbc','#11a8cd','#e5e5e5','#666666','#f14c4c','#23d18b','#f5f543','#3b8eea','#d670d6','#29b8db','#ffffff']
function color(cell, fg) {
  const n = fg ? cell.getFgColor() : cell.getBgColor()
  if (fg ? cell.isFgRGB() : cell.isBgRGB()) return '#' + n.toString(16).padStart(6, '0')
  if (fg ? cell.isFgPalette() : cell.isBgPalette()) {
    if (n < 16) return palette[n]
    if (n >= 232) return `rgb(${Array(3).fill(8 + 10 * (n - 232)).join(',')})`
    const v = n - 16, levels = [0,95,135,175,215,255]
    return `rgb(${[Math.floor(v / 36), Math.floor(v / 6) % 6, v % 6].map(i => levels[i]).join(',')})`
  }
  return fg ? '#e5e5e5' : '#161616'
}
const captures = []
async function capture(name) {
  await delay(200); await parsed
  assert.equal(terminal.buffer.active.type, 'alternate')
  const cells = [], spans = []
  for (let y = 0; y < terminal.rows; y++) for (let x = 0; x < terminal.cols; x++) {
    const cell = terminal.buffer.active.getLine(y)?.getCell(x)
    if (!cell || cell.getWidth() === 0) continue
    const text = cell.getChars() || ' '
    let fg = color(cell, true), bg = color(cell, false)
    if (cell.isInverse()) [fg, bg] = [bg, fg]
    const data = { x, y, text, width: cell.getWidth(), fg, bg, bold: !!cell.isBold(), dim: !!cell.isDim() }
    cells.push(data)
    spans.push(`<span style="left:${x * 10}px;top:${y * 22}px;width:${cell.getWidth() * 10}px;color:${fg};background:${bg};font-weight:${data.bold ? 700 : 400};opacity:${data.dim ? 0.65 : 1}">${escape(text)}</span>`)
  }
  const data = { name, cols: terminal.cols, rows: terminal.rows, cursor: { x: terminal.buffer.active.cursorX, y: terminal.buffer.active.cursorY }, source: 'Actual official rc.2 host PTY; replay font is not the macOS Terminal font', cells, lines: lines() }
  await writeFile(join(output, `${name}.json`), JSON.stringify(data, null, 2) + '\n')
  await writeFile(join(output, `${name}.txt`), lines().join('\n') + '\n')
  const html = `<!doctype html><meta charset="utf-8"><title>DSH-TUI ${name} — actual PTY replay</title><style>body{margin:24px;background:#101010;color:#aaa;font:14px system-ui}h1{font-size:16px;font-weight:500}p{font-size:12px}section{position:relative;width:${terminal.cols * 10}px;height:${terminal.rows * 22}px;background:#161616;border:1px solid #444}span{position:absolute;height:22px;line-height:22px;white-space:pre;font:16px/22px Menlo,monospace}</style><h1>DSH-TUI · ${escape(name)} · Harness rc.2</h1><p>真实隔离宿主 PTY 画面重放 · 非 macOS Terminal 原生窗口截图 · ${terminal.cols} × ${terminal.rows}</p><section>${spans.join('')}</section>`
  await writeFile(join(output, `${name}.html`), html)
  captures.push({ name, cols: terminal.cols, rows: terminal.rows })
}
try {
  await waitFor(screen => screen.join('\n').includes('DSH-TUI'), 'startup'); await delay(400)
  await command('/theme claude-terminal-dark')
  await waitFor(screen => screen[0].includes('DSH-TUI') && screen[20].startsWith('❯'), 'appearance')
  // 60 columns exercise real catalog description wrapping without adding synthetic routes.
  terminal.resize(60, 24); pty.resize(60, 24); await delay(300)
  await command('/model'); await waitFor(screen => /Select model|选择模型/u.test(screen.join('\n')), 'models')
  await capture('model-60x24')
  pty.write('\x1b'); await waitFor(screen => screen[20].startsWith('❯'), 'model closes')
  terminal.resize(80, 24); pty.resize(80, 24); await delay(300)
  await command('/permissions'); await waitFor(screen => screen.some(line => line.includes('╭')) && screen.join('\n').includes('Sandbox ·'), 'permissions')
  await capture('permissions-80x24')
  pty.write('\x1b'); await waitFor(screen => screen[20].startsWith('❯'), 'permissions closes')
  await command('/settings general'); await waitFor(screen => /Send while running|运行时发送行为/u.test(screen.join('\n')), 'general')
  assert.equal(terminal.buffer.active.cursorX, 7)
  assert.equal(terminal.buffer.active.cursorY, 6)
  assert.equal(lines()[8].trim(), '')
  assert.equal(lines()[5].indexOf('╮'), 76)
  await capture('settings-80x24')
  pty.write('\x1b'); await waitFor(screen => screen[20].startsWith('❯'), 'settings closes')
  await capture('composer-80x24')
  await writeFile(join(output, 'capture.ansi'), raw)
  await writeFile(join(output, 'manifest.json'), JSON.stringify({ status: 'PASS', host: manifest.version, clean, dshHome: home, artifactSha256: createHash('sha256').update(await readFile(evidence.pluginTgz)).digest('hex'), captures, limitation: 'Actual official-host PTY cells, displayed with replay fonts. Not a native Terminal screenshot or physical IME evidence; no provider request.' }, null, 2) + '\n')
  console.log(JSON.stringify({ status: 'PASS', output, captures }))
} finally { pty.kill(); terminal.dispose() }
