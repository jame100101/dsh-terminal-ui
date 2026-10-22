#!/usr/bin/env node
// Real Ink renderer with an explicitly synthetic store; this is not host validation.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import * as nodePty from 'node-pty'
import xterm from '@xterm/headless'
const output = process.argv[2] ?? '.artifacts/evidence/phase2-dsh'
await mkdir(output, { recursive: true })
const sourceHead = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const trackedSources = ['packages/tui/tui/src/render.tsx', 'packages/tui/tui/src/theme.ts', 'packages/tui/tui/src/viewport.ts', 'packages/tui/tui/src/settings-chrome.ts', 'packages/tui/tui/tests/fixtures/pty-app.tsx']
const hashes = async () => Object.fromEntries(await Promise.all(trackedSources.map(async file => [file, createHash('sha256').update(await readFile(file)).digest('hex')])))
const sourceHashes = await hashes()
const scenarios = [['composer', '', /DSH/], ['chinese', '中文输入验收 😀', /中文输入验收/], ['slash', '/', /\/attach/], ['appearance', '/settings appearance\r', /Appearance/], ['tasks', '/tasks\r', /Tasks|tasks/], ['model', '/model\r', /Select model/], ['permissions', '/permissions\r', /Permissions and sandbox/]]
const captures = []
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
for (const [cols, rows] of [[120, 40], [80, 24]]) {
  for (const [name, input, expected] of scenarios) {
    const home = await mkdtemp(join(tmpdir(), 'dsh-grid-'))
    const env = { PATH: '/opt/homebrew/bin:/usr/bin:/bin', HOME: home, TERM: 'xterm-256color', COLORTERM: 'truecolor', FORCE_COLOR: '3', LANG: 'en_US.UTF-8', TUI_PTY_EMPTY_STATIC: '1', TUI_PTY_APPEARANCE: 'claude-terminal-dark' }
    const args = ['--import', 'tsx/esm', resolve('packages/tui/tui/tests/fixtures/pty-app.tsx')]
    const terminal = new xterm.Terminal({ cols, rows, allowProposedApi: true, scrollback: 0 })
    const pty = nodePty.spawn(process.execPath, args, { cols, rows, cwd: process.cwd(), name: env.TERM, env })
    let raw = ''
    let parsed = Promise.resolve()
    pty.onData(data => { raw += data; parsed = parsed.then(() => new Promise(resolve => terminal.write(data, resolve))) })
    terminal.onData(data => pty.write(data))
    try {
      await delay(2000)
      await parsed
      if (input) {
        pty.write(input.replace(/\r$/, ''))
        await delay(200)
        if (input.endsWith('\r')) pty.write('\r')
        await delay(800)
        await parsed
      }
      const buffer = terminal.buffer.active
      const lines = Array.from({ length: rows }, (_, y) => buffer.getLine(buffer.viewportY + y)?.translateToString(true) ?? '')
      assert.equal(buffer.type, 'alternate', `${name}: alternate screen missing`)
      assert.match(lines.join('\n'), expected, `${name}: expected UI not reached`)
      const cells = []
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const cell = buffer.getLine(buffer.viewportY + y)?.getCell(x)
        if (cell && (cell.getChars().trim() || cell.getBgColorMode())) cells.push({ x, y, text: cell.getChars(), width: cell.getWidth(), fgMode: cell.getFgColorMode(), fg: cell.getFgColor(), bgMode: cell.getBgColorMode(), bg: cell.getBgColor(), bold: !!cell.isBold(), dim: !!cell.isDim(), inverse: !!cell.isInverse() })
      }
      const prefix = `${cols}x${rows}-${name}`
      await writeFile(join(output, prefix + '.ansi'), raw)
      await writeFile(join(output, prefix + '.txt'), lines.join('\n') + '\n')
      await writeFile(join(output, prefix + '.json'), JSON.stringify({ sourceHead, cols, rows, name, buffer: buffer.type, cursor: { x: buffer.cursorX, y: buffer.cursorY }, args, env, cells }, null, 2) + '\n')
      captures.push({ prefix, cursor: { x: buffer.cursorX, y: buffer.cursorY }, lines: lines.filter(Boolean) })
      console.log(prefix + '\n' + lines.filter(Boolean).join('\n'))
    } finally { pty.kill(); terminal.dispose() }
  }
}
const geometry = []
for (const [cols, rows] of [[120, 40], [80, 24]]) {
  const dsh = JSON.parse(await readFile(join(output, `${cols}x${rows}-composer.json`), 'utf8'))
  const claude = JSON.parse(await readFile(`.artifacts/evidence/phase2-reference/${cols}x${rows}-composer.json`, 'utf8'))
  const bounds = data => {
    const horizontal = new Map()
    for (const c of data.cells) if (c.text === '─') { const line = horizontal.get(c.y) ?? []; line.push(c.x); horizontal.set(c.y, line) }
    return [...horizontal].filter(([, xs]) => xs.length > cols / 2).map(([y, xs]) => ({ y, from: Math.min(...xs), to: Math.max(...xs), count: xs.length }))
  }
  geometry.push({ cols, rows, dsh: { cursor: dsh.cursor, lines: bounds(dsh) }, claude: { cursor: claude.cursor, lines: bounds(claude) }, deltaCursor: { x: dsh.cursor.x - claude.cursor.x, y: dsh.cursor.y - claude.cursor.y } })
}
assert.deepEqual(await hashes(), sourceHashes, 'Renderer sources changed during capture; recapture required')
await writeFile(join(output, 'manifest.json'), JSON.stringify({ sourceHead, sourceHashes, capturedAt: new Date().toISOString(), kind: 'Real Ink PTY with synthetic empty store; no Harness execution, no physical screenshot', appearance: 'claude-terminal-dark', captures, geometry }, null, 2) + '\n')
