/** Capture actual isolated official-host PTY cells; HTML is a read-only replay, not the TUI renderer. */
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join, resolve, basename } from 'node:path'
import * as nodePty from 'node-pty'
import xterm from '@xterm/headless'
import { useRendererUnicodeWidths } from '../packages/tui/tui/tests/fixtures/terminal-unicode.mjs'
const [home, output, appearance] = process.argv.slice(2)
const light = appearance === 'light'
assert(home && output && basename(home).startsWith('dsh-transcript-'), 'requires a new disposable preview home')
const require = createRequire(import.meta.url)
const manifest = JSON.parse(await readFile(require.resolve('@deepseek-ai/dsh/package.json'), 'utf8'))
assert.equal(manifest.version, '0.2.1-rc.2')
await mkdir(output, { recursive: true })
const terminal = new xterm.Terminal({ cols: 100, rows: 32, allowProposedApi: true })
// Use the renderer's Unicode widths; xterm's default Unicode 6 treats modern emoji as one cell.
useRendererUnicodeWidths(terminal)
const pty = nodePty.spawn(process.execPath, ['--import', 'tsx', 'packages/tui/tui/tests/fixtures/transcript-host.ts'], {
  cols: 100, rows: 32, cwd: process.cwd(), name: 'xterm-256color',
  env: { DSH_TEST_BASH: process.env.DSH_TEST_BASH ?? '', DSH_TEST_APPEARANCE: light ? 'claude-terminal-light' : 'claude-terminal-dark', PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, DSH_HOME: home, TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: 'en_US.UTF-8', FORCE_COLOR: '3' },
})
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
  const screen = lines()
  const composerRow = screen.findIndex(line => line.startsWith('❯'))
  assert(composerRow >= 2, 'composer has a dedicated status row')
  assert.equal(screen[composerRow].trim(), '❯', 'empty composer has no painted marker')
  assert.equal(terminal.buffer.active.cursorY, composerRow, 'native caret follows composer')
  assert.equal(terminal.buffer.active.cursorX, 2, 'native caret follows prompt spacing')
  assert((screen.at(-2).includes('Context:') || screen.at(-2).includes('Ctx ')) && screen.at(-2).includes('Cache:'), 'dedicated usage line above permission footer')
  assert(!screen.some(line => /Catapulting|Tip: Esc/.test(line)), 'no duplicate working indicator or tip')
  if (name.startsWith('diff-')) assert(screen.at(-2).includes('66%'), 'cache reflects scripted official usage event')
  if (name.startsWith('thinking-') || name.startsWith('tool-running-')) {
    assert(screen[composerRow - 2].includes('Esc cancel'), 'cancel is above composer')
    assert(screen[composerRow - 2].includes('effort'), 'effort shares activity row')
    assert(!screen.at(-1).includes('Esc cancel'), 'permission footer does not duplicate activity')
  }
  const cells = [], spans = []
  for (let y = 0; y < terminal.rows; y++) for (let x = 0; x < terminal.cols; x++) {
    const cell = terminal.buffer.active.getLine(y)?.getCell(x)
    if (!cell || cell.getWidth() === 0) continue
    const text = cell.getChars() || ' '
    let fg = color(cell, true), bg = color(cell, false)
    if (cell.isInverse()) [fg, bg] = [bg, fg]
    const data = { x, y, text, width: cell.getWidth(), fg, bg, bold: !!cell.isBold(), dim: !!cell.isDim(), italic: !!cell.isItalic(), underline: !!cell.isUnderline(), strikethrough: !!cell.isStrikethrough() }
    cells.push(data)
    spans.push(`<span style="left:${x * 10}px;top:${y * 22}px;width:${cell.getWidth() * 10}px;color:${fg};background:${bg};font-weight:${data.bold ? 700 : 400};opacity:${data.dim ? 0.65 : 1};font-style:${data.italic ? 'italic' : 'normal'};text-decoration:${[data.underline ? 'underline' : '', data.strikethrough ? 'line-through' : ''].join(' ')}">${escape(text)}</span>`)
  }
  if (name.startsWith('diff-')) {
    const ends = (light ? ['#e6f4e8', '#fce8e8'] : ['#022800', '#3d0100']).map(bg => Math.max(...cells.filter(cell => cell.bg === bg).map(cell => cell.x + cell.width)))
    assert.equal(ends[0], ends[1], 'added/deleted backgrounds share the same right edge')
    const diffColors = light ? ['#e6f4e8', '#fce8e8', '#a9dcb3', '#f1b4b4'] : ['#022800', '#3d0100', '#155b22', '#802020']
    const diffRows = [...new Set(cells.filter(cell => diffColors.includes(cell.bg)).map(cell => cell.y))]
    for (const y of diffRows) assert.equal(Math.max(...cells.filter(cell => cell.y === y && diffColors.includes(cell.bg)).map(cell => cell.x + cell.width)), ends[0], 'every wrapped Diff row has the same right edge')
    const tableTop = screen.findIndex(line => line.trimStart().startsWith('┌'))
    const tableBottom = screen.findIndex(line => line.trimStart().startsWith('└'))
    assert(tableBottom > tableTop, 'structured table is visible')
    const tableEdges = []
    for (let y = tableTop; y <= tableBottom; y++) tableEdges.push(Math.max(...cells.filter(cell => cell.y === y && /[│┐┤┘]/u.test(cell.text)).map(cell => cell.x)))
    assert.equal(new Set(tableEdges).size, 1, 'rich table row right borders align')
    for (const bg of light ? ['#a9dcb3', '#f1b4b4'] : ['#155b22', '#802020']) assert(cells.some(cell => cell.bg === bg && cell.text.trim()), 'changed words have stronger backgrounds')
    assert(cells.some(cell => cell.italic && cell.text === 'v'), 'table retains italic')
    assert(cells.some(cell => cell.strikethrough && cell.text === 'o'), 'table retains strike')
    assert(cells.some(cell => cell.underline && cell.text === 'd'), 'table retains link underline')
  }
  if (light) assert(cells.some(cell => cell.x === 0 && cell.y === 1 && cell.bg === '#fafafa'), 'light surface has a readable background')
  const data = { name, cols: terminal.cols, rows: terminal.rows, source: 'Actual official rc.2 host PTY; replay font is not the macOS Terminal font', cells, lines: lines() }
  await writeFile(join(output, `${name}.json`), JSON.stringify(data, null, 2) + '\n')
  await writeFile(join(output, `${name}.txt`), lines().join('\n') + '\n')
  const html = `<!doctype html><meta charset="utf-8"><title>DSH-TUI ${name} — actual PTY replay</title><style>body{margin:24px;background:#101010;color:#aaa;font:14px system-ui}h1{font-size:16px;font-weight:500}p{font-size:12px}section{position:relative;width:${terminal.cols * 10}px;height:${terminal.rows * 22}px;background:#161616;border:1px solid #444}span{position:absolute;height:22px;line-height:22px;white-space:pre;font:16px/22px Menlo,monospace}</style><h1>DSH-TUI · ${escape(name)} · Harness rc.2</h1><p>真实隔离宿主 PTY 画面重放 · 非 macOS Terminal 原生窗口截图 · ${terminal.cols} × ${terminal.rows}</p><section>${spans.join('')}</section>`
  await writeFile(join(output, `${name}.html`), html)
  captures.push({ name, cols: terminal.cols, rows: terminal.rows })
}
try {
  await waitFor(screen => screen.join('\n').includes('Welcome to DSH-TUI'), 'welcome')
  await capture('welcome-100x32')
  for (const mode of ['read only', 'workspace write']) {
    pty.write('\x1b[Z')
    await waitFor(screen => screen.at(-1).includes(`${mode} on`), `mode ${mode}`)
    await capture(`mode-${mode.replaceAll(' ', '-')}-100x32`)
  }
  await command('Update the isolated greeting file')
  await waitFor(screen => screen.join('\n').includes('Thinking…'), 'thinking')
  await capture('thinking-100x32')
  await writeFile(join(home, 'continue-thinking'), 'continue')
  await waitFor(screen => screen.join('\n').includes('Update(greeting.ts)'), 'tool')
  await capture('tool-running-100x32')
  await writeFile(join(home, 'continue-tool'), 'continue')
  await waitFor(screen => screen.join('\n').includes('The isolated file now contains'), 'answer')
  await waitFor(screen => screen.at(-1).includes('Shift+Tab'), 'turn idle')
  await delay(250); await parsed
  // Tool cards start collapsed; click the actual disclosure arrow using its terminal cell.
  const row = lines().findIndex(line => line.includes('Update(greeting.ts)') && line.includes('▶'))
  assert(row >= 0, 'completed tool disclosure exists')
  const text = lines()[row]
  pty.write(`\x1b[<0;${text.indexOf('▶') + 1};${row + 1}M`)
  await waitFor(screen => screen.join('\n').includes('@@ -1,1 +1,1 @@'), 'real diff')
  if (process.env.DSH_TEST_BASH === '1') {
    assert(lines().some(line => line.includes('Bash(uname -s)')), 'real command has a readable fallback title')
    assert(!lines().some(line => line.includes('\"command\":') || line.includes('\"description\":')), 'no raw argument JSON title')
  }
  await capture('diff-100x32')
  pty.resize(42, 44); terminal.resize(42, 44)
  await waitFor(screen => screen.some(line => line.startsWith('─') && line.length === 41), 'narrow resize')
  await capture('diff-42x44')
  if (process.env.DSH_TEST_BASH === '1') {
    const bashRow = lines().findIndex(line => line.includes('Bash(uname -s)') && line.includes('▶'))
    assert(bashRow >= 0, 'official bash disclosure exists')
    pty.write(`\x1b[<0;${lines()[bashRow].indexOf('▶') + 1};${bashRow + 1}M`)
    await waitFor(screen => screen.some(line => line.includes('Darwin')), 'official uname output')
    await capture('bash-42x44')
  }
  const edited = JSON.parse(await readFile(join(home, 'tool-evidence.json'), 'utf8'))
  assert.equal(await readFile(edited.path, 'utf8'), edited.newText)
  await writeFile(join(output, 'tool-evidence.json'), JSON.stringify(edited, null, 2) + '\n')
  await writeFile(join(output, 'capture.ansi'), raw)
  await writeFile(join(output, 'manifest.json'), JSON.stringify({ status: 'PASS', appearance: light ? 'light' : 'dark', host: manifest.version, dshHome: home, captures, limitation: 'Official rc.2 boot, loop, tool dispatcher and built TUI; scripted test model with explicit synthetic usage counters (340 uncached / 660 cached) and custom file-edit tool (optional official Bash uname subprocess). Real isolated file bytes verified. PTY replay uses renderer-matched scalar Unicode widths (not a test of native emoji shaping), not native screenshot or authenticated provider evidence.' }, null, 2) + '\n')
  console.log(JSON.stringify({ status: 'PASS', output, home, captures }))
} finally { pty.kill(); terminal.dispose() }
