/** Real isolated tmux acceptance; never connects to a user's server or configuration. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const tmux = process.env.DSH_TEST_TMUX_BIN ?? (existsSync('/opt/homebrew/bin/tmux') ? '/opt/homebrew/bin/tmux' : 'tmux')
const directory = mkdtempSync('/tmp/dsh-tmux-')
const socket = join(directory, 'socket')
const pane = 'proof:0.0'
const invoke = (...args) => execFileSync(tmux, ['-S', socket, '-f', '/dev/null', ...args], { encoding: 'utf8', env: { ...process.env, TMUX: '' } }).trimEnd()
const quote = text => `'${text.replaceAll("'", "'\\''")}'`
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const capture = () => invoke('capture-pane', '-p', '-t', pane)
const completeFrame = () => { const lines = capture().split('\n'); return lines[0]?.includes('DSH-TUI') && lines.at(-1)?.startsWith('turn ') }
const state = () => invoke('display-message', '-p', '-t', pane, '#{alternate_on}|#{mouse_any_flag}|#{cursor_flag}|#{pane_width}|#{pane_height}|#{pane_current_command}')
async function waitFor(check, description, timeout = 15000) {
  const until = Date.now() + timeout
  while (Date.now() < until) { if (check()) return; await delay(50) }
  throw new Error(`${description}\n${capture()}\nstate=${state()}`)
}
const report = { status: 'FAIL', tool: execFileSync(tmux, ['-V'], { encoding: 'utf8' }).trim(), platform: process.platform,
  node: process.version, measuredAt: new Date().toISOString(), checks: {}, scope: 'Local isolated detached tmux server and real PTY; scripted store updates, no live provider or SSH transport.' }
try {
  invoke('new-session', '-d', '-x', '80', '-y', '24', '-s', 'proof', '-c', root, '/bin/sh')
  const before = join(directory, 'termios-before'); const after = join(directory, 'termios-after')
  const fixture = resolve(root, 'packages/tui/tui/tests/fixtures/pty-app.tsx')
  const command = `stty -g > ${quote(before)}; TUI_PTY_BUSY=1 TUI_PTY_UPDATE_MS=80 CI=false NODE_ENV=production FORCE_COLOR=0 ${quote(process.execPath)} --import tsx/esm ${quote(fixture)}; stty -g > ${quote(after)}; printf '\\nDSH_TMUX_EXIT_MARKER\\n'`
  invoke('send-keys', '-t', pane, '-l', command)
  invoke('send-keys', '-t', pane, 'Enter')
  await waitFor(() => capture().includes('DSH-TUI') && state().startsWith('1|'), 'TUI did not enter alternate screen')
  invoke('send-keys', '-t', pane, '-l', '中文 tmux draft 😀')
  await waitFor(() => capture().includes('中文 tmux draft 😀'), 'Unicode draft missing at 80x24')
  const initialScreen = capture()
  report.checks.unicodeDraft80x24 = { status: 'PASS', dimensions: [80, 24], screen: initialScreen }
  invoke('resize-window', '-t', 'proof:0', '-x', '52', '-y', '18')
  await waitFor(() => state().includes('|52|18|') && completeFrame() && capture().includes('中文 tmux draft 😀'), 'Draft missing after resize')
  report.checks.resize52x18 = { status: 'PASS', screen: capture() }
  invoke('resize-window', '-t', 'proof:0', '-x', '80', '-y', '24')
  await waitFor(() => state().includes('|80|24|') && completeFrame() && capture().includes('中文 tmux draft 😀'), 'Draft missing after restoring dimensions')
  // tmux reports new dimensions before the application has painted them;
  // wait past resize coalescing before exercising an independent scroll action.
  await delay(500)
  const beforeScroll = capture()
  invoke('send-keys', '-t', pane, 'PPage')
  await delay(250)
  const scrolled = capture()
  const visibleRows = text => [...text.matchAll(/第(\d+)行/gu)].map(match => Number(match[1]))
  const anchorRows = visibleRows(scrolled)
  assert(anchorRows.length > 0, 'Scroll check requires actual historical rows')
  assert(Math.min(...anchorRows) < Math.min(...visibleRows(beforeScroll)), 'PageUp did not move into history')
  await delay(600)
  const streaming = capture()
  report.checks.historyDuringUpdates = { status: 'FAIL', before: scrolled, after: streaming, beforeScroll }
  assert.deepEqual(visibleRows(streaming), anchorRows, 'Streaming updates moved the selected history viewport')
  assert.notEqual(streaming, scrolled, 'Fixture must produce real subsequent updates during the anchor assertion')
  report.checks.historyDuringUpdates = { status: 'PASS', visibleNodeIds: anchorRows, observedIntervalMs: 600,
    before: scrolled, after: streaming }
  invoke('send-keys', '-t', pane, 'C-c')
  await delay(120)
  invoke('send-keys', '-t', pane, 'C-c')
  await waitFor(() => existsSync(after) && capture().includes('DSH_TMUX_EXIT_MARKER'), 'TUI did not return to shell')
  const exitState = state().split('|')
  assert.equal(exitState[0], '0', 'Alternate screen remained active')
  assert.equal(exitState[1], '0', 'Mouse protocol remained active')
  assert.equal(exitState[2], '1', 'Cursor did not return visible')
  assert.equal(readFileSync(after, 'utf8'), readFileSync(before, 'utf8'), 'Shell termios was not restored')
  report.checks.exitRestoration = { status: 'PASS', alternateScreen: false, mouseActive: false, cursorVisible: true,
    termiosMatchesBefore: true, shellCommand: exitState[5] }
  report.status = 'PASS'
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error)
  throw error
} finally {
  try { invoke('kill-server') } catch {}
  rmSync(directory, { recursive: true, force: true })
  mkdirSync(resolve(root, '.artifacts/evidence'), { recursive: true })
  writeFileSync(resolve(root, '.artifacts/evidence/followup-tmux.json'), `${JSON.stringify(report, null, 2)}\n`)
}
console.log(JSON.stringify(report, null, 2))
