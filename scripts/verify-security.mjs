/** Verify the installed graph policy, not only an audit server's current response. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { load } from 'js-yaml'
export const securityPolicy = JSON.parse(readFileSync(new URL('./security-overrides.json', import.meta.url), 'utf8'))
export function verifySecurityLock(file) {
  const npm = file.endsWith('package-lock.json')
  const lock = npm ? JSON.parse(readFileSync(file, 'utf8')) : load(readFileSync(file, 'utf8'))
  assert(lock?.packages && typeof lock.packages === 'object', 'Missing package graph')
  const found = Object.fromEntries(Object.keys(securityPolicy).map(name => [name, []]))
  for (const [key, entry] of Object.entries(lock.packages)) {
    for (const [name, expected] of Object.entries(securityPolicy)) {
      if (npm ? key.endsWith(`node_modules/${name}`) : key.startsWith(`${name}@`)) {
        const version = npm ? entry.version : key.slice(name.length + 1).split('(')[0]
        assert.equal(version, expected, `${name}: unreviewed version ${version}`)
        found[name].push(version)
      }
    }
  }
  assert(found.fflate.length, 'Expected host fflate dependency missing from graph')
  if (!npm) {
    const workspace = load(readFileSync(new URL('../pnpm-workspace.yaml', import.meta.url), 'utf8'))
    assert.deepEqual(workspace.overrides, securityPolicy, 'Development and clean-room policy drift')
    for (const [name, versions] of Object.entries(found)) assert(versions.length, `${name}: not verified`)
  }
  return { status: 'PASS', policy: securityPolicy, occurrences: Object.fromEntries(Object.entries(found).map(([name, versions]) => [name, versions.length])) }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  console.log(JSON.stringify(verifySecurityLock(process.argv[2] ?? fileURLToPath(new URL('../pnpm-lock.yaml', import.meta.url)))))
}
