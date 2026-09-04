import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assemblePlugin } from '../scripts/assemble-plugin.mjs'
import { COMPATIBLE_DSH_VERSIONS, isCompatibleDshVersion, readDshVersionFromBin, resolveOfficialDshBin } from '../bin/dsh-tui.js'

const root = join(import.meta.dirname, '..', '..', '..')

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
  it('stages lib, bin, patch, bundled patched Ink, and a dsh.bundle manifest', () => {
    const destination = join(root, 'apps/tui-cli/plugin-dist')
    assemblePlugin(destination)
    const manifest = JSON.parse(readFileSync(join(destination, 'package.json'), 'utf8')) as {
      name: string
      version: string
      dsh?: { bundle?: { patch?: string } }
      dependencies?: Record<string, string>
      bundledDependencies?: string[]
      peerDependencies?: Record<string, string>
    }
    expect(manifest.name).toBe('@jame100101/dsh-tui')
    expect(manifest.version).toBe('0.2.0-rc.1')
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
})
