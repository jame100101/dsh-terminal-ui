// Stage the out-of-tree plugin payload: built TUI lib, this package's launcher
// bin, the plugin bundle patch, and the patched Ink tree. Official dsh
// packages resolve from the host install (peerDependencies); they are not
// copied. Ink is an npm bundled dependency because package-manager `file:`
// specs inside a tarball resolve against the consuming profile, not the
// package payload.
//
// Usage: node apps/tui-cli/scripts/assemble-plugin.mjs
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const pkgDir = join(scriptDir, '..')
const root = join(scriptDir, '..', '..', '..')
const defaultOut = join(pkgDir, 'plugin-dist')
const wrapperRequire = createRequire(join(pkgDir, 'package.json'))
const workspaceManifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
const rootManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

const HARNESS = '0.1.2-rc.1'
const INK_PATCH = 'patches/ink@7.1.1.patch'
const PEERS = {
  '@deepseek-ai/cordis': '4.0.2',
  '@deepseek-ai/cordis-plugin-loader': '1.0.3',
  '@deepseek-ai/schemastery': '3.18.2',
  '@deepseek-ai/dsh-agent': HARNESS,
  '@deepseek-ai/dsh-agent-default-model': HARNESS,
  '@deepseek-ai/dsh-agent-presets': HARNESS,
  '@deepseek-ai/dsh-app-boot': HARNESS,
  '@deepseek-ai/dsh-atomic-write': HARNESS,
  '@deepseek-ai/dsh-attachment': HARNESS,
  '@deepseek-ai/dsh-cmdline': HARNESS,
  '@deepseek-ai/dsh-commands': HARNESS,
  '@deepseek-ai/dsh-compaction': HARNESS,
  '@deepseek-ai/dsh-credentials': HARNESS,
  '@deepseek-ai/dsh-goal': HARNESS,
  '@deepseek-ai/dsh-invariants': HARNESS,
  '@deepseek-ai/dsh-jobs': HARNESS,
  '@deepseek-ai/dsh-llm': HARNESS,
  '@deepseek-ai/dsh-llm-retry': HARNESS,
  '@deepseek-ai/dsh-message-feedback': HARNESS,
  '@deepseek-ai/dsh-plan-mode': HARNESS,
  '@deepseek-ai/dsh-sandbox-policy': HARNESS,
  '@deepseek-ai/dsh-session': HARNESS,
  '@deepseek-ai/dsh-session-projection': HARNESS,
  '@deepseek-ai/dsh-session-query': HARNESS,
  '@deepseek-ai/dsh-session-reference': HARNESS,
  '@deepseek-ai/dsh-session-title': HARNESS,
  '@deepseek-ai/dsh-settings': HARNESS,
  '@deepseek-ai/dsh-skill': HARNESS,
  '@deepseek-ai/dsh-subagent': HARNESS,
  '@deepseek-ai/dsh-token-meter': HARNESS,
  '@deepseek-ai/dsh-tool-todo': HARNESS,
  '@deepseek-ai/dsh-tools': HARNESS,
  '@deepseek-ai/dsh-user-approval': HARNESS,
  '@deepseek-ai/dsh-user-questions': HARNESS,
  '@deepseek-ai/dsh-workflow': HARNESS,
}

/**
 * Stage the plugin package directory.
 * @param destination - output directory (replaced if it exists).
 * @returns the destination path.
 */
export function assemblePlugin(destination = defaultOut) {
  const tuiLib = join(root, 'packages/tui/tui/lib')
  if (!existsSync(join(tuiLib, 'index.js'))) {
    throw new Error('assemble-plugin: packages/tui/tui/lib/index.js missing — run pnpm run build:lib:host first')
  }
  const patch = join(pkgDir, 'plugin/cordis.patch.yml')
  if (!existsSync(patch)) throw new Error('assemble-plugin: plugin/cordis.patch.yml missing')
  const inkRoot = dirname(dirname(wrapperRequire.resolve('ink')))
  const inkManifest = JSON.parse(readFileSync(join(inkRoot, 'package.json'), 'utf8'))
  const inkPatchPath = join(root, INK_PATCH)
  if (!existsSync(inkPatchPath)) throw new Error(`assemble-plugin: ${INK_PATCH} missing`)
  rmSync(destination, { recursive: true, force: true })
  mkdirSync(join(destination, 'bin'), { recursive: true })
  mkdirSync(join(destination, 'lib'))
  for (const entry of readdirSync(tuiLib, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.js')) {
      cpSync(join(tuiLib, entry.name), join(destination, 'lib', entry.name))
    }
  }
  cpSync(join(pkgDir, 'bin/dsh-tui.js'), join(destination, 'bin/dsh-tui.js'))
  cpSync(patch, join(destination, 'cordis.patch.yml'))
  const stagedInk = join(destination, 'node_modules/ink')
  cpSync(inkRoot, stagedInk, { recursive: true })
  // pnpm's workspace copy contains dependency links. The packed plugin owns
  // only Ink itself; its declared runtime dependencies install normally in
  // the profile and therefore share React with the TUI.
  rmSync(join(stagedInk, 'node_modules'), { recursive: true, force: true })
  const patchSha256 = createHash('sha256').update(readFileSync(inkPatchPath)).digest('hex')
  writeFileSync(join(stagedInk, 'build/dsh-tui-patch.json'), `${JSON.stringify({
    package: `ink@${inkManifest.version}`,
    source: INK_PATCH,
    sha256: patchSha256,
  }, undefined, 2)}\n`)
  const license = join(pkgDir, 'LICENSE')
  if (existsSync(license)) cpSync(license, join(destination, 'LICENSE'))
  for (const readme of ['README.md', 'README.zh.md', 'README.i18n.yaml']) {
    cpSync(join(pkgDir, readme), join(destination, readme))
  }
  const manifest = {
    name: workspaceManifest.name,
    description: 'Out-of-tree DeepSeek Harness TUI bundle (plugin mode)',
    version: workspaceManifest.version,
    publishConfig: { access: 'public' },
    repository: workspaceManifest.repository,
    homepage: 'https://github.com/jame100101/dsh-terminal-ui#readme',
    bugs: { url: 'https://github.com/jame100101/dsh-terminal-ui/issues' },
    engines: { node: rootManifest.engines.node },
    type: 'module',
    main: 'lib/index.js',
    bin: { 'dsh-tui': 'bin/dsh-tui.js' },
    files: ['bin', 'lib', 'cordis.patch.yml', 'LICENSE', 'README.md', 'README.zh.md'],
    license: 'MIT',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
    dependencies: {
      ...inkManifest.dependencies,
      commander: '15.0.0',
      ink: inkManifest.version,
      marked: '16.4.2',
      react: '19.2.8',
      'string-width': '8.2.2',
    },
    bundledDependencies: ['ink'],
    peerDependencies: PEERS,
  }
  writeFileSync(join(destination, 'package.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)
  return destination
}

const launched = process.argv[1]?.replaceAll('\\', '/')
if (typeof launched === 'string' && launched.endsWith('assemble-plugin.mjs')) {
  const out = assemblePlugin()
  console.log(`assemble-plugin: wrote ${out}`)
}
