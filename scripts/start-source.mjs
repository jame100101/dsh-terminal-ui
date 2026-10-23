#!/usr/bin/env node
import { sourceChildEnv } from './source-env.mjs'
/** Build the checkout, then use a stable source profile in the existing
 * acceptance home. Credentials and sessions stay owned by official Harness.
 */
import { spawnSync, spawn } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, realpathSync, writeFileSync, readFileSync, copyFileSync, symlinkSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { PRESET_NAMES, terminalPresetSource } from '../apps/tui-cli/scripts/preset-assets.mjs'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'package.json'))
const value = process.env.DSH_TUI_ACCEPTANCE_HOME
if (!value) throw new Error('Set DSH_TUI_ACCEPTANCE_HOME to the existing isolated acceptance home; never a production home.')
const home = realpathSync(value)
const original = join(home, 'profiles/tui')
if (!existsSync(join(original, 'package.json'))) throw new Error('Missing acceptance tui profile; refusing to replace it.')
const bundle = join(root, '.artifacts/source-bundle')
const profile = join(home, 'profiles/tui-source')
// Reject foreign or dangling profile links before building or writing anything.
// Both aliases must resolve here: the legacy alias alone cannot prove ownership.
if (existsSync(profile)) {
  for (const name of ['dsh-tui', 'dsh-tui-source']) {
    const link = join(profile, 'node_modules/@jame100101', name)
    try {
      lstatSync(link)
    } catch (error) {
      if (name === 'dsh-tui-source' && error.code === 'ENOENT') continue
      throw new Error('Existing source profile has no valid source link; refusing to modify it.')
    }
    let owned = false
    try { owned = realpathSync(link) === realpathSync(bundle) } catch { /* dangling links are not ownership proof */ }
    if (!owned) throw new Error('Existing source profile belongs to another checkout or has a dangling link; refusing to modify it.')
  }
}
const hostPackage = require.resolve('@deepseek-ai/dsh/package.json')
if (JSON.parse(readFileSync(hostPackage, 'utf8')).version !== '0.2.1-rc.2') throw new Error('Source entry requires pinned official Harness rc.2.')
const build = spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['build'], { cwd: root, stdio: 'inherit' })
if (build.status !== 0) process.exit(build.status ?? 1)
// Development-only bundle metadata points directly at the freshly compiled
// checkout; Node resolves every Harness/React/Ink import in that same checkout.
mkdirSync(join(bundle, 'presets'), { recursive: true })
writeFileSync(join(bundle, 'package.json'), JSON.stringify({ name: '@jame100101/dsh-tui-source', version: JSON.parse(readFileSync(join(root, 'apps/tui-cli/package.json'), 'utf8')).version, private: true, type: 'module', main: './index.js', dsh: { bundle: { patch: ['./cordis.patch.yml', ...PRESET_NAMES.map(n => `./presets/${n}.patch.yml`)] } } }, null, 2))
writeFileSync(join(bundle, 'index.js'), `export * from ${JSON.stringify(pathToFileURL(join(root, 'packages/tui/tui/lib/index.js')).href)};\n`)
writeFileSync(join(bundle, 'cordis.patch.yml'), readFileSync(join(root, 'apps/tui-cli/plugin/cordis.patch.yml'), 'utf8').replace("dshHomePath('profiles', 'tui',", "dshHomePath('profiles', 'tui-source',").replace("name: '@jame100101/dsh-tui'", "name: '@jame100101/dsh-tui-source'"))
for (const preset of PRESET_NAMES) writeFileSync(join(bundle, 'presets', `${preset}.patch.yml`), terminalPresetSource(readFileSync(require.resolve(`@deepseek-ai/dsh-web-app/presets/${preset}.patch.yml`), 'utf8')))
if (!existsSync(profile)) {
  mkdirSync(join(profile, 'node_modules/@jame100101'), { recursive: true })
  const manifest = JSON.parse(readFileSync(join(original, 'package.json'), 'utf8'))
  manifest.name = 'dsh-tui-source-acceptance'
  manifest.private = true
  writeFileSync(join(profile, 'package.json'), JSON.stringify(manifest, null, 2))
  writeFileSync(join(profile, 'cordis.yml'), '[]\n')
  if (existsSync(join(original, 'cordis.patch.yml'))) copyFileSync(join(original, 'cordis.patch.yml'), join(profile, 'cordis.patch.yml'))
  else writeFileSync(join(profile, 'cordis.patch.yml'), '[]\n')
  // Reuse optional installed plugins without reinstalling or changing them.
  const modules = join(original, 'node_modules')
  for (const entry of readdirSync(modules)) {
    if (entry === '@jame100101') continue
    symlinkSync(join(modules, entry), join(profile, 'node_modules', entry), 'junction')
  }
  symlinkSync(bundle, join(profile, 'node_modules/@jame100101/dsh-tui'), 'junction')
}
// Use a distinct bundle name: official resolution searches the installation first.
const sourceLink = join(profile, 'node_modules/@jame100101/dsh-tui-source')
if (!existsSync(sourceLink)) symlinkSync(bundle, sourceLink, 'junction')
const sourceManifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
sourceManifest.dsh.profile.bundles = sourceManifest.dsh.profile.bundles.map(name => name === '@jame100101/dsh-tui' ? '@jame100101/dsh-tui-source' : name)
writeFileSync(join(profile, 'package.json'), JSON.stringify(sourceManifest, null, 2))
const linked = realpathSync(join(profile, 'node_modules/@jame100101/dsh-tui'))
if (linked !== realpathSync(bundle)) throw new Error('Existing source profile belongs to another checkout; refusing to overwrite it.')
const child = spawn(process.execPath, [join(dirname(hostPackage), 'lib/bin.js'), '--profile', 'tui-source', ...process.argv.slice(2)], { cwd: process.cwd(), env: sourceChildEnv(process.env, home), stdio: 'inherit' })
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0) })
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => child.kill(signal))
