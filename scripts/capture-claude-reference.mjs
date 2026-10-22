#!/usr/bin/env node
// Captures public CLI output only. No installed source inspection or auth bypass.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import * as nodePty from 'node-pty'
import xterm from '@xterm/headless'
const output = process.argv[2] ?? '.artifacts/evidence/phase2-reference'
const binary = process.env.CLAUDE_REFERENCE_BINARY ?? '/opt/homebrew/bin/claude'
const version = execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim()
const help = execFileSync(binary, ['--help'], { encoding: 'utf8' })
await mkdir(output, { recursive: true })
await writeFile(join(output, 'cli-help.txt'), help)
const captures = []
const planOnly = process.argv.includes('--plan')
for (const [cols, rows] of [[120, 40], [80, 24]]) {
  const isolated = await mkdtemp(join(tmpdir(), 'dsh-claude-reference-'))
  const home = join(isolated, 'home')
  const cwd = join(isolated, 'workspace')
  await mkdir(home)
  await mkdir(cwd)
  await writeFile(join(cwd, 'reference-example.txt'), 'Isolated reference fixture. No model request.\n')
  const env = { PATH: '/opt/homebrew/bin:/usr/bin:/bin', HOME: home, CLAUDE_CONFIG_DIR: join(home, '.claude'), TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: 'en_US.UTF-8', CLAUDE_CODE_NO_FLICKER: '1', DISABLE_AUTOUPDATER: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1' }
  const args = ['--bare', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--setting-sources', '']
  if (planOnly) args.push('--permission-mode', 'plan')
  const terminal = new xterm.Terminal({ cols, rows, allowProposedApi: true, scrollback: 1000 })
  const pty = nodePty.spawn(binary, args, { cols, rows, cwd, name: env.TERM, env })
  let raw = ''
  let parsed = Promise.resolve()
  pty.onData(data => { raw += data; parsed = parsed.then(() => new Promise(resolve => terminal.write(data, resolve))) })
  terminal.onData(data => pty.write(data))
  const wait = async () => { await new Promise(resolve => setTimeout(resolve, 3000)); await parsed }
  const capture = async name => {
    const buffer = terminal.buffer.active
    const lines = Array.from({ length: rows }, (_, y) => buffer.getLine(buffer.viewportY + y)?.translateToString(true) ?? '')
    const cells = []
    for (let y = 0; y < rows; y++) {
      const line = buffer.getLine(buffer.viewportY + y)
      for (let x = 0; x < cols; x++) {
        const cell = line?.getCell(x)
        if (cell && (cell.getChars().trim() || cell.getBgColorMode())) cells.push({ x, y, text: cell.getChars(), width: cell.getWidth(), fgMode: cell.getFgColorMode(), fg: cell.getFgColor(), bgMode: cell.getBgColorMode(), bg: cell.getBgColor(), bold: !!cell.isBold(), dim: !!cell.isDim(), inverse: !!cell.isInverse() })
      }
    }
    const expected = { composer: /for shortcuts/, 'plan-composer': /plan mode on/, slash: /\/add-dir/, file: /reference-example\.txt/, model: /Select model/, config: /Search settings/, permissions: /Permissions/ }[name]
    if (expected) {
      assert.equal(buffer.type, 'alternate', `${name}: fullscreen not active`)
      assert.match(lines.join('\n'), expected, `${name}: expected local panel not reached`)
      assert.doesNotMatch(lines.join('\n'), /Not logged in/, `${name}: unexpected authentication error`)
    }
    const prefix = `${cols}x${rows}-${name}`
    await writeFile(join(output, `${prefix}.ansi`), raw)
    await writeFile(join(output, `${prefix}.txt`), lines.join('\n') + '\n')
    const metadata = { version, cols, rows, name, buffer: buffer.type, cursor: { x: buffer.cursorX, y: buffer.cursorY }, args, env, cwd, cells }
    await writeFile(join(output, `${prefix}.json`), JSON.stringify(metadata, null, 2) + '\n')
    captures.push({ prefix, screen: lines.filter(Boolean), buffer: buffer.type })
    console.log(prefix, lines.filter(Boolean).join('\n'))
    return lines.join('\n')
  }
  try {
    await wait()
    const initial = await capture('startup')
    if (/Choose the text style|Choose a theme|text style that looks best/i.test(initial)) {
      // Preview built-in light styling, then restore the displayed dark default.
      pty.write('\x1b[B')
      await wait()
      await capture('light-theme-preview')
      pty.write('\x1b[A')
      await wait()
      // Select default theme only; never answer login/trust prompts.
      pty.write('\r')
      await wait()
      const next = await capture('after-theme')
      if (/Security notes:/.test(next) && /Press Enter to continue/.test(next)) {
        pty.write('\r')
        await wait()
        const security = await capture('after-security-notice')
        if (/Yes, I trust this folder/.test(security)) {
          // This directory was created above and contains only our reference fixture.
          pty.write('\x1b[B\r')
          await wait()
          const composer = await capture(planOnly ? 'plan-composer' : 'composer')
          if (!planOnly && /Not logged in|How can I help|for shortcuts|Try |Welcome back/.test(composer)) {
            for (const [name, keys] of [['slash', '/'], ['file', '@'], ['model', '/model\r'], ['config', '/config\r'], ['permissions', '/permissions\r']]) {
              const inputLine = terminal.buffer.active.getLine(terminal.buffer.active.viewportY + rows - 3)?.translateToString(true).trim()
              if (inputLine !== '❯') throw new Error(`Refusing to send ${name}: composer is not empty (${inputLine})`)
              pty.write(keys)
              await wait()
              await capture(name)
              for (let attempt = 0; attempt < 3; attempt++) {
                pty.write('\x1b')
                await wait()
                const row = terminal.buffer.active.getLine(terminal.buffer.active.viewportY + rows - 3)?.translateToString(true).trim()
                if (row?.startsWith('❯')) break
              }
              pty.write('\x15')
              await wait()
            }
          }
        }
      }
    }
  } finally { pty.kill(); terminal.dispose() }
}
assert.equal(captures.length, planOnly ? 10 : 20, 'All expected frames at both sizes must be captured')
await writeFile(join(output, 'manifest.json'), JSON.stringify({ capturedAt: new Date().toISOString(), version, rendererRequested: 'fullscreen via CLAUDE_CODE_NO_FLICKER=1', captureKind: 'real CLI PTY plus headless xterm character cells; not a physical screenshot', auth: 'no credentials, no keychain (--bare), no inherited environment, local command capture only; no credentials supplied', captures }, null, 2) + '\n')
