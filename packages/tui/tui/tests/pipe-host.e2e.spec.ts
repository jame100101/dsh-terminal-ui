import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
const fixture = fileURLToPath(new URL('./fixtures/pipe-host.ts', import.meta.url))
async function run(args: string[], input = '', fail = false) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-pipe-test-'))
  const child = spawn(process.execPath, ['--import', 'tsx/esm', fixture, ...args], {
    env: { ...process.env, DSH_HOME: home, TUI_PIPE_FAIL: fail ? '1' : '0' }, stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stdout = ''; let stderr = ''
  child.stdout.on('data', data => { stdout += String(data) })
  child.stderr.on('data', data => { stderr += String(data) })
  child.stdin.end(input)
  const timer = setTimeout(() => child.kill('SIGKILL'), 30_000)
  try {
    const code = await new Promise<number | null>((resolve, reject) => { child.on('error', reject); child.on('exit', resolve) })
    expect(stdout + stderr).not.toMatch(/\x1b\[(?:\?|[0-9;]*[A-Za-z])/)
    const requests = await readFile(join(home, 'requests.json'), 'utf8').catch(error => { throw new Error(`${String(error)}\n${stderr}\n${stdout}`) })
    return { code, stdout, stderr, ...JSON.parse(requests) }
  } finally { clearTimeout(timer); child.kill(); await rm(home, { recursive: true, force: true }) }
}
it('executes --print through the real TUI host without terminal control or extra model turns', async () => {
  const result = await run(['--print', 'hello'])
  expect(result.code, result.stderr).toBe(0)
  expect(result.stdout).toBe('fixture plain answer\n')
  expect(result.requests).toBe(1)
}, 40_000)
it('drains piped lines before EOF and keeps UI-only commands away from the model', async () => {
  const result = await run([], '/settings\nhello\nsecond\n')
  expect(result.code, result.stderr).toBe(0)
  expect(result.stdout).toContain('fixture plain answer')
  expect(result.stdout).toContain('fixture second answer')
  expect(result.stdout).toContain('only available in the interactive TUI')
  expect(result.requests).toBe(2)
}, 40_000)
it('writes print-mode usage failures to stderr without a model request', async () => {
  const result = await run(['--print', '/settings'])
  expect(result.code).toBe(2)
  expect(result.stdout).toBe('')
  expect(result.stderr).toContain('only available in the interactive TUI')
  expect(result.requests).toBe(0)
}, 40_000)
it('returns the actual provider failure exit status in print mode', async () => {
  const result = await run(['--print', 'fail'], '', true)
  expect(result.code).toBe(1)
  expect(result.stderr).toContain('fixture request refused')
  expect(result.stdout).toBe('')
  expect(result.requests).toBe(1)
}, 40_000)
