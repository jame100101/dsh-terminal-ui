#!/usr/bin/env node
/**
 * dsh-tui — the thin Claude Code-style launcher over `dsh --profile tui`.
 *
 * The wrapper only owns the UX: it parses the user-facing grammar, translates
 * it into the TUI app's internal flags, resolves the built `dsh` bin of its
 * dependency, spawns it with inherited stdio, forwards the two stop signals,
 * and passes the child's exit code through. Session queries, resume, fork,
 * agents, the TUI, and print rendering all stay inside the app.
 *
 * The module body runs only parsing/translation/spawn helpers; the CLI entry
 * executes under the `isMain` guard so tests can import the module safely.
 */

import { spawn } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Command } from 'commander'

const require = createRequire(import.meta.url)

/** Exit codes the wrapper itself reports (execution outcomes come from the child). */
const EXIT_OK = 0
const EXIT_FAILURE = 1
const EXIT_USAGE = 2
const EXIT_INTERRUPT = 130

/** This package's version, read from its own manifest (bin/ sits one level under the package root). */
function readVersion() {
  const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))
  return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
}

/** Whether a thrown value is a commander control-flow error (help, version, parse rejection). */
function isCommanderError(error) {
  return typeof error === 'object' && error !== null
    && typeof error.code === 'string' && error.code.startsWith('commander.')
    && typeof error.exitCode === 'number'
}

/** Declare the dsh-tui UX grammar on a fresh commander program. */
function buildProgram() {
  const program = new Command()
  program
    .name('dsh-tui')
    .description('the DeepSeek Harness terminal assistant (a thin launcher over dsh --profile tui)')
    .version(readVersion(), '-V, --version', 'output the version number')
    .argument('[task]', 'submit this task once the TUI starts')
    .option('-c, --continue', 'resume the most recently used session created in the current directory')
    .option('-r, --resume [session]', 'resume by id, id prefix, or title (bare: open the session picker)')
    .option('--fork-session', 'fork the resumed session at its last completed turn and switch to the fork (requires -c or -r <session>)')
    .option('-p, --print <task>', 'run one task non-interactively, print the assistant result, and exit')
    .addHelpText('after', `
Examples:
  dsh-tui
  dsh-tui "fix the failing test"
  dsh-tui -c
  dsh-tui -r
  dsh-tui -r session-123
  dsh-tui -c --fork-session
  dsh-tui -p "explain this project"
  dsh-tui -c -p "continue fixing the tests"
`)
  return program
}

/**
 * Translate one parsed UX flag set into the internal argv handed to
 * `dsh --profile tui`. Value-carrying flags use the `--flag=value` form so a
 * task or query starting with `-` can never be mistaken for an option.
 * Conflicts are usage mistakes and throw commander errors with exit code 2.
 * @param options - the parsed option object (task, continue, resume, forkSession, print).
 * @param program - the owning program, for usage errors.
 * @returns the internal argv, `--profile tui` first.
 */
export function translateDshTuiArgs(options, program) {
  const resumeValue = options.resume
  const hasResumeQuery = typeof resumeValue === 'string'
  const hasContinue = options.continue === true
  if (hasContinue && resumeValue !== undefined) {
    program.error('--continue and --resume are mutually exclusive', { exitCode: EXIT_USAGE })
  }
  if (options.print !== undefined && options.task !== undefined) {
    program.error('a positional task and --print cannot both be given', { exitCode: EXIT_USAGE })
  }
  if (options.forkSession === true && !hasContinue && !hasResumeQuery) {
    program.error('--fork-session requires --continue or --resume <session>', { exitCode: EXIT_USAGE })
  }
  if (options.print !== undefined && resumeValue === true) {
    program.error('--print needs an explicit session; a bare --resume opens the interactive picker', { exitCode: EXIT_USAGE })
  }
  const translated = ['--profile', 'tui']
  if (hasContinue) translated.push('--continue')
  if (resumeValue !== undefined) translated.push(hasResumeQuery ? `--resume=${resumeValue}` : '--resume')
  if (options.forkSession === true) translated.push('--fork-session')
  if (options.print !== undefined) translated.push(`--print=${options.print}`)
  else if (options.task !== undefined) translated.push(`--prompt=${options.task}`)
  return translated
}

/**
 * Parse the dsh-tui argv and translate it, writing commander's help/error
 * text through the supplied streams. Help and version throw a normalized
 * error with exit code 0 (nothing runs); every usage rejection throws with
 * exit code 2; a successful parse returns the internal argv.
 * @param argv - the raw CLI argv (without node and the script path).
 * @param streams - where commander writes (process streams in production, silent fakes in tests).
 * @returns the translated internal argv.
 */
export function parseDshTuiArgs(argv, streams = { stdout: process.stdout, stderr: process.stderr }) {
  const program = buildProgram()
  program.exitOverride()
  program.configureOutput({
    writeOut: text => void streams.stdout.write(text),
    writeErr: text => void streams.stderr.write(text),
  })
  let translated
  program.action((task, options) => {
    translated = translateDshTuiArgs({ task, ...options }, program)
  })
  try {
    program.parse([...argv], { from: 'user' })
  } catch (error) {
    if (!isCommanderError(error)) throw error
    // Help and version are successful terminations; every other rejection is
    // a usage mistake, regardless of commander's default exit code.
    const code = error.code === 'commander.helpDisplayed' || error.code === 'commander.version' ? EXIT_OK : EXIT_USAGE
    throw Object.assign(new Error(error.message), { code: error.code, exitCode: code })
  }
  return translated
}

/**
 * Resolve the launcher bin this wrapper spawns. The published package ships
 * the built dsh runtime inside `runtime/` (a self-contained closure of the
 * workspace packages, so installing it needs no registry package beyond the
 * external dependencies); the monorepo dev layout falls back to the
 * workspace-installed `@deepseek-ai/dsh` package.
 * @returns the absolute bin path.
 */
export function resolveDshBinPath() {
  const bundledManifestPath = fileURLToPath(new URL('../runtime/package.json', import.meta.url))
  try {
    const manifest = JSON.parse(readFileSync(bundledManifestPath, 'utf8'))
    const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.dsh
    if (typeof bin === 'string' && bin !== '') return join(dirname(bundledManifestPath), bin)
  } catch {
    // The bundled runtime is a release artifact; fall through to dev resolution.
  }
  const manifestPath = require.resolve('@deepseek-ai/dsh/package.json')
  const manifest = require('@deepseek-ai/dsh/package.json')
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.dsh
  if (typeof bin !== 'string' || bin === '') throw new Error('@deepseek-ai/dsh declares no dsh bin')
  return join(dirname(manifestPath), bin)
}

/**
 * Spawn `node <dsh bin> <translated>` with inherited stdio (a TTY must stay
 * inherited — the wrapper never captures or relays output), forward SIGINT
 * and SIGTERM to the child, and return the child's exit code. The child's
 * launcher owns teardown and its own signal exit codes; the wrapper only
 * mirrors what it reports.
 * @param translated - the internal argv (`--profile tui` first).
 * @param spawnImpl - the spawn function (real `spawn` in production, a fake in tests).
 * @param writeErr - diagnostic sink (process.stderr in production).
 * @returns the exit code to report.
 */
export async function runDsh(translated, spawnImpl = spawn, writeErr = process.stderr.write.bind(process.stderr)) {
  let dshBinPath
  try {
    dshBinPath = resolveDshBinPath()
  } catch (error) {
    writeErr(`dsh-tui: ${error instanceof Error ? error.message : String(error)}\n`)
    return EXIT_FAILURE
  }
  const child = spawnImpl(process.execPath, [dshBinPath, ...translated], { stdio: 'inherit' })
  const forward = (signal) => { try { child.kill(signal) } catch {} }
  const onSigint = () => forward('SIGINT')
  const onSigterm = () => forward('SIGTERM')
  process.on('SIGINT', onSigint)
  process.on('SIGTERM', onSigterm)
  let outcome
  try {
    outcome = await new Promise((resolvePromise, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => resolvePromise({ code, signal }))
    })
  } catch (error) {
    // The spawn itself failed (e.g. ENOENT): no child ever ran.
    writeErr(`dsh-tui: ${error instanceof Error ? error.message : String(error)}\n`)
    return EXIT_FAILURE
  } finally {
    process.off('SIGINT', onSigint)
    process.off('SIGTERM', onSigterm)
  }
  if (outcome.code !== null) return outcome.code
  if (outcome.signal === 'SIGINT') return EXIT_INTERRUPT
  if (outcome.signal === 'SIGTERM') return EXIT_OK
  return EXIT_FAILURE
}

/**
 * Whether this module is the process entry (vs. an import under tests). npm's
 * POSIX bin shims are symlinks: `process.argv[1]` then carries the symlink
 * path while ESM reports the real file path in `import.meta.url`, so both
 * sides are realpathed before the comparison — otherwise an installed
 * `dsh-tui` would silently no-op on Linux and macOS.
 */
function isMain() {
  const entry = process.argv[1]
  if (entry === undefined) return false
  try {
    return resolve(realpathSync(entry)) === resolve(fileURLToPath(import.meta.url))
  } catch {
    return resolve(entry) === resolve(fileURLToPath(import.meta.url))
  }
}

if (isMain()) {
  let translated
  try {
    translated = parseDshTuiArgs(process.argv.slice(2))
  } catch (error) {
    if (isCommanderError(error)) {
      process.exitCode = error.exitCode
    } else {
      throw error
    }
  }
  if (translated !== undefined) {
    process.exitCode = await runDsh(translated)
  }
}
