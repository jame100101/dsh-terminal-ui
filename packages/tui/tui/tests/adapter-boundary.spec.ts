import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../src/', import.meta.url))
/** Follow value imports only: public presentation schemas may remain type-only. */
function valueDependencies(source: string): string[] {
  const file = ts.createSourceFile('boundary.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const edges: string[] = []
  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause
      const bindings = clause?.namedBindings
      const typesOnly = clause?.isTypeOnly || (bindings && ts.isNamedImports(bindings)
        && !clause?.name && bindings.elements.length > 0 && bindings.elements.every(item => item.isTypeOnly))
      if (!typesOnly) edges.push(node.moduleSpecifier.text)
    } else if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const named = node.exportClause
      if (!named || !ts.isNamedExports(named) || named.elements.some(item => !item.isTypeOnly)) edges.push(node.moduleSpecifier.text)
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
      || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      const argument = node.arguments[0]
      if (argument && ts.isStringLiteral(argument)) edges.push(argument.text)
      else edges.push('<dynamic-runtime-import>')
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return edges
}

function rendererBoundaryViolations(entry: string): string[] {
  const seen = new Set<string>()
  const errors: string[] = []
  function walk(path: string, chain: string[]): void {
    if (seen.has(path)) return
    seen.add(path)
    for (const specifier of valueDependencies(readFileSync(path, 'utf8'))) {
      const next = [...chain, specifier]
      if (specifier.startsWith('@deepseek-ai/') || specifier === '<dynamic-runtime-import>') errors.push(next.join(' → '))
      if (!specifier.startsWith('.')) continue
      const base = resolve(dirname(path), specifier)
      const dependency = [base, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts')].find(candidate => existsSync(candidate) && /\.[tj]sx?$/.test(candidate))
      if (!dependency) throw new Error(`Unresolved local UI dependency: ${next.join(' → ')}`)
      walk(dependency, next)
    }
  }
  walk(resolve(root, entry), [entry])
  return errors
}

describe('independent Harness adapter boundary', () => {
  it('keeps the renderer and its transitive value imports free of official runtime code', () => {
    expect(rendererBoundaryViolations('render.tsx')).toEqual([])
  })
  it('keeps the adapter capability contract independent of host and renderer implementation types', () => {
    const source = readFileSync(resolve(root, 'harness/adapter.ts'), 'utf8')
    const file = ts.createSourceFile('adapter.ts', source, ts.ScriptTarget.Latest, true)
    const dependencies = file.statements.filter(ts.isImportDeclaration).map(node => (node.moduleSpecifier as ts.StringLiteral).text)
    expect(dependencies).toEqual(['../theme'])
    expect(valueDependencies(source)).toEqual([])
    expect(source).not.toMatch(/\b(?:Context|Agent|Session)\s*[:<[]/)
  })
  it('detects runtime re-exports, mixed imports, require and import expressions while ignoring erased types', () => {
    expect(valueDependencies(`
      import type { Agent } from '@deepseek-ai/dsh-agent'
      import { type Session } from '@deepseek-ai/dsh-session'
      import { type Agent, expand } from '@deepseek-ai/dsh-llm'
      export * from './fold'
      export type { A } from './host'
      const a = import('./source-query')
      const b = require('@deepseek-ai/cordis')
    `)).toEqual(['@deepseek-ai/dsh-llm', './fold', './source-query', '@deepseek-ai/cordis'])
  })
})
