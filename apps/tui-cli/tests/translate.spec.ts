import { EventEmitter } from 'node:events'
import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  INTERACTIVE_TERMINAL_RESET, parseDshTuiArgs, resolveDshBinPath, restoreInteractiveTerminal, runDsh,
  translateDshTuiArgs,
} from '../bin/dsh-tui.js'

/** Commander output goes nowhere in tests. */
const silent = { stdout: { write: () => {} }, stderr: { write: () => {} } }
/** Diagnostics go nowhere in tests. */
const noWrite = (): void => {}

/** A minimal command fake carrying only what translateDshTuiArgs uses. */
function fakeProgram() {
  return { error(message, options) { throw Object.assign(new Error(message), { code: 'commander.error', exitCode: options.exitCode }) } }
}

describe('translateDshTuiArgs', () => {
  it('translates the bare invocation to the profile boot', () => {
    expect(translateDshTuiArgs({}, fakeProgram())).toEqual(['--profile', 'tui'])
  })

  it('translates a positional task to --prompt', () => {
    expect(translateDshTuiArgs({ task: 'fix this bug' }, fakeProgram()))
      .toEqual(['--profile', 'tui', '--prompt=fix this bug'])
  })

  it('keeps a leading-dash task safe through the equals form', () => {
    expect(translateDshTuiArgs({ task: '-fix this' }, fakeProgram()))
      .toEqual(['--profile', 'tui', '--prompt=-fix this'])
  })

  it('translates -c/--continue, bare -r, and -r <query>', () => {
    expect(translateDshTuiArgs({ continue: true }, fakeProgram())).toEqual(['--profile', 'tui', '--continue'])
    expect(translateDshTuiArgs({ resume: true }, fakeProgram())).toEqual(['--profile', 'tui', '--resume'])
    expect(translateDshTuiArgs({ resume: 'session-123' }, fakeProgram()))
      .toEqual(['--profile', 'tui', '--resume=session-123'])
  })

  it('translates --fork-session with its base', () => {
    expect(translateDshTuiArgs({ continue: true, forkSession: true }, fakeProgram()))
      .toEqual(['--profile', 'tui', '--continue', '--fork-session'])
    expect(translateDshTuiArgs({ resume: 'session-1', forkSession: true }, fakeProgram()))
      .toEqual(['--profile', 'tui', '--resume=session-1', '--fork-session'])
  })

  it('translates -p and its resume companions', () => {
    expect(translateDshTuiArgs({ print: 'run the tests' }, fakeProgram()))
      .toEqual(['--profile', 'tui', '--print=run the tests'])
    expect(translateDshTuiArgs({ continue: true, print: 'run the tests' }, fakeProgram()))
      .toEqual(['--profile', 'tui', '--continue', '--print=run the tests'])
    expect(translateDshTuiArgs({ resume: 'session-1', print: 'run the tests' }, fakeProgram()))
      .toEqual(['--profile', 'tui', '--resume=session-1', '--print=run the tests'])
  })

  it('rejects conflicting and incomplete invocations with exit code 2', () => {
    const cases = [
      { continue: true, resume: 'session-1' },
      { continue: true, resume: true },
      { forkSession: true },
      { forkSession: true, resume: true },
      { print: 'a', task: 'b' },
      { print: 'a', resume: true },
    ]
    for (const options of cases) {
      expect(() => translateDshTuiArgs(options, fakeProgram())).toThrowError(expect.objectContaining({ exitCode: 2 }))
    }
  })
})

describe('parseDshTuiArgs', () => {
  it('parses the bare invocation', () => {
    expect(parseDshTuiArgs([], silent)).toEqual(['--profile', 'tui'])
  })

  it('parses the full flag surface', () => {
    expect(parseDshTuiArgs(['fix this bug'], silent)).toEqual(['--profile', 'tui', '--prompt=fix this bug'])
    expect(parseDshTuiArgs(['-c'], silent)).toEqual(['--profile', 'tui', '--continue'])
    expect(parseDshTuiArgs(['--continue'], silent)).toEqual(['--profile', 'tui', '--continue'])
    expect(parseDshTuiArgs(['-r'], silent)).toEqual(['--profile', 'tui', '--resume'])
    expect(parseDshTuiArgs(['--resume'], silent)).toEqual(['--profile', 'tui', '--resume'])
    expect(parseDshTuiArgs(['-r', 'session-123'], silent)).toEqual(['--profile', 'tui', '--resume=session-123'])
    expect(parseDshTuiArgs(['-c', '--fork-session'], silent)).toEqual(['--profile', 'tui', '--continue', '--fork-session'])
    expect(parseDshTuiArgs(['-r', 'session-1', '--fork-session'], silent))
      .toEqual(['--profile', 'tui', '--resume=session-1', '--fork-session'])
    expect(parseDshTuiArgs(['-p', 'run the tests'], silent)).toEqual(['--profile', 'tui', '--print=run the tests'])
    expect(parseDshTuiArgs(['-c', '-p', 'run the tests'], silent))
      .toEqual(['--profile', 'tui', '--continue', '--print=run the tests'])
    expect(parseDshTuiArgs(['-r', 'session-1', '-p', 'run the tests'], silent))
      .toEqual(['--profile', 'tui', '--resume=session-1', '--print=run the tests'])
  })

  it('treats -- as the end of flags', () => {
    expect(parseDshTuiArgs(['--', '-fix this'], silent)).toEqual(['--profile', 'tui', '--prompt=-fix this'])
  })

  it('throws exit code 2 on usage rejections, including commander defaults', () => {
    for (const argv of [
      ['--fork-session'],
      ['-c', '-r', 'session-1'],
      ['-p', 'a', 'b'],
      ['-r', '-p', 'task'],
      ['-p'],
      ['--bogus'],
    ]) {
      expect(() => parseDshTuiArgs(argv, silent)).toThrowError(expect.objectContaining({ exitCode: 2 }))
    }
  })

  it('throws exit code 0 on help and version', () => {
    expect(() => parseDshTuiArgs(['--help'], silent)).toThrowError(expect.objectContaining({ exitCode: 0 }))
    expect(() => parseDshTuiArgs(['-h'], silent)).toThrowError(expect.objectContaining({ exitCode: 0 }))
    expect(() => parseDshTuiArgs(['--version'], silent)).toThrowError(expect.objectContaining({ exitCode: 0 }))
  })
})

describe('resolveDshBinPath', () => {
  it('resolves the workspace dsh bin, not a leftover bundled runtime', () => {
    const bin = resolveDshBinPath()
    expect(bin).toMatch(/apps[/\\]cli[/\\]lib[/\\]bin\.js$/)
    expect(bin).not.toMatch(/tui-cli[/\\]runtime/)
  })
})

describe('runDsh', () => {
  /** A spawn fake that reports the given exit outcome on the next microtask. */
  function fakeSpawn(outcome) {
    const child = new EventEmitter()
    child.kill = () => {}
    queueMicrotask(() => {
      if (outcome.error !== undefined) child.emit('error', outcome.error)
      else child.emit('exit', outcome.code ?? null, outcome.signal ?? null)
    })
    return child
  }

  it('passes child exit codes through unchanged', async () => {
    expect(await runDsh(['--profile', 'tui'], () => fakeSpawn({ code: 0 }), noWrite)).toBe(0)
    expect(await runDsh(['--profile', 'tui'], () => fakeSpawn({ code: 1 }), noWrite)).toBe(1)
    expect(await runDsh(['--profile', 'tui'], () => fakeSpawn({ code: 130 }), noWrite)).toBe(130)
  })

  it('boots the TUI dependency graph through production React entry points', async () => {
    let spawnOptions
    await runDsh(['--profile', 'tui'], (_command, _args, options) => {
      spawnOptions = options
      return fakeSpawn({ code: 0 })
    }, noWrite)
    expect(spawnOptions).toMatchObject({
      stdio: 'inherit',
      env: { NODE_ENV: 'production' },
    })
  })

  it('maps signals to the launcher conventions', async () => {
    expect(await runDsh(['--profile', 'tui'], () => fakeSpawn({ signal: 'SIGINT' }), noWrite)).toBe(130)
    expect(await runDsh(['--profile', 'tui'], () => fakeSpawn({ signal: 'SIGTERM' }), noWrite)).toBe(0)
    expect(await runDsh(['--profile', 'tui'], () => fakeSpawn({ signal: 'SIGKILL' }), noWrite)).toBe(1)
  })

  it('reports a spawn failure as a failing exit', async () => {
    const outcome = await runDsh(['--profile', 'tui'], () => fakeSpawn({ error: new Error('ENOENT') }), noWrite)
    expect(outcome).toBe(1)
  })

  it('restores every interactive terminal mode after success, failure, or signal but skips print mode', async () => {
    let restores = 0
    const restore = () => { restores += 1 }
    expect(await runDsh(['--profile', 'tui'], () => fakeSpawn({ code: 0 }), noWrite, restore)).toBe(0)
    expect(await runDsh(['--profile', 'tui'], () => fakeSpawn({ code: 1 }), noWrite, restore)).toBe(1)
    expect(await runDsh(['--profile', 'tui'], () => fakeSpawn({ signal: 'SIGKILL' }), noWrite, restore)).toBe(1)
    expect(restores).toBe(3)
    expect(await runDsh(['--profile', 'tui', '--print=task'], () => fakeSpawn({ code: 0 }), noWrite, restore)).toBe(0)
    expect(restores).toBe(3)
  })

  it('writes an idempotent reset that disables mouse and paste modes and restores the screen', () => {
    const chunks: string[] = []
    restoreInteractiveTerminal({ isTTY: true, write: chunk => chunks.push(String(chunk)) })
    expect(chunks).toEqual([INTERACTIVE_TERMINAL_RESET])
    expect(INTERACTIVE_TERMINAL_RESET).toContain('\x1b[?1006l')
    expect(INTERACTIVE_TERMINAL_RESET).toContain('\x1b[?2004l')
    expect(INTERACTIVE_TERMINAL_RESET).toContain('\x1b[?25h')
    expect(INTERACTIVE_TERMINAL_RESET).toContain('\x1b[0 q')
    expect(INTERACTIVE_TERMINAL_RESET).toContain('\x1b[?1049l')
    restoreInteractiveTerminal({ isTTY: false, write: () => { throw new Error('not a tty') } })
    restoreInteractiveTerminal({
      isTTY: true,
      write: () => {
        throw new Error('closed')
      },
    })
  })
})

describe('symlink entrypoint', () => {
  // npm's POSIX bin shims are symlinks; the wrapper must recognize itself
  // as main when launched through one. Windows npm shims are .cmd files, so
  // this exact reproduction is POSIX-only.
  it.skipIf(process.platform === 'win32')('runs --version through a symlinked bin and exits 0', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-tui-symlink-'))
    const binPath = join(import.meta.dirname, '..', 'bin', 'dsh-tui.js')
    const linkPath = join(dir, 'dsh-tui')
    symlinkSync(binPath, linkPath)
    const manifest = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')) as { version: string }
    const { stdout, error } = await new Promise<{ stdout: string; error: Error | null }>((resolvePromise) => {
      execFile(process.execPath, [linkPath, '--version'], (error, stdout) => {
        resolvePromise({ stdout, error })
      })
    })
    expect(error).toBeNull()
    expect(stdout.trim()).toBe(manifest.version)
  })
})
