/** Restore verified historical evidence into ignored local storage; never overwrite. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, existsSync, mkdirSync, realpathSync, writeFileSync, lstatSync } from 'node:fs'
import { dirname, resolve, relative, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
export function restoreEvidence(archive, destination, manifest, selected) {
  mkdirSync(destination, { recursive: true })
  const root = realpathSync(destination)
  const entries = selected ? manifest.files.filter(entry => entry.path === selected) : manifest.files
  assert(entries.length, 'Unknown archive path')
  // Validate and hash every selected source before performing any write.
  const ready = entries.map(entry => {
    assert(entry.path.startsWith('docs/evidence/'), 'Invalid evidence path')
    const suffix = entry.path.slice('docs/evidence/'.length)
    assert(suffix && !suffix.split(/[\\/]/).some(part => part === '..' || part === '.' || !part), 'Invalid evidence path')
    const data = readFileSync(resolve(archive, entry.path))
    assert.equal(data.length, entry.bytes, `Size mismatch: ${entry.path}`)
    assert.equal(createHash('sha256').update(data).digest('hex'), entry.sha256, `Hash mismatch: ${entry.path}`)
    return {entry, suffix, data}
  })
  for (const { entry, suffix, data } of ready) {
    const target = resolve(root, suffix)
    let parent = root
    for (const component of relative(root, dirname(target)).split(sep).filter(Boolean)) {
      parent = resolve(parent, component)
      if (existsSync(parent)) assert(!lstatSync(parent).isSymbolicLink(), 'Destination contains a symlink')
      else mkdirSync(parent)
    }
    const inside = relative(root, realpathSync(dirname(target)))
    assert(!inside.startsWith('..' + sep) && inside !== '..', 'Destination escapes evidence directory')
    if (existsSync(target)) {
      assert(!lstatSync(target).isSymbolicLink(), 'Destination contains a symlink')
      assert(readFileSync(target).equals(data), `Refusing overwrite: ${entry.path}`)
    } else writeFileSync(target, data, { flag: 'wx', mode: 0o600 })
  }
  return { status: 'PASS', restored: ready.length }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  assert(process.argv[2] && process.argv[3], 'Usage: node scripts/restore-evidence.mjs <archive-directory> <external-manifest.json> [docs/evidence/path]')
  const root = fileURLToPath(new URL('../', import.meta.url))
  const manifest = JSON.parse(readFileSync(resolve(process.argv[3]), 'utf8'))
  console.log(JSON.stringify(restoreEvidence(process.argv[2], resolve(root, '.artifacts/evidence-archive'), manifest, process.argv[4])))
}
