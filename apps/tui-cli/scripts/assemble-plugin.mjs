// Stage the out-of-tree plugin payload: built TUI lib, this package's launcher
// bin, the plugin bundle patch, and the patched Ink tree. Official dsh
// packages resolve from the host install (peerDependencies); they are not
// copied. Does not replace assemble-runtime.mjs (bundled mode stays).
//
// Usage: node apps/tui-cli/scripts/assemble-plugin.mjs
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const pkgDir = join(scriptDir, '..')
const root = join(scriptDir, '..', '..', '..')
const defaultOut = join(pkgDir, 'plugin-dist')
const wrapperRequire = createRequire(join(pkgDir, 'package.json'))

const HARNESS = '0.1.2-rc.1'
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
  rmSync(destination, { recursive: true, force: true })
  mkdirSync(join(destination, 'bin'), { recursive: true })
  cpSync(tuiLib, join(destination, 'lib'), { recursive: true })
  cpSync(join(pkgDir, 'bin/dsh-tui.js'), join(destination, 'bin/dsh-tui.js'))
  cpSync(patch, join(destination, 'cordis.patch.yml'))
  cpSync(inkRoot, join(destination, 'vendor/ink'), { recursive: true })
  const license = join(pkgDir, 'LICENSE')
  if (existsSync(license)) cpSync(license, join(destination, 'LICENSE'))
  const manifest = {
    name: '@jame100101/dsh-tui',
    description: 'Out-of-tree DeepSeek Harness TUI bundle (plugin mode)',
    version: '0.2.0-rc.1',
    type: 'module',
    main: 'lib/index.js',
    bin: { 'dsh-tui': 'bin/dsh-tui.js' },
    files: ['bin', 'lib', 'cordis.patch.yml', 'vendor', 'LICENSE'],
    license: 'MIT',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
    dependencies: {
      commander: '15.0.0',
      ink: 'file:./vendor/ink',
      marked: '16.4.2',
      react: '19.2.8',
      'string-width': '8.2.2',
    },
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
