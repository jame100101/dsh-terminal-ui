import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assemblePlugin } from '../scripts/assemble-plugin.mjs'
import { COMPATIBLE_DSH_VERSIONS, isCompatibleDshVersion, readDshVersionFromBin, resolveOfficialDshBin } from '../bin/dsh-tui.js'

const root = join(import.meta.dirname, '..', '..', '..')

function writeDshPackage(packageRoot: string, version = '0.1.2-rc.1', binName = 'bin.js') {
  mkdirSync(join(packageRoot, 'lib'), { recursive: true })
  writeFileSync(join(packageRoot, 'package.json'), `${JSON.stringify({ name: '@deepseek-ai/dsh', version })}\n`)
  writeFileSync(join(packageRoot, 'lib', binName), '#!/usr/bin/env node\n')
  return join(packageRoot, 'lib', binName)
}

function npmPackDryRun(directory: string) {
  const npm = process.platform === 'win32'
    ? { command: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', 'npm.cmd'] }
    : { command: 'npm', args: [] }
  const cache = mkdtempSync(join(tmpdir(), 'dsh-tui-npm-pack-'))
  try {
    const result = spawnSync(npm.command, [...npm.args, 'pack', '--dry-run', '--json', directory], {
      cwd: root,
      env: { ...process.env, npm_config_cache: cache },
      encoding: 'utf8',
    })
    expect(result.error).toBeUndefined()
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    return JSON.parse(result.stdout) as Array<{ files: Array<{ path: string }> }>
  } finally {
    rmSync(cache, { recursive: true, force: true })
  }
}

describe('plugin bundle patch', () => {
  it('declares this package as the TUI row and keeps preset-owned host disables', () => {
    const patch = readFileSync(join(import.meta.dirname, '..', 'plugin', 'cordis.patch.yml'), 'utf8').replaceAll('\r\n', '\n')
    expect(patch).toContain("name: '@jame100101/dsh-tui'")
    expect(patch).not.toMatch(/^      name: '@deepseek-ai\/dsh-tui'$/m)
    expect(patch).toContain('- id: command-goal\n  disabled: true')
    expect(patch).toContain('- id: tool-subagent\n  disabled: true')
    expect(patch).toContain("name: '@deepseek-ai/dsh-tool-subagent/model-selection-settings'")
  })
})

describe('assemblePlugin', () => {
  it('keeps the development workspace private', () => {
    const workspace = JSON.parse(readFileSync(join(root, 'apps/tui-cli/package.json'), 'utf8')) as { private?: boolean }
    expect(workspace.private).toBe(true)
  })

  it('stages lib, bin, patch, bundled patched Ink, and a dsh.bundle manifest', () => {
    const destination = join(root, 'apps/tui-cli/plugin-dist')
    assemblePlugin(destination)
    const manifest = JSON.parse(readFileSync(join(destination, 'package.json'), 'utf8')) as {
      name: string
      version: string
      private?: boolean
      repository?: { type?: string; url?: string; directory?: string }
      homepage?: string
      bugs?: { url?: string }
      engines?: { node?: string }
      dsh?: { bundle?: { patch?: string } }
      dependencies?: Record<string, string>
      bundledDependencies?: string[]
      peerDependencies?: Record<string, string>
    }
    expect(manifest.name).toBe('@jame100101/dsh-tui')
    expect(manifest.version).toBe('0.2.0-rc.1')
    expect(manifest.private).not.toBe(true)
    expect(manifest.repository).toEqual({
      type: 'git',
      url: 'git+https://github.com/jame100101/dsh-terminal-ui.git',
      directory: 'apps/tui-cli',
    })
    expect(manifest.homepage).toBe('https://github.com/jame100101/dsh-terminal-ui#readme')
    expect(manifest.bugs).toEqual({ url: 'https://github.com/jame100101/dsh-terminal-ui/issues' })
    expect(manifest.engines?.node).toBe('^22.19.0 || >=24.0.0')
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.dependencies?.ink).toBe('7.1.1')
    expect(manifest.dependencies?.['react-reconciler']).toBe('^0.33.0')
    expect(manifest.bundledDependencies).toEqual(['ink'])
    expect(manifest.peerDependencies?.['@deepseek-ai/dsh-agent']).toBe('0.1.2-rc.1')
    expect(existsSync(join(destination, 'lib/index.js'))).toBe(true)
    expect(existsSync(join(destination, 'lib/types'))).toBe(false)
    expect(existsSync(join(destination, 'lib/tsconfig.tsbuildinfo'))).toBe(false)
    expect(existsSync(join(destination, 'bin/dsh-tui.js'))).toBe(true)
    expect(existsSync(join(destination, 'cordis.patch.yml'))).toBe(true)
    expect(existsSync(join(destination, 'README.md'))).toBe(true)
    expect(existsSync(join(destination, 'README.zh.md'))).toBe(true)
    expect(existsSync(join(destination, 'README.i18n.yaml'))).toBe(true)
    expect(existsSync(join(destination, 'node_modules/ink/package.json'))).toBe(true)
    expect(existsSync(join(destination, 'node_modules/ink/node_modules'))).toBe(false)
    const marker = JSON.parse(readFileSync(join(destination, 'node_modules/ink/build/dsh-tui-patch.json'), 'utf8')) as {
      package: string
      source: string
      sha256: string
    }
    const patchBytes = readFileSync(join(root, 'patches/ink@7.1.1.patch'))
    expect(marker).toEqual({
      package: 'ink@7.1.1',
      source: 'patches/ink@7.1.1.patch',
      sha256: createHash('sha256').update(patchBytes).digest('hex'),
    })
    const patch = readFileSync(join(destination, 'cordis.patch.yml'), 'utf8')
    expect(patch).toContain("name: '@jame100101/dsh-tui'")
    expect(patch).toContain('runtimeDiagnosticPath:')
  })

  it('packs both READMEs from the publishable staged manifest', () => {
    const destination = join(root, 'apps/tui-cli/plugin-dist')
    assemblePlugin(destination)
    const [packed] = npmPackDryRun(destination)
    const files = packed?.files.map(file => file.path)
    expect(files).toContain('README.md')
    expect(files).toContain('README.zh.md')
    expect(files).toContain('package.json')
  })
})

describe('plugin-mode launcher compatibility', () => {
  it('accepts only the documented dsh RC line', () => {
    expect(COMPATIBLE_DSH_VERSIONS).toEqual(['0.1.2-rc.1'])
    expect(isCompatibleDshVersion('0.1.2-rc.1')).toBe(true)
    expect(isCompatibleDshVersion('0.1.0')).toBe(false)
    expect(isCompatibleDshVersion('0.2.0')).toBe(false)
  })

  it('reads the workspace dsh version from its JS bin', () => {
    const version = readDshVersionFromBin(join(root, 'apps/cli/lib/bin.js'))
    expect(version).toBe('0.1.2-rc.1')
  })

  it('honors DSH_BIN and rejects an incompatible bin', () => {
    const js = join(root, 'apps/cli/lib/bin.js')
    expect(resolveOfficialDshBin({ DSH_BIN: js })).toBe(js)
    expect(() => resolveOfficialDshBin({ DSH_BIN: join(root, 'apps/tui-cli/bin/dsh-tui.js') }))
      .toThrow(/compatible dsh/u)
  })

  it('resolves a direct JS PATH entry and rejects its incompatible package version', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'dsh-path-js-'))
    try {
      const compatible = join(fixture, 'compatible')
      const compatibleJs = writeDshPackage(compatible, '0.1.2-rc.1', 'dsh.js')
      expect(resolveOfficialDshBin({ PATH: join(compatible, 'lib') })).toBe(compatibleJs)

      const incompatible = join(fixture, 'incompatible')
      writeDshPackage(incompatible, '0.1.1', 'dsh.js')
      expect(() => resolveOfficialDshBin({ PATH: join(incompatible, 'lib') })).toThrow(/got 0\.1\.1/u)
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform !== 'win32')('resolves the Windows npm global .cmd layout', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'dsh-path-cmd-'))
    try {
      const binDir = join(fixture, 'bin')
      mkdirSync(binDir)
      writeFileSync(join(binDir, 'dsh.cmd'), '@echo off\r\n')
      const js = writeDshPackage(join(binDir, 'node_modules/@deepseek-ai/dsh'))
      expect(resolveOfficialDshBin({ PATH: binDir, PATHEXT: '.CMD' })).toBe(js)
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })

  it('reports a missing PATH dsh', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'dsh-path-missing-'))
    try {
      expect(() => resolveOfficialDshBin({ PATH: fixture })).toThrow(/no official dsh on PATH/u)
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })
})
