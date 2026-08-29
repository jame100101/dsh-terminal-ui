// Assemble the self-contained dsh-tui runtime: the launcher (apps/cli built
// lib + config) plus every @deepseek-ai workspace package it resolves at
// runtime, copied by each package's own published-files payload into
// apps/tui-cli/runtime/. External registry dependencies are declared as the
// wrapper's npm dependencies (resolved from the registry at install time,
// reachable through Node's upward node_modules walk from inside runtime/).
// Ink is also copied into runtime/node_modules so the workspace's pinned
// cursor-coordinate patch survives npm installation; the registry dependency
// remains declared so npm installs Ink's dependency graph.
//
// Mirrors the launcher's own resolution: healProfilesModuleFallback BFSes
// dependencies + peerDependencies of the install anchor, so the bundled
// closure must contain the same graph.
//
// Usage: node apps/tui-cli/scripts/assemble-runtime.mjs
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const pkgDir = join(scriptDir, '..')
const root = join(scriptDir, '..', '..', '..')
const runtimeDir = join(pkgDir, 'runtime')
// js-yaml lives in apps/cli's own dependency tree (pnpm isolated layout).
const require = createRequire(join(root, 'apps/cli/package.json'))
const wrapperRequire = createRequire(join(pkgDir, 'package.json'))

/** Compare two semver-ish versions numerically (prerelease segments ignored). */
export function semverMax(left, right) {
  const parse = (value) => String(value).split('-')[0].split('.').map((part) => Number(part) || 0)
  const a = parse(left)
  const b = parse(right)
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] ?? 0) > (b[i] ?? 0)) return left
    if ((b[i] ?? 0) > (a[i] ?? 0)) return right
  }
  return left
}

/** Workspace package name → repo-relative dir, from the lockfile importers. */
function workspaceByName(rootDir) {
  const importers = readLock(rootDir).importers
  const byName = new Map()
  for (const [relDir] of Object.entries(importers)) {
    if (relDir === '.') continue
    const manifest = JSON.parse(readFileSync(join(rootDir, relDir, 'package.json'), 'utf8'))
    byName.set(manifest.name, relDir)
  }
  return byName
}

/** BFS the runtime closure of apps/cli: dependencies + peers + optionalDependencies, plus any extra roots. */
export function runtimeClosure(rootDir, extraRoots = []) {
  const byName = workspaceByName(rootDir)
  const workspace = new Map()
  const visited = new Set()
  const queue = ['apps/cli', ...extraRoots.map(name => byName.get(name)).filter(dir => dir !== undefined)]
  while (queue.length > 0) {
    const dir = queue.shift()
    if (visited.has(dir)) continue
    visited.add(dir)
    const manifest = JSON.parse(readFileSync(join(rootDir, dir, 'package.json'), 'utf8'))
    for (const name of Object.keys({ ...(manifest.dependencies ?? {}), ...(manifest.peerDependencies ?? {}), ...(manifest.optionalDependencies ?? {}) })) {
      if (!byName.has(name)) continue
      const rel = byName.get(name)
      if (!workspace.has(name)) workspace.set(name, rel)
      if (!visited.has(rel)) queue.push(rel)
    }
  }
  return workspace
}

/**
 * The workspace package names the shipped bundle patch layers reference as
 * loader rows (`name:` fields). The launcher links the profile fallback from
 * the install anchor's MANIFEST closure only, so a row package that is not a
 * manifest dependency would never resolve on a fresh profile; the bundled
 * runtime therefore adds them to its anchor manifest's dependencies.
 * The patch text is scanned for `name:` literals instead of parsed as YAML:
 * bundle patches carry the loader's custom `!!js` tags, which plain js-yaml
 * rejects, and the collector only needs the quoted package names.
 * @param rootDir - repository root.
 * @returns the referenced workspace package names.
 */
export function bundleRowPackages(rootDir) {
  const byName = workspaceByName(rootDir)
  const names = new Set()
  const namePattern = /^\s*name:\s*['"](@deepseek-ai\/[^'"]+)['"]/gm
  for (const [name, relDir] of byName) {
    const manifest = JSON.parse(readFileSync(join(rootDir, relDir, 'package.json'), 'utf8'))
    const patchFile = manifest.dsh?.bundle?.patch
    if (typeof patchFile !== 'string') continue
    const patchPath = join(rootDir, relDir, patchFile)
    if (!existsSync(patchPath)) continue
    const text = readFileSync(patchPath, 'utf8')
    for (const match of text.matchAll(namePattern)) {
      if (match[1] !== undefined && byName.has(match[1])) names.add(match[1])
    }
    void name
  }
  return names
}

/**
 * The external registry dependencies of the closure, pinned to the lockfile's
 * resolved versions. Dependencies of runtime-local external payloads are
 * promoted to the wrapper manifest because pnpm's isolated links are not
 * reachable after those payloads are copied out of the virtual store. Their
 * versions come from that package's installed dependency graph rather than
 * the highest same-named version elsewhere in the workspace lockfile.
 */
export function externalDependencies(rootDir, workspace, localExternalRoots = []) {
  const lock = readLock(rootDir)
  const resolved = new Map()
  for (const key of Object.keys(lock.packages ?? {})) {
    const at = key.lastIndexOf('@')
    if (at <= 0) continue
    const name = key.slice(0, at)
    const version = key.slice(at + 1)
    if (resolved.has(name)) resolved.set(name, semverMax(resolved.get(name), version))
    else resolved.set(name, version)
  }
  const externals = new Map()
  const visited = new Set()
  const queue = ['apps/cli']
  while (queue.length > 0) {
    const dir = queue.shift()
    if (visited.has(dir)) continue
    visited.add(dir)
    const manifest = JSON.parse(readFileSync(join(rootDir, dir, 'package.json'), 'utf8'))
    for (const [name, range] of Object.entries({ ...(manifest.dependencies ?? {}), ...(manifest.peerDependencies ?? {}), ...(manifest.optionalDependencies ?? {}) })) {
      if (workspace.has(name)) {
        if (!visited.has(workspace.get(name))) queue.push(workspace.get(name))
        continue
      }
      const version = resolved.get(name)
      if (version === undefined) throw new Error(`assemble-runtime: external dependency ${name} (via ${dir}) has no resolved version in the lockfile`)
      const existing = externals.get(name)
      if (existing === undefined) externals.set(name, version)
      else if (semverMax(existing, version) === version && existing !== version) externals.set(name, version)
      void range
    }
  }
  for (const packageRoot of localExternalRoots) {
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
    for (const [name, range] of Object.entries({ ...(manifest.dependencies ?? {}), ...(manifest.optionalDependencies ?? {}) })) {
      const dependencyManifest = installedDependencyManifest(packageRoot, name)
      const version = dependencyManifest.version
      if (typeof version !== 'string') throw new Error(`assemble-runtime: external dependency ${name} (via runtime-local ${manifest.name ?? 'package'}) has no installed version`)
      const existing = externals.get(name)
      if (existing === undefined) externals.set(name, version)
      else if (existing !== version) throw new Error(`assemble-runtime: runtime-local ${manifest.name ?? 'package'} requires ${name}@${version}, but the wrapper closure requires ${existing}`)
      void range
    }
  }
  return externals
}

function installedDependencyManifest(packageRoot, name) {
  let current = realpathSync(packageRoot)
  while (true) {
    const candidate = join(current, 'node_modules', ...name.split('/'), 'package.json')
    if (existsSync(candidate)) {
      const manifest = JSON.parse(readFileSync(candidate, 'utf8'))
      if (manifest.name === name) return manifest
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  throw new Error(`assemble-runtime: cannot resolve installed dependency ${name} from ${packageRoot}`)
}

function readLock(rootDir) {
  const yaml = require('js-yaml')
  return yaml.load(readFileSync(join(rootDir, 'pnpm-lock.yaml'), 'utf8'))
}

/** Recursively list files under one directory, skipping build caches, sourcemaps, source/test trees, and browser-client trees. */
function walkFiles(dir) {
  const out = []
  const visit = (current, rel) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'src' || entry.name === 'tests' || entry.name === 'test') continue
        // Browser client code emitted into the declaration tree is never
        // imported by the Node runtime (rel is relative to the walked lib/).
        if (entry.name === 'client' && (rel === 'types' || rel.endsWith('/types'))) continue
        visit(full, rel === '' ? entry.name : `${rel}/${entry.name}`)
      } else if (!entry.name.endsWith('.map') && !entry.name.endsWith('.tsbuildinfo')) {
        out.push(full)
      }
    }
  }
  visit(dir, '')
  return out
}

const PERF_DIAGNOSTIC_MARKERS = ['TUI_PERF', '[dsh-perf]', '[dsh-tui-tree]']
const PERF_DIAGNOSTIC_EXTENSIONS = ['.js', '.mjs', '.cjs', '.json', '.ts', '.map']

function isPerfDiagnosticPath(file) {
  return /(?:^|[\\/])tui-perf(?:\.|$)/u.test(file)
}

function containsPerfDiagnosticMarker(file) {
  if (!PERF_DIAGNOSTIC_EXTENSIONS.some(extension => file.endsWith(extension))) return false
  const text = readFileSync(file, 'utf8')
  return PERF_DIAGNOSTIC_MARKERS.some(marker => text.includes(marker))
}

/**
 * Reject repository-only performance logging from npm payload JavaScript.
 * @param {string[]} roots text trees included in the package.
 * @returns {void}
 */
export function assertNoBundledPerfDiagnostics(roots) {
  const visit = (current) => {
    if (!existsSync(current)) return
    const stat = statSync(current)
    if (stat.isDirectory()) {
      for (const entry of readdirSync(current)) visit(join(current, entry))
      return
    }
    if (isPerfDiagnosticPath(current)) {
      throw new Error(`assemble-runtime: npm payload contains repository-only performance module ${current}`)
    }
    if (!PERF_DIAGNOSTIC_EXTENSIONS.some(extension => current.endsWith(extension))) return
    const text = readFileSync(current, 'utf8')
    const marker = PERF_DIAGNOSTIC_MARKERS.find(value => text.includes(value))
    if (marker !== undefined) {
      throw new Error(`assemble-runtime: npm payload contains repository-only performance marker ${marker} in ${current}`)
    }
  }
  for (const rootPath of roots) visit(rootPath)
}

/**
 * One package's runtime payload: everything built under `lib/` (the
 * published runtime of every workspace package), plus any top-level entry
 * its `files` field names outside `lib/` (bundle patch layers, assets,
 * config, scripts), its LICENSE, and its package.json. Glob entries inside
 * `lib/` are already covered by the recursive copy; negations and
 * source-adjacent entries are skipped.
 * @returns relative file paths (forward slashes).
 */
function payloadFiles(rootDir, relDir, manifest) {
  const base = join(rootDir, relDir)
  const files = new Set()
  const libDir = join(base, 'lib')
  if (existsSync(libDir)) {
    for (const full of walkFiles(libDir)) {
      files.add(full.slice(base.length + 1).split('\\').join('/'))
    }
  }
  for (const entry of manifest.files ?? []) {
    if (entry.startsWith('!') || entry.includes('*')) continue
    const name = entry.startsWith('lib/') ? undefined : entry
    // Source and test trees are never runtime payloads, whatever a package
    // publishes for its own consumers.
    if (name === undefined || name === 'src' || name === 'tests' || name === 'test'
      || name.startsWith('src/') || name.startsWith('tests/') || name.startsWith('test/')) continue
    const full = join(base, name)
    if (!existsSync(full)) continue
    if (statSync(full).isDirectory()) {
      for (const file of walkFiles(full)) files.add(file.slice(base.length + 1).split('\\').join('/'))
    } else if (!name.endsWith('.map')) {
      files.add(name)
    }
  }
  const license = ['LICENSE', 'LICENSE.md', 'LICENSE.txt'].find((name) => existsSync(join(base, name)))
  if (license !== undefined) files.add(license)
  files.add('package.json')
  // Browser-only client bundles are never imported by the Node runtime; the
  // published packages ship them as CJS bytes under a type:module root, so
  // the bundled runtime drops them instead of carrying publint warnings.
  files.delete('lib/client.js')
  return [...files]
}

/** Copy one payload tree, returning the byte count. */
function copyPayload(rootDir, relDir, destination, files) {
  let bytes = 0
  for (const file of files) {
    const source = join(rootDir, relDir, file)
    if (!existsSync(source) || statSync(source).isDirectory()) continue
    const target = join(destination, file)
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(source, target)
    bytes += statSync(source).size
  }
  return bytes
}

function main() {
  const rowPackages = bundleRowPackages(root)
  const workspace = runtimeClosure(root, [...rowPackages])
  const inkRoot = dirname(dirname(wrapperRequire.resolve('ink')))
  const inkManifest = JSON.parse(readFileSync(join(inkRoot, 'package.json'), 'utf8'))
  const externals = externalDependencies(root, workspace, [inkRoot])
  rmSync(runtimeDir, { recursive: true, force: true })
  mkdirSync(join(runtimeDir, 'node_modules'), { recursive: true })
  let totalBytes = 0
  const notices = []
  // 1. The launcher payload: apps/cli's built lib, config (agent-presets), and manifest.
  const cliManifest = JSON.parse(readFileSync(join(root, 'apps/cli/package.json'), 'utf8'))
  const launcherFiles = payloadFiles(root, 'apps/cli', cliManifest)
  totalBytes += copyPayload(root, 'apps/cli', runtimeDir, launcherFiles)
  notices.push(`@deepseek-ai/dsh (launcher, apps/cli) ${cliManifest.version} — ${cliManifest.license}`)
  // The launcher links the profile fallback from THIS manifest's dependency
  // closure, so the bundle patch rows' packages must appear in it — a row
  // package absent from the manifest never resolves on a fresh profile.
  const byName = workspaceByName(root)
  const rowDeps = Object.fromEntries([...rowPackages].sort().map((name) => {
    const relDir = byName.get(name)
    const manifest = JSON.parse(readFileSync(join(root, relDir, 'package.json'), 'utf8'))
    return [name, manifest.version ?? '0.0.0']
  }))
  const runtimeManifest = { ...cliManifest, dependencies: { ...cliManifest.dependencies, ...rowDeps } }
  writeFileSync(join(runtimeDir, 'package.json'), `${JSON.stringify(runtimeManifest, undefined, 2)}\n`)
  // 2. Every workspace package in the closure, under runtime/node_modules/<name>.
  for (const [name, relDir] of [...workspace].sort()) {
    const manifest = JSON.parse(readFileSync(join(root, relDir, 'package.json'), 'utf8'))
    const payload = payloadFiles(root, relDir, manifest)
    // Local builds may retain obsolete hashed chunks because the workspace
    // bundler does not clean between faces. Repository-only TUI diagnostics
    // are excluded even when such a stale chunk remains in lib/.
    const files = name === '@deepseek-ai/dsh-tui'
      ? payload.filter(file => !isPerfDiagnosticPath(file) && !containsPerfDiagnosticMarker(join(root, relDir, file)))
      : payload
    const destination = join(runtimeDir, 'node_modules', name)
    const bytes = copyPayload(root, relDir, destination, files)
    if (bytes === 0) throw new Error(`assemble-runtime: package ${name} copied nothing (files ${JSON.stringify(manifest.files)})`)
    // Fail loud on a missing main entry: some packages emit their Node entry
    // only during the client build face, and an assembled runtime that lacks
    // it would boot only until the first loader import. Patch-only bundles
    // (no runtime entry — the loader consumes their cordis.patch.yml) are
    // exempt from the entry check; their patch file itself is required.
    if (typeof manifest.dsh?.bundle?.patch === 'string') {
      if (!existsSync(join(destination, manifest.dsh?.bundle?.patch))) {
        throw new Error(`assemble-runtime: bundle ${name} payload is missing its patch layer ${manifest.dsh?.bundle?.patch}`)
      }
    } else if (typeof manifest.main === 'string' && manifest.main.startsWith('lib/') && !existsSync(join(destination, manifest.main))) {
      throw new Error(`assemble-runtime: package ${name} payload is missing its main entry ${manifest.main} — build both faces (pnpm run build:lib) before assembling`)
    }
    totalBytes += bytes
    notices.push(`${name} ${manifest.version ?? '?'} — ${manifest.license ?? 'MIT'}`)
  }
  // 3. The patched Ink payload. A published package does not inherit the
  // workspace root's pnpm.patchedDependencies configuration, so relying only
  // on the wrapper dependency would install stock Ink for npm consumers.
  const resolvedInkVersion = externals.get('ink')
  if (inkManifest.version !== resolvedInkVersion) {
    throw new Error(`assemble-runtime: resolved Ink ${inkManifest.version} does not match wrapper dependency ${resolvedInkVersion ?? '(missing)'}`)
  }
  const cursorHelpers = readFileSync(join(inkRoot, 'build/cursor-helpers.js'), 'utf8')
  const inkRuntime = readFileSync(join(inkRoot, 'build/ink.js'), 'utf8')
  const logUpdate = readFileSync(join(inkRoot, 'build/log-update.js'), 'utf8')
  const outputRenderer = readFileSync(join(inkRoot, 'build/output.js'), 'utf8')
  if (!cursorHelpers.includes('outputCursorRow - cursorPosition.y')
    || !cursorHelpers.includes('input.outputCursorRow')
    || !inkRuntime.includes('requestImmediateInputRender')
    || !logUpdate.includes('outputCursorRow: lines.length - 1')
    || !logUpdate.includes('outputCursorRow: nextLines.length - 1')
    || !outputRenderer.includes("findLastIndex(cell => cell.value === '\\uE000')")
    || !outputRenderer.includes("value: '█'")
    || !outputRenderer.includes('positionedRightEdge')) {
    throw new Error('assemble-runtime: resolved Ink is missing the fullscreen terminal-coordinate patch')
  }
  const inkFiles = payloadFiles(inkRoot, '.', inkManifest)
  const inkDestination = join(runtimeDir, 'node_modules', 'ink')
  const inkBytes = copyPayload(inkRoot, '.', inkDestination, inkFiles)
  if (inkBytes === 0) throw new Error('assemble-runtime: patched Ink copied nothing')
  totalBytes += inkBytes
  notices.push(`ink ${inkManifest.version} (runtime-local patched payload) — ${inkManifest.license ?? 'MIT'}`)
  // 4. The wrapper's npm dependencies: the external registry packages.
  const wrapperManifestPath = join(pkgDir, 'package.json')
  const wrapperManifest = JSON.parse(readFileSync(wrapperManifestPath, 'utf8'))
  wrapperManifest.dependencies = Object.fromEntries([...externals].sort())
  writeFileSync(wrapperManifestPath, `${JSON.stringify(wrapperManifest, undefined, 2)}\n`)
  // 5. The bundled-content notice.
  const notice = [
    '# Bundled runtime notice',
    '',
    'This package ships the built dsh runtime (the DeepSeek Harness terminal',
    'surface and its launcher) inside `runtime/`. Every bundled package is MIT',
    'licensed; the notice below lists each one.',
    '',
    `Bundled packages: ${workspace.size + 1}`,
    '',
    ...notices.map((entry) => `- ${entry}`),
    '',
    `External dependencies: ${externals.size} (installed from the npm registry,`,
    'declared in this package\u2019s `dependencies`).',
    '',
  ].join('\n')
  writeFileSync(join(runtimeDir, 'NOTICE.md'), notice)
  assertNoBundledPerfDiagnostics([
    join(pkgDir, 'bin'),
    join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh-tui'),
  ])
  const mb = (totalBytes / 1048576).toFixed(1)
  console.log(`assemble-runtime: ${workspace.size + 1} packages, ${mb} MB payload, ${externals.size} external dependencies written to package.json`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main()
}
