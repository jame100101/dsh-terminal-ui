#!/usr/bin/env node
/**
 * dsh-tui — the thin Claude Code-style launcher over `dsh --profile tui`.
 *
 * The wrapper only owns the UX: it parses the user-facing grammar, translates
 * it into the TUI app's internal flags, resolves a compatible official `dsh`
 * bin, spawns it with inherited stdio, forwards the two stop signals,
 * and passes the child's exit code through. Session queries, resume, fork,
 * agents, the TUI, and print rendering all stay inside the app.
 *
 * The module body runs only parsing/translation/spawn helpers; the CLI entry
 * executes under the `isMain` guard so tests can import the module safely.
 */

import { spawn } from 'node:child_process'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Command } from 'commander'

/** Exit codes the wrapper itself reports (execution outcomes come from the child). */
const EXIT_OK = 0
const EXIT_FAILURE = 1
const EXIT_USAGE = 2
const EXIT_INTERRUPT = 130
const TUI_PLUGIN_NAME = '@jame100101/dsh-tui'

/** Idempotent reset for every terminal mode the interactive TUI may enable. */
export const INTERACTIVE_TERMINAL_RESET = [
  '\x1b[?1000l',
  '\x1b[?1002l',
  '\x1b[?1003l',
  '\x1b[?1006l',
  '\x1b[?2004l',
  '\x1b[?25h',
  '\x1b[0 q',
  '\x1b[?1049l',
  '\x1b[0m',
].join('')

/**
 * Restore the parent terminal after an interactive child exits, including a
 * native fatal exit that bypassed every cleanup hook in the child process.
 * @param stream - parent stdout, or a terminal fixture under tests.
 * @returns nothing.
 */
export function restoreInteractiveTerminal(stream = process.stdout) {
  if (stream.isTTY !== true) return
  try {
    stream.write(INTERACTIVE_TERMINAL_RESET)
  } catch {
    // Parent stdout may already be closed after a native child fatal.
  }
}

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

/** Harness versions this plugin-mode launcher will spawn. */
export const COMPATIBLE_DSH_VERSIONS = Object.freeze(['0.1.2-rc.1'])

/**
 * Whether a dsh package version is in the plugin-mode compatibility set.
 * @param version - the `package.json` version of `@deepseek-ai/dsh`.
 * @returns true when plugin mode may spawn that install.
 */
export function isCompatibleDshVersion(version) {
  return COMPATIBLE_DSH_VERSIONS.includes(version)
}

/**
 * Read the dsh package version next to a JS bin (`lib/bin.js` → `package.json`).
 * @param jsPath - absolute path to the dsh JS entry.
 * @returns the version string, or undefined when the manifest is missing.
 */
export function readDshVersionFromBin(jsPath) {
  try {
    const manifest = JSON.parse(readFileSync(join(dirname(jsPath), '..', 'package.json'), 'utf8'))
    return typeof manifest.version === 'string' ? manifest.version : undefined
  } catch {
    return undefined
  }
}

/**
 * Resolve an official dsh JS bin from `DSH_BIN` or PATH. Never installs.
 * @param env - process environment (injectable under tests).
 * @returns the absolute JS bin path.
 * @throws when no compatible official dsh is configured or found.
 */
export function resolveOfficialDshBin(env = process.env) {
  const configured = env.DSH_BIN
  if (typeof configured === 'string' && configured !== '') {
    const jsPath = canonicalFile(resolve(configured)) ?? resolve(configured)
    const version = readDshVersionFromBin(jsPath)
    if (!isCompatibleDshVersion(version ?? '')) {
      throw new Error(`DSH_BIN is not a compatible dsh ${COMPATIBLE_DSH_VERSIONS.join(', ')} (got ${version ?? 'unknown'})`)
    }
    return jsPath
  }
  const fromPath = lookupDshCommand(env)
  if (fromPath === undefined) {
    throw new Error(`no official dsh on PATH; install @deepseek-ai/dsh@${COMPATIBLE_DSH_VERSIONS[0]} or set DSH_BIN`)
  }
  const jsPath = officialJsFromCommand(fromPath)
  if (jsPath === undefined) {
    throw new Error(`PATH dsh ${fromPath} has no @deepseek-ai/dsh JS bin`)
  }
  const version = readDshVersionFromBin(jsPath)
  if (!isCompatibleDshVersion(version ?? '')) {
    throw new Error(`PATH dsh is not a compatible ${COMPATIBLE_DSH_VERSIONS.join(', ')} (got ${version ?? 'unknown'})`)
  }
  return jsPath
}

/**
 * Locate `dsh` on PATH without a shell.
 * @param env - environment providing PATH.
 * @returns the first resolved command path, or undefined.
 */
function lookupDshCommand(env) {
  const pathEntry = Object.entries(env).find(([name]) => name.toUpperCase() === 'PATH')?.[1]
  if (typeof pathEntry !== 'string' || pathEntry === '') return undefined
  const pathExt = Object.entries(env).find(([name]) => name.toUpperCase() === 'PATHEXT')?.[1]
  const extensions = process.platform === 'win32'
    ? (typeof pathExt === 'string' && pathExt !== '' ? pathExt.split(';') : ['.COM', '.EXE', '.BAT', '.CMD'])
    : []
  const names = process.platform === 'win32'
    ? ['dsh', ...extensions.map(extension => `dsh${extension}`), 'dsh.js']
    : ['dsh', 'dsh.js']
  for (const rawDir of pathEntry.split(delimiter)) {
    const unquoted = rawDir.startsWith('"') && rawDir.endsWith('"') ? rawDir.slice(1, -1) : rawDir
    for (const name of names) {
      const candidate = resolve(unquoted === '' ? '.' : unquoted, name)
      if (canonicalFile(candidate) !== undefined) return candidate
    }
  }
  return undefined
}

/** Return one existing regular file in canonical filesystem spelling. */
function canonicalFile(path) {
  try {
    if (!statSync(path).isFile()) return undefined
    return realpathSync(path)
  } catch {
    return undefined
  }
}

/**
 * Map an npm/global `dsh` shim to its JS entry.
 * @param commandPath - PATH resolution of `dsh` or `dsh.cmd`.
 * @returns the JS bin, or undefined when the layout is unrecognized.
 */
function officialJsFromCommand(commandPath) {
  const canonicalCommand = canonicalFile(commandPath)
  if (canonicalCommand === undefined) return undefined
  if (canonicalCommand.endsWith('.js')) return canonicalCommand
  const commandDir = dirname(resolve(commandPath))
  const canonicalDir = dirname(canonicalCommand)
  const candidates = [
    join(commandDir, 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
    join(commandDir, '../@deepseek-ai/dsh/lib/bin.js'),
    join(canonicalDir, 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
    join(canonicalDir, '../@deepseek-ai/dsh/lib/bin.js'),
  ]
  for (const candidate of candidates) {
    const canonical = canonicalFile(candidate)
    if (canonical !== undefined) return canonical
  }
  return undefined
}

/**
 * Check the installed `tui` profile through the compatible official dsh
 * installation's public home-path resolver. The launcher does not guess the
 * default home and does not create or mutate a profile.
 * @param dshBinPath - compatible official dsh JS entry.
 * @param env - launcher environment.
 * @returns an actionable diagnostic when the TUI bundle is absent.
 */
export async function missingTuiProfileMessage(dshBinPath, env = process.env) {
  const officialRequire = createRequire(dshBinPath)
  const homePathsEntry = officialRequire.resolve('@deepseek-ai/dsh-home-paths')
  const homePaths = await import(pathToFileURL(homePathsEntry).href)
  const dshHome = homePaths.resolveDshHome(undefined, env)
  const profileManifestPath = join(dshHome, 'profiles', 'tui', 'package.json')
  let manifest
  try {
    manifest = JSON.parse(readFileSync(profileManifestPath, 'utf8'))
  } catch (error) {
    if (error instanceof SyntaxError || error?.code !== 'ENOENT') throw error
  }
  const bundles = manifest?.dsh?.profile?.bundles
  if (Array.isArray(bundles) && bundles.includes(TUI_PLUGIN_NAME)) return undefined
  return `the tui profile does not have ${TUI_PLUGIN_NAME} installed\n\nRun:\n\n  dsh plugin --profile tui add ${TUI_PLUGIN_NAME}`
}

/**
 * Resolve the compatible official dsh bin this wrapper spawns. `DSH_BIN`
 * takes precedence over PATH; the launcher never installs or upgrades dsh.
 * @param env - process environment (injectable under tests).
 * @returns the absolute bin path.
 */
export function resolveDshBinPath(env = process.env) {
  return resolveOfficialDshBin(env)
}

/**
 * Default diagnostic sink used when `runDsh` does not inject one.
 * @param chunk - text to write.
 * @returns nothing.
 */
export function writeLauncherStderr(chunk) {
  process.stderr.write(chunk)
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
 * @param restoreTerminal - parent-process terminal reset hook.
 * @param env - launcher environment, injectable under tests.
 * @returns the exit code to report.
 */
export async function runDsh(
  translated,
  spawnImpl = spawn,
  writeErr = writeLauncherStderr,
  restoreTerminal = restoreInteractiveTerminal,
  env = process.env,
) {
  let dshBinPath
  try {
    dshBinPath = resolveDshBinPath(env)
    const profileMessage = await missingTuiProfileMessage(dshBinPath, env)
    if (profileMessage !== undefined) {
      writeErr(`dsh-tui: ${profileMessage}\n`)
      return EXIT_FAILURE
    }
  } catch (error) {
    writeErr(`dsh-tui: ${error instanceof Error ? error.message : String(error)}\n`)
    return EXIT_FAILURE
  }
  // React's development reconciler emits one User Timing measure per changed
  // prop. Node retains those measures, so an interactive source launch with no
  // NODE_ENV would grow until V8 reached its heap limit. The product launcher
  // always boots the TUI dependency graph through production entry points.
  const child = spawnImpl(process.execPath, [dshBinPath, ...translated], {
    stdio: 'inherit',
    env: { ...env, NODE_ENV: 'production' },
  })
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
    if (!translated.some(argument => argument.startsWith('--print='))) restoreTerminal()
  }
  if (outcome.code !== null) return outcome.code
  if (outcome.signal === 'SIGINT') return EXIT_INTERRUPT
  // The official dsh lifecycle defines SIGTERM as a successful supervisor
  // stop on every surface; this wrapper preserves that established contract.
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
