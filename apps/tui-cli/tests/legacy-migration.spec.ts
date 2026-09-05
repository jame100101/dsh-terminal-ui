import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'

it('documents official installation-first shadowing and recovery without a resolver hack', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-tui-legacy-migration-'))
  const name = '@jame100101/dsh-tui'
  const globalPackage = join(root, 'global', 'node_modules', name)
  const host = join(root, 'global', 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
  const profile = join(root, 'home', 'profiles', 'tui')
  const localPackage = join(profile, 'node_modules', name)
  const officialApi = pathToFileURL(createRequire(import.meta.url).resolve('@deepseek-ai/dsh-app-boot')).href
  const inspect = () => {
    // pnpm/Vitest adds repo workspaces to NODE_PATH; keep the fixture independent.
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      const { readProfileManifest, resolveBundleDir } = await import(${JSON.stringify(officialApi)});
      const dir = resolveBundleDir('dsh', ${JSON.stringify(name)}, ${JSON.stringify(host)}, ${JSON.stringify(profile)});
      console.log(JSON.stringify({ dir, patch: readProfileManifest('dsh', dir).dsh?.bundle?.patch ?? null }));
    `], { cwd: root, env: { ...process.env, NODE_PATH: '' }, encoding: 'utf8' })
    expect(child.status, child.stderr).toBe(0)
    return JSON.parse(child.stdout) as { dir: string; patch: string | null }
  }
  const write = (path: string, data: unknown) => writeFileSync(path, JSON.stringify(data))
  try {
    for (const dir of [globalPackage, localPackage, join(host, '..')]) mkdirSync(dir, { recursive: true })
    write(host, { name: '@deepseek-ai/dsh', version: '0.1.2-rc.1' })
    write(join(globalPackage, 'package.json'), { name, version: '0.1.0' })
    write(join(localPackage, 'package.json'), { name, version: '0.2.0-rc.2', dsh: { bundle: { patch: './cordis.patch.yml' } } })
    write(join(profile, 'package.json'), { dependencies: { [name]: '0.2.0-rc.2' }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-tui-app'] } } })

    // Use the pinned official API, not a reproduction of its lookup algorithm.
    const shadow = inspect()
    expect(resolve(shadow.dir)).toBe(resolve(globalPackage))
    expect(shadow.patch).toBeNull()
    const before = readFileSync(join(profile, 'package.json'), 'utf8')
    renameSync(globalPackage, `${globalPackage}.legacy-backup`)
    const recovered = inspect()
    expect(resolve(recovered.dir)).toBe(resolve(localPackage))
    expect(recovered.patch).toBe('./cordis.patch.yml')
    // Removing the shadow does not migrate the stale profile bundle list itself.
    expect(readFileSync(join(profile, 'package.json'), 'utf8')).toBe(before)
    expect(JSON.parse(before).dsh.profile.bundles).toContain('@deepseek-ai/dsh-tui-app')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
