/** Enforce the independent source/dependency closure, including test imports. */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, realpathSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve, relative, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = realpathSync(fileURLToPath(new URL('../', import.meta.url)))
const owned = ['packages/tui/tui', 'apps/tui-cli', 'scripts', 'evaluation/tui']
const manifests = ['package.json', 'packages/tui/tui/package.json', 'apps/tui-cli/package.json']
const declared = new Set()
for (const path of manifests) {
  const manifest = JSON.parse(readFileSync(resolve(root, path), 'utf8'))
  assert.equal(manifest.private, true, `${path} must be private`)
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    for (const [name, version] of Object.entries(manifest[field] ?? {})) {
      assert(!/^(workspace|file|link):/.test(version), `${path}: ${name} uses ${version}`)
      if (name.startsWith('@deepseek-ai/dsh') && name !== '@deepseek-ai/dsh-tui') {
        assert.equal(version, '0.1.2-rc.1', `${name} version drift`)
      }
      declared.add(name)
    }
  }
}
const rootManifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
assert.deepEqual(rootManifest.workspaces, ['packages/tui/tui', 'apps/tui-cli'])
for (const path of ['tsconfig.base.json', 'tsconfig.json', 'tsconfig.client.json', 'packages/tui/tui/tsconfig.json']) {
  const config = JSON.parse(readFileSync(resolve(root, path), 'utf8'))
  assert(!config.compilerOptions?.paths && !config.references, `${path}: source aliases/references`)
}
const skipped = new Set(['node_modules', 'lib', 'plugin-dist', '.artifacts'])
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (skipped.has(entry.name)) return []
    const path = resolve(dir, entry.name)
    return entry.isDirectory() ? walk(path) : [path]
  })
}
for (const path of walk(resolve(root, 'packages')).filter(p => p.endsWith(`${sep}package.json`))) {
  assert.equal(relative(root, path).replaceAll('\\', '/'), 'packages/tui/tui/package.json', `upstream package remains: ${path}`)
}
for (const path of walk(resolve(root, 'apps')).filter(p => p.endsWith(`${sep}package.json`))) {
  assert.equal(relative(root, path).replaceAll('\\', '/'), 'apps/tui-cli/package.json', `upstream app remains: ${path}`)
}
const files = [...owned.flatMap(p => walk(resolve(root, p))), ...readdirSync(root).filter(p => /\.(?:ts|mjs)$/.test(p)).map(p => resolve(root, p))]
let imports = 0
for (const path of files.filter(p => /\.(?:tsx?|m?js)$/.test(p))) {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
  const specs = []
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) specs.push(node.moduleSpecifier.text)
    if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      const call = node.expression.getText(source)
      if (call === 'import' || call === 'require' || call.endsWith('.resolve')) specs.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  for (const spec of specs) {
    imports++
    assert(!/^@deepseek-ai\/[^/]+\/src(?:\/|$)/.test(spec), `${path}: private source import ${spec}`)
    if (spec.startsWith('node:')) continue
    if (spec.startsWith('.')) {
      const target = resolve(dirname(path), spec)
      const found = ['', '.ts', '.tsx', '.js', '.mjs', '/index.ts'].map(ext => target + ext).find(existsSync)
      assert(found, `${path}: missing local import ${spec}`)
      assert(found.startsWith(root + sep), `${path}: import escapes repository`)
      const rel = relative(root, found).replaceAll('\\', '/')
      assert(owned.some(p => rel.startsWith(p + '/')) || !rel.includes('/'), `${path}: upstream source import ${rel}`)
    } else {
      const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
      assert(declared.has(name), `${path}: undeclared dependency ${name}`)
      const resolved = createRequire(path).resolve(spec)
      if (name.startsWith('@deepseek-ai/')) {
        assert(realpathSync(resolved).includes(`${sep}node_modules${sep}`), `${path}: Harness resolved to source`)
      }
    }
  }
}
console.log(JSON.stringify({ status: 'PASS', files: files.length, imports, harnessSourceCoupling: false }))
