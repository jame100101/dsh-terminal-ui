import { expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, symlinkSync, readdirSync, lstatSync, readlinkSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

for (const mode of ['foreign-legacy', 'foreign-source', 'dangling-source'] as const) {
  it(`rejects ${mode} before writes, builds or host startup`, () => {
    const scratch = mkdtempSync(join(tmpdir(), 'dsh-source-owner-'))
    try {
      const root = join(scratch, 'checkout'), home = join(scratch, 'home')
      for (const directory of ['scripts', 'apps/tui-cli/scripts', '.artifacts/source-bundle']) mkdirSync(join(root, directory), { recursive: true })
      for (const file of ['scripts/start-source.mjs', 'scripts/source-env.mjs', 'apps/tui-cli/scripts/preset-assets.mjs']) copyFileSync(new URL(`../${file}`, import.meta.url), join(root, file))
      writeFileSync(join(root, 'package.json'), '{"type":"module"}')
      const original = join(home, 'profiles/tui'), profile = join(home, 'profiles/tui-source')
      mkdirSync(original, { recursive: true })
      writeFileSync(join(original, 'package.json'), '{}')
      const links = join(profile, 'node_modules/@jame100101')
      mkdirSync(links, { recursive: true })
      const foreign = join(scratch, 'other-checkout')
      mkdirSync(foreign)
      symlinkSync(mode === 'foreign-legacy' ? foreign : join(root, '.artifacts/source-bundle'), join(links, 'dsh-tui'), 'junction')
      symlinkSync(mode === 'dangling-source' ? join(scratch, 'missing') : foreign, join(links, 'dsh-tui-source'), 'junction')
      writeFileSync(join(profile, 'package.json'), '{"sentinel":"existing-profile"}')
      writeFileSync(join(home, '.credentials.yaml'), 'synthetic-secret-sentinel')
      writeFileSync(join(home, 'session-sentinel'), 'old-session')
      function snapshot(dir: string): unknown {
        return Object.fromEntries(readdirSync(dir).sort().map(name => {
          const path = join(dir, name), stat = lstatSync(path)
          return [name, stat.isSymbolicLink() ? { link: readlinkSync(path) } : stat.isDirectory() ? snapshot(path) : readFileSync(path).toString('base64')]
        }))
      }
      const before = snapshot(scratch)
      // No dependencies or pnpm are installed in this fixture: rejection must
      // happen before resolving Harness or invoking a build, not by accident later.
      const result = spawnSync(process.execPath, [join(root, 'scripts/start-source.mjs')], {
        env: { ...process.env, DSH_TUI_ACCEPTANCE_HOME: home }, encoding: 'utf8', timeout: 5000,
      })
      expect(result.status, result.stderr).toBe(1)
      expect(result.stderr).toContain('refusing to modify it')
      expect(snapshot(scratch)).toEqual(before)
    } finally { rmSync(scratch, { recursive: true, force: true }) }
  })
}
