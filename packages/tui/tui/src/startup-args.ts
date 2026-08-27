/**
 * The TUI's startup-argument grammar: parse the launcher's inner argv (the
 * arguments the `dsh-tui` wrapper translates, or any args after
 * `dsh --profile tui`) into a pure {@link StartupIntent}.
 *
 * The parser only DECIDES — it never creates agents, resumes sessions,
 * submits prompts, or renders. Boot consumes the intent and routes to the
 * interactive or print executor, so the grammar stays unit-testable with no
 * Cordis context. Usage conflicts fail loud through commander errors: the
 * launcher-facing path (`parseCmdline`) turns them into `ctx.appExit(2)`,
 * while {@link parseTuiStartupIntent} rethrows them for tests.
 *
 * @module @deepseek-ai/dsh-tui/src/startup-args
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Command } from 'commander'

/** Where the booted session comes from. */
export type StartupBase =
  | { kind: 'new' }
  | { kind: 'continue' }
  | { kind: 'resume-picker' }
  | { kind: 'resume'; query: string }

/** The pure result of parsing the startup argv — what boot executes. */
export interface StartupIntent {
  /** Interactive TUI or one-shot print (no Ink, no composer, no mouse tracking). */
  mode: 'interactive' | 'print'
  /** Which session the surface starts on. */
  base: StartupBase
  /** Fork the resolved base at its last completed turn and switch to the fork. */
  fork: boolean
  /** A task to submit once the surface is up (interactive) or to run (print). */
  prompt?: string
}

/** The option object commander hands the startup action. */
interface StartupOptions {
  task?: string
  continue?: boolean
  resume?: true | string
  forkSession?: boolean
  print?: string
  prompt?: string
}

/** The TUI package version, read from its own manifest (source and built layouts both sit one level under the package root). */
function readTuiVersion(): string {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
  ) as { version?: unknown }
  return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
}

/**
 * Validate the parsed flags against the grammar's conflict rules and build
 * the startup intent. Commander errors carry exit code 2: a conflict is a
 * usage mistake, never an execution failure.
 * @param task - the positional task, if any.
 * @param options - the parsed flag values.
 * @param program - the owning program, for `program.error`.
 * @returns the validated intent.
 */
function startupIntent(task: string | undefined, options: StartupOptions, program: Command): StartupIntent {
  if (options.continue === true && options.resume !== undefined) {
    program.error('--continue and --resume are mutually exclusive', { exitCode: 2 })
  }
  if (task !== undefined && options.prompt !== undefined) {
    program.error('a positional task and --prompt cannot both be given', { exitCode: 2 })
  }
  if (task !== undefined && options.print !== undefined) {
    program.error('a positional task and --print cannot both be given', { exitCode: 2 })
  }
  if (options.print !== undefined && options.prompt !== undefined) {
    program.error('--print and --prompt cannot both be given', { exitCode: 2 })
  }
  if (options.print !== undefined && options.resume === true) {
    program.error('--print needs an explicit session; a bare --resume opens the interactive picker', { exitCode: 2 })
  }
  if (options.forkSession === true && options.continue !== true && typeof options.resume !== 'string') {
    program.error('--fork-session requires --continue or --resume <session>', { exitCode: 2 })
  }
  const base: StartupBase = options.continue === true
    ? { kind: 'continue' }
    : options.resume === true
      ? { kind: 'resume-picker' }
      : typeof options.resume === 'string'
        ? { kind: 'resume', query: options.resume }
        : { kind: 'new' }
  const prompt = options.print !== undefined ? options.print : (options.prompt !== undefined ? options.prompt : task)
  return {
    mode: options.print !== undefined ? 'print' : 'interactive',
    base,
    fork: options.forkSession === true,
    ...(prompt === undefined ? {} : { prompt }),
  }
}

/**
 * Declare the startup grammar on a fresh commander program whose action
 * publishes the parsed {@link StartupIntent} through `onIntent`. The program
 * declares no subcommands, so {@link parseCmdline}'s action precondition
 * holds and its help/version/error routing owns termination on the launcher
 * path.
 * @param onIntent - receives the validated intent when the parse succeeds.
 * @returns the undeployed program.
 */
export function buildTuiStartupProgram(onIntent: (intent: StartupIntent) => void): Command {
  const program = new Command()
  program
    .name('tui')
    .description('the dsh terminal surface: startup flags')
    .version(readTuiVersion(), '-V, --version', 'output the version number')
    .argument('[task]', 'submit this task once the TUI starts')
    .option('-c, --continue', 'resume the most recently used persisted session whose cwd matches this one')
    .option('-r, --resume [session]', 'resume by id, id prefix, or title (bare: open the session picker)')
    .option('--fork-session', 'fork the resumed base at its last completed turn and switch to the fork (requires -c or -r <session>)')
    .option('-p, --print <task>', 'run one task non-interactively, print the assistant result, and exit')
    .option('--prompt <task>', 'submit this task once the TUI starts')
    .action((task: string | undefined, options: StartupOptions) => {
      onIntent(startupIntent(task, options, program))
    })
  return program
}

/**
 * Parse one argv snapshot into a startup intent, with no Cordis context.
 * Help, version, and rejected invocations throw commander's control-flow
 * errors (`exitOverride`), so callers that need exit codes read the error's
 * `exitCode`; a successful parse always runs the action exactly once.
 * @param argv - the inner argv in order (the launcher's `cmdlineArgs` snapshot).
 * @returns the validated intent.
 */
export function parseTuiStartupIntent(argv: readonly string[]): StartupIntent {
  let intent: StartupIntent | undefined
  const program = buildTuiStartupProgram((parsed) => { intent = parsed })
  program.exitOverride()
  // The pure parser writes nothing: the launcher path (parseCmdline) routes
  // commander output to the process streams itself, and tests assert on the
  // thrown control-flow errors instead of captured text.
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} })
  program.parse([...argv], { from: 'user' })
  if (intent === undefined) throw new Error('tui: the startup program produced no intent')
  return intent
}
