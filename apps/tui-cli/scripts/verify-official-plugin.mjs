import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const pty = require('node-pty')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const DSH_VERSION = '0.1.2-rc.1'
const PLUGIN_NAME = '@jame100101/dsh-tui'
const BUNDLES = ['@deepseek-ai/dsh-base', PLUGIN_NAME]

function assert(condition, message) {
  if (!condition) throw new Error(`verify-official-plugin: ${message}`)
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    const detail = options.capture ? `\n${result.stdout ?? ''}${result.stderr ?? ''}` : ''
    throw new Error(`verify-official-plugin: ${command} exited ${String(result.status)}${detail}`)
  }
  return result
}

function pathIsInside(parent, child) {
  const rel = relative(realpathSync(parent), realpathSync(child))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function assertPortableManifest(manifest) {
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
      assert(!/^(?:file|link|workspace):/u.test(String(spec)), `${field}.${name} uses ${String(spec)}`)
    }
  }
}

function filesUnder(directory) {
  const found = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...filesUnder(path))
    else if (entry.isFile()) found.push(path)
  }
  return found
}

function assertPortablePluginTree(pluginRoot) {
  const files = filesUnder(pluginRoot)
  const relativeFiles = files.map(path => relative(pluginRoot, path).replaceAll('\\', '/'))
  assert(!relativeFiles.some(path => path.startsWith('apps/cli/')), 'plugin contains apps/cli')
  assert(!relativeFiles.some(path => path.startsWith('packages/core/')), 'plugin contains packages/core')
  assert(!relativeFiles.some(path => path.startsWith('node_modules/@deepseek-ai/')), 'plugin copied Harness packages')
  assert(!relativeFiles.some(path => path.startsWith('runtime/')), 'plugin contains a bundled runtime')
  assert(!relativeFiles.some(path => path.endsWith('/assemble-runtime.mjs')), 'plugin contains assemble-runtime')
  for (const path of files.filter(path => basename(path) === 'package.json')) {
    assertPortableManifest(readJson(path))
  }
  const rootSpelling = root.replaceAll('\\', '/')
  for (const path of files.filter(path => /\.(?:js|json|md|ya?ml)$/u.test(path))) {
    const contents = readFileSync(path, 'utf8').replaceAll('\\', '/')
    assert(!contents.includes(rootSpelling), `${relative(pluginRoot, path)} contains the repository path`)
  }
  return { files: relativeFiles.length, copiedHarnessPackages: false }
}

function withoutEnvironmentKey(env, name) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => key.toUpperCase() !== name.toUpperCase()))
}

function withPrependedPath(env, directory) {
  const next = withoutEnvironmentKey(env, 'DSH_BIN')
  const existing = Object.entries(next).find(([key]) => key.toUpperCase() === 'PATH')
  if (existing !== undefined) delete next[existing[0]]
  next.PATH = `${directory}${delimiter}${existing?.[1] ?? ''}`
  return next
}

function bootPty(executable, args, options) {
  return new Promise((resolvePromise, reject) => {
    const child = pty.spawn(executable, args, {
      cols: 100,
      rows: 30,
      cwd: options.cwd,
      env: options.env,
    })
    let output = ''
    let stopping = false
    const startedAt = Date.now()
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error(`verify-official-plugin: PTY boot timed out\n${output.slice(-8_000)}`))
    }, 30_000)
    const stopWhenReady = () => {
      if (stopping || !output.includes('DSH-TUI') || !output.includes('idle')) return
      if (options.diagnosticPath !== undefined && !existsSync(options.diagnosticPath)) return
      stopping = true
      child.write('\x03')
      setTimeout(() => child.write('\x03'), 250)
    }
    child.onData(chunk => {
      output += chunk
      if (output.length > 200_000) output = output.slice(-200_000)
      stopWhenReady()
    })
    child.onExit(({ exitCode, signal }) => {
      clearTimeout(timeout)
      if (!stopping || exitCode !== 0) {
        reject(new Error(`verify-official-plugin: PTY exited ${String(exitCode)} (${String(signal)})\n${output.slice(-8_000)}`))
        return
      }
      resolvePromise({ durationMs: Date.now() - startedAt, output })
    })
  })
}

async function main() {
  const input = process.argv[2]
  if (input === undefined) throw new Error('usage: node apps/tui-cli/scripts/verify-official-plugin.mjs <plugin.tgz>')
  const sourceTgz = realpathSync(resolve(input))
  const clean = mkdtempSync(join(tmpdir(), 'dsh-official-clean-'))
  const dshHome = mkdtempSync(join(tmpdir(), 'dsh-official-home-'))
  assert(!pathIsInside(root, clean), 'clean room is inside the repository')
  writeFileSync(join(clean, 'package.json'), '{\n  "private": true\n}\n')
  const npm = process.platform === 'win32'
    ? { command: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', 'npm.cmd'] }
    : { command: 'npm', args: [] }
  run(npm.command, [...npm.args,
    'install', '--save-exact', '--no-audit', '--no-fund',
    '--cache', join(clean, '.npm-cache'), `@deepseek-ai/dsh@${DSH_VERSION}`,
  ], { cwd: clean })

  const dshManifestPath = join(clean, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
  const dshManifest = readJson(dshManifestPath)
  assert(dshManifest.version === DSH_VERSION, `installed dsh ${String(dshManifest.version)}`)
  assert(pathIsInside(clean, dshManifestPath), 'official dsh resolved outside the clean room')
  assert(!pathIsInside(root, dshManifestPath), 'official dsh resolved into the repository')
  const dshBin = realpathSync(join(dirname(dshManifestPath), dshManifest.bin.dsh))
  const version = run(process.execPath, [dshBin, '--version'], { cwd: clean, capture: true }).stdout.trim()
  assert(version === DSH_VERSION, `dsh --version reported ${version}`)

  // The official Windows plugin command passes a local spec to pnpm. Keeping
  // this copy in a space-free temporary root also guards against resolving
  // the original repository through the package spec.
  const pluginTgz = join(clean, basename(sourceTgz))
  copyFileSync(sourceTgz, pluginTgz)
  const commonEnv = {
    ...process.env,
    DSH_HOME: dshHome,
    NODE_ENV: 'production',
    npm_config_cache: join(clean, '.npm-cache'),
  }
  run(process.execPath, [dshBin, 'plugin', '--profile', 'tui', 'add', pluginTgz], {
    cwd: clean,
    env: commonEnv,
  })

  const profile = join(dshHome, 'profiles', 'tui')
  const profileManifest = readJson(join(profile, 'package.json'))
  assert(JSON.stringify(profileManifest.dsh?.profile?.bundles) === JSON.stringify(BUNDLES), 'profile bundle order differs')
  assert(!JSON.stringify(profileManifest).includes('@deepseek-ai/dsh-tui-app'), 'profile includes the bundled TUI app')
  const installedPlugin = join(profile, 'node_modules', '@jame100101', 'dsh-tui')
  const pluginManifest = readJson(join(installedPlugin, 'package.json'))
  assert(pluginManifest.version === '0.2.0-rc.1', `installed plugin ${String(pluginManifest.version)}`)
  assert(pluginManifest.private !== true, 'staged plugin is private')
  assert(pluginManifest.repository?.url === 'git+https://github.com/jame100101/dsh-terminal-ui.git', 'repository metadata differs')
  assert(pluginManifest.engines?.node === '^22.19.0 || >=24.0.0', 'Node engine range differs')
  assert(existsSync(join(installedPlugin, 'README.md')), 'README.md is absent')
  assert(existsSync(join(installedPlugin, 'README.zh.md')), 'README.zh.md is absent')
  assertPortableManifest(pluginManifest)
  assert(JSON.stringify(pluginManifest.bundledDependencies) === JSON.stringify(['ink']), 'Ink is not the sole bundled dependency')
  const couplingScan = assertPortablePluginTree(installedPlugin)

  const dumped = run(process.execPath, [dshBin, '--profile', 'tui', '--dump-config'], {
    cwd: clean,
    env: commonEnv,
    capture: true,
  }).stdout
  assert(dumped.includes(`name: '${PLUGIN_NAME}'`), 'dumped profile has no out-of-tree TUI row')

  const diagnosticPath = join(dshHome, 'tui-runtime-diagnostic.json')
  const runtimeEnv = { ...commonEnv, DSH_TUI_RUNTIME_DIAGNOSTIC: diagnosticPath }
  const directBoot = await bootPty(process.execPath, [dshBin, '--profile', 'tui'], {
    cwd: clean,
    env: runtimeEnv,
    diagnosticPath,
  })
  const diagnostic = readJson(diagnosticPath)
  assert(diagnostic.cordisContextIdentity === true, 'Cordis Context identity differs')
  for (const [name, path] of Object.entries(diagnostic.modules ?? {})) {
    assert(pathIsInside(join(clean, 'node_modules'), path), `${name} did not resolve from official dsh`)
    assert(!pathIsInside(profile, path), `${name} resolved from a profile-local duplicate`)
  }
  assert(pathIsInside(installedPlugin, diagnostic.tuiModule), 'TUI module did not load from the installed plugin')
  assert(pathIsInside(join(installedPlugin, 'node_modules', 'ink'), diagnostic.ink.entry), 'Ink did not load from the bundled plugin copy')
  const expectedPatchHash = createHash('sha256').update(readFileSync(join(root, 'patches', 'ink@7.1.1.patch'))).digest('hex')
  assert(diagnostic.ink.marker?.sha256 === expectedPatchHash, 'patched Ink marker differs from the source patch')
  assert(diagnostic.react.sameRuntime === true, 'TUI and Ink resolved different React runtimes')

  const launcher = realpathSync(join(installedPlugin, 'bin', 'dsh-tui.js'))
  const launcherVersion = run(process.execPath, [launcher, '--version'], { cwd: clean, capture: true }).stdout.trim()
  assert(launcherVersion === pluginManifest.version, `dsh-tui --version reported ${launcherVersion}`)
  const help = run(process.execPath, [launcher, '--help'], { cwd: clean, capture: true }).stdout
  assert(help.includes('--fork-session') && help.includes('--print'), 'dsh-tui --help omitted compatibility flags')
  unlinkSync(diagnosticPath)
  const launcherBoot = await bootPty(process.execPath, [launcher], {
    cwd: clean,
    env: { ...runtimeEnv, DSH_BIN: dshBin },
    diagnosticPath,
  })
  unlinkSync(diagnosticPath)
  const pathBinDir = join(clean, 'node_modules', '.bin')
  const expectedPathEntry = join(pathBinDir, process.platform === 'win32' ? 'dsh.cmd' : 'dsh')
  assert(statSync(expectedPathEntry).isFile(), `npm PATH entry is missing: ${expectedPathEntry}`)
  const launcherPathBoot = await bootPty(process.execPath, [launcher], {
    cwd: clean,
    env: withPrependedPath(runtimeEnv, pathBinDir),
    diagnosticPath,
  })

  const missingHome = mkdtempSync(join(tmpdir(), 'dsh-official-missing-profile-'))
  const missingProfile = spawnSync(process.execPath, [launcher], {
    cwd: clean,
    env: { ...commonEnv, DSH_HOME: missingHome, DSH_BIN: dshBin },
    encoding: 'utf8',
  })
  assert(missingProfile.status === 1, `missing profile exited ${String(missingProfile.status)}`)
  assert(missingProfile.stderr.includes(`the tui profile does not have ${PLUGIN_NAME} installed`), 'missing profile diagnostic differs')
  assert(missingProfile.stderr.includes(`dsh plugin --profile tui add ${PLUGIN_NAME}`), 'missing profile install command is absent')

  console.log(JSON.stringify({
    status: 'PASS',
    clean,
    dshHome,
    installedDsh: dshManifest.version,
    pluginTgz,
    plugin: `${pluginManifest.name}@${pluginManifest.version}`,
    bundles: profileManifest.dsh.profile.bundles,
    directBootMs: directBoot.durationMs,
    launcherDshBinBootMs: launcherBoot.durationMs,
    launcherPathBootMs: launcherPathBoot.durationMs,
    missingProfileUx: 'PASS',
    couplingScan,
    moduleIdentity: diagnostic,
  }, undefined, 2))
}

try {
  await main()
  // node-pty's Windows helper may retain an IPC handle after both ConPTY
  // children have reported exit; every asserted child is already quiescent.
  process.exit(0)
} catch (error) {
  console.error(error)
  process.exit(1)
}
