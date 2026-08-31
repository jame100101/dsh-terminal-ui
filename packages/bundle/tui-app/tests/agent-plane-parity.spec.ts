import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '..', '..', '..', '..')

function presetOwnedDisabledRows(path: string): string[] {
  const source = readFileSync(path, 'utf8').replaceAll('\r\n', '\n')
  const start = source.indexOf('# ── the agent plane moves behind agent presets')
  const end = source.indexOf('# The preset roster', start)
  if (start < 0 || end < 0) throw new Error(`${path} has no bounded preset-owned section`)
  return [...source.slice(start, end).matchAll(/^- id: (\S+)\n  disabled: true$/gmu)]
    .map(match => match[1] ?? '')
    .sort()
}

describe('TUI agent-plane ownership', () => {
  it('disables the same preset-owned base rows as Web', () => {
    const webPatch = join(root, 'packages', 'bundle', 'web-app', 'cordis.patch.yml')
    const tuiPatch = join(root, 'packages', 'bundle', 'tui-app', 'cordis.patch.yml')

    expect(presetOwnedDisabledRows(tuiPatch)).toEqual(presetOwnedDisabledRows(webPatch))
  })

  it('retains the TUI-specific runtimes and preset roster on the host plane', () => {
    const source = readFileSync(join(root, 'packages', 'bundle', 'tui-app', 'cordis.patch.yml'), 'utf8')

    expect(source).toMatch(/    - id: tui\r?\n      name: '@deepseek-ai\/dsh-tui'/u)
    expect(source).toMatch(/    - id: code-runtime\r?\n      name: '@deepseek-ai\/dsh-code-runtime-worker-thread'/u)
    expect(source).toMatch(/    - id: cordis-host-runner\r?\n      name: '@deepseek-ai\/dsh-cordis-host-runner'/u)
    expect(source).toMatch(/    - id: agent-presets\r?\n      name: '@deepseek-ai\/dsh-agent-presets'/u)
  })
})
