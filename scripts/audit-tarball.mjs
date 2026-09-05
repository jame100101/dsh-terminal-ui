/** Audit actual npm tar entries without extracting executable content. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'

const input = process.argv[2]
assert(input, 'usage: node scripts/audit-tarball.mjs <plugin.tgz>')
const packed = readFileSync(input)
const tar = gunzipSync(packed)
const files = new Map()
for (let offset = 0; offset + 512 <= tar.length;) {
  const header = tar.subarray(offset, offset + 512)
  if (header.every(byte => byte === 0)) break
  const string = (start, end) => header.subarray(start, end).toString().replace(/\0.*$/s, '')
  const prefix = string(345, 500)
  const name = (prefix ? prefix + '/' : '') + string(0, 100)
  const size = parseInt(string(124, 136).trim() || '0', 8)
  assert(Number.isSafeInteger(size) && size >= 0, 'invalid tar size')
  const type = string(156, 157)
  assert(type === '' || type === '0' || type === '5', `unexpected tar entry type: ${name} (${type})`)
  assert(name.startsWith('package/') && !name.split('/').includes('..'), `unsafe path: ${name}`)
  if (type !== '5') files.set(name.slice(8), tar.subarray(offset + 512, offset + 512 + size))
  offset += 512 + Math.ceil(size / 512) * 512
}
for (const [name, bytes] of files) {
  assert(/^(?:package\.json|LICENSE|README(?:\.zh)?\.md|README\.i18n\.yaml|cordis\.patch\.yml|bin\/dsh-tui\.js|lib\/[^/]+\.js|node_modules\/ink\/.+)$/.test(name), `unexpected payload: ${name}`)
  assert(!/(?:^|\/)(?:\.env(?:\..*)?|\.git|node_modules\/ink\/node_modules)(?:\/|$)/.test(name), `private payload: ${name}`)
  if (name.endsWith('package.json')) {
    const manifest = JSON.parse(bytes.toString())
    for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const spec of Object.values(manifest[field] ?? {})) assert(!/^(?:workspace|file|link):/.test(spec), `${name}: ${spec}`)
    }
  }
  if (/\.(?:js|json|md|ya?ml)$/.test(name)) {
    // Registry Ink documents an illustrative path in this exact comment; it is not a build-machine path.
    const text = name === 'node_modules/ink/build/components/ErrorOverview.js'
      ? bytes.toString().replace('// Error\'s source file is reported as file:///home/user/file.js', '')
      : bytes.toString()
    assert(!/[A-Za-z]:[\\/](?:Users|deepseek[ %]|home)[^\n]*/i.test(text), `${name}: machine path`)
    assert(!/(?:\/Users\/|\/home\/runner\/|\/home\/[^ /]+\/|\/tmp\/dsh-)/.test(text), `${name}: machine path`)
    assert(!text.includes(process.cwd()) && !text.includes(process.cwd().replaceAll('\\', '/')), `${name}: repository path`)
    assert(!/(?:from\s*|import\s*(?:\(\s*)?)['"]@deepseek-ai\/[^/]+\/src\//.test(text), `${name}: private Harness import`)
  }
}
for (const required of ['package.json', 'lib/index.js', 'bin/dsh-tui.js', 'cordis.patch.yml', 'node_modules/ink/build/dsh-tui-patch.json']) assert(files.has(required), `missing ${required}`)
const manifest = JSON.parse(files.get('package.json').toString())
assert.deepEqual(manifest.bundledDependencies, ['ink'])
assert.equal(manifest.name, '@jame100101/dsh-tui')
console.log(JSON.stringify({ status: 'PASS', files: files.size, bytes: packed.length, sha256: createHash('sha256').update(packed).digest('hex'), bundled: ['ink'] }))
