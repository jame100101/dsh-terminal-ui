import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertNoBundledPerfDiagnostics, bundleRowPackages, externalDependencies, runtimeClosure, semverMax,
} from '../scripts/assemble-runtime.mjs'

const root = join(import.meta.dirname, '..', '..', '..')

function allFiles(directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => join(entry.parentPath, entry.name))
}

describe('semverMax', () => {
  it('picks the numerically larger version, not the lexical one', () => {
    expect(semverMax('8.3.0', '15.0.0')).toBe('15.0.0')
    expect(semverMax('19.2.8', '18.3.1')).toBe('19.2.8')
    expect(semverMax('7.2.0', '7.2.0')).toBe('7.2.0')
  })
})

describe('npm performance-diagnostic exclusion', () => {
  it('accepts ordinary runtime code and rejects a performance logger marker', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-tui-pack-gate-'))
    try {
      const file = join(directory, 'index.js')
      writeFileSync(file, 'export const value = 1\n')
      expect(() => assertNoBundledPerfDiagnostics([directory])).not.toThrow()
      writeFileSync(file, 'process.env.TUI_PERF\n')
      expect(() => assertNoBundledPerfDiagnostics([directory])).toThrow(/repository-only performance marker/u)
      const declaration = join(directory, 'tui-perf.d.ts')
      writeFileSync(file, 'export const value = 1\n')
      writeFileSync(declaration, 'export declare const enabled: boolean\n')
      expect(() => assertNoBundledPerfDiagnostics([directory])).toThrow(/repository-only performance module/u)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe('bundleRowPackages', () => {
  it('collects the loader-row packages the bundle patches reference', () => {
    const rows = bundleRowPackages(root)
    // These rows exist only in the bundle patches, not in apps/cli's
    // manifest closure — a fresh profile resolves them through the healed
    // fallback, so the bundled runtime must name them in its anchor manifest.
    expect(rows.has('@deepseek-ai/dsh-typert-registry')).toBe(true)
    expect(rows.has('@deepseek-ai/dsh-api-gateway')).toBe(true)
    expect(rows.has('@deepseek-ai/dsh-tui')).toBe(true)
  })

  it('joins the runtime closure through the extra roots', () => {
    const closure = runtimeClosure(root, [...bundleRowPackages(root)])
    expect(closure.has('@deepseek-ai/dsh-typert-registry')).toBe(true)
    expect(closure.has('@deepseek-ai/dsh-api-gateway')).toBe(true)
  })
})

describe('runtimeClosure', () => {
  it('contains the launcher and the tui surface the profile mounts', () => {
    const closure = runtimeClosure(root)
    expect(closure.has('@deepseek-ai/dsh-base')).toBe(true)
    expect(closure.has('@deepseek-ai/dsh-tui-app')).toBe(true)
    expect(closure.has('@deepseek-ai/dsh-tui')).toBe(true)
    expect(closure.has('@deepseek-ai/cordis')).toBe(true)
    expect(closure.size).toBeGreaterThan(150)
  })
})

describe('externalDependencies', () => {
  it('pins every external to a real semver with no workspace protocol', () => {
    const deps = externalDependencies(root, runtimeClosure(root))
    // Keep a broad truncation tripwire; named assertions below pin the
    // launcher and patched-Ink dependencies that must be present.
    expect(deps.size).toBeGreaterThan(30)
    for (const [name, version] of deps) {
      expect(version).toMatch(/^\d+\.\d+\.\d+/)
      expect(version).not.toContain('workspace:')
      expect(version).not.toContain('link:')
      expect(version).not.toContain('file:')
      expect(name.startsWith('@deepseek-ai/')).toBe(false)
    }
  })

  it('pins the launcher-facing commander to the v15 line', () => {
    const deps = externalDependencies(root, runtimeClosure(root))
    expect(deps.get('commander')).toBe('15.0.0')
  })

  it('promotes dependencies of the runtime-local patched Ink payload', () => {
    const inkRoot = join(root, 'packages/tui/tui/node_modules/ink')
    const inkManifest = JSON.parse(readFileSync(join(inkRoot, 'package.json'), 'utf8')) as {
      name: string
      dependencies: Record<string, string>
    }
    const deps = externalDependencies(root, runtimeClosure(root), [inkRoot])
    expect(deps.get('es-toolkit')).toBe('1.49.0')
    expect(deps.get('signal-exit')).toBe('3.0.7')
    for (const name of Object.keys(inkManifest.dependencies)) expect(deps.has(name)).toBe(true)
  })
})

describe('assembled runtime (when present)', () => {
  it('ships the launcher bin, the agent-preset config, the bundle patches, and patched Ink', () => {
    const runtime = join(root, 'apps/tui-cli/runtime')
    if (!existsSync(runtime)) return // built at release time; skip when absent
    expect(() => assertNoBundledPerfDiagnostics([
      join(root, 'apps/tui-cli/bin'),
      join(runtime, 'node_modules/@deepseek-ai/dsh-tui'),
    ])).not.toThrow()
    expect(existsSync(join(runtime, 'lib/bin.js'))).toBe(true)
    // Shipped presets travel inside dsh-agent-presets (`SHIPPED_PRESET_ROOT`),
    // not under the launcher's old `config/agent-presets` tree. The roster is
    // standard/ptc/minimal/cordis; `code` is gone.
    const shipped = join(runtime, 'node_modules/@deepseek-ai/dsh-agent-presets/presets')
    for (const id of ['standard', 'ptc', 'minimal', 'cordis'] as const) {
      expect(existsSync(join(shipped, id, 'agent.cordis.yml'))).toBe(true)
    }
    expect(existsSync(join(shipped, 'code'))).toBe(false)
    expect(existsSync(join(runtime, 'node_modules/@deepseek-ai/dsh-tui-app/cordis.patch.yml'))).toBe(true)
    const cursorHelpers = readFileSync(join(runtime, 'node_modules/ink/build/cursor-helpers.js'), 'utf8')
    const inkRuntime = readFileSync(join(runtime, 'node_modules/ink/build/ink.js'), 'utf8')
    const logUpdate = readFileSync(join(runtime, 'node_modules/ink/build/log-update.js'), 'utf8')
    const outputRenderer = readFileSync(join(runtime, 'node_modules/ink/build/output.js'), 'utf8')
    expect(cursorHelpers).toContain('outputCursorRow - cursorPosition.y')
    expect(cursorHelpers).toContain('input.outputCursorRow')
    expect(inkRuntime).toContain('requestImmediateInputRender')
    expect(logUpdate).toContain('outputCursorRow: lines.length - 1')
    expect(logUpdate).toContain('outputCursorRow: nextLines.length - 1')
    expect(outputRenderer).toContain("findLastIndex(cell => cell.value === '\\uE000')")
    expect(outputRenderer).toContain("value: '█'")
    expect(outputRenderer).toContain('positionedRightEdge')
    expect(allFiles(runtime).some(file => file.endsWith('.tsbuildinfo'))).toBe(false)
    const manifest = JSON.parse(readFileSync(join(runtime, 'package.json'), 'utf8')) as { bin?: { dsh?: string } }
    expect(manifest.bin?.dsh).toBe('lib/bin.js')
    const wrapperManifest = JSON.parse(readFileSync(join(root, 'apps/tui-cli/package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
    }
    expect(wrapperManifest.dependencies?.['es-toolkit']).toBe('1.49.0')
    expect(wrapperManifest.dependencies?.['signal-exit']).toBe('3.0.7')
  })
})
