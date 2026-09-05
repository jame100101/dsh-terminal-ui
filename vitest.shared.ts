import ts from 'typescript'

const decoratorSyntax = /^\s*@[A-Za-z_$][\w$]*/m

/**
 * Worker arguments that keep process-wide Web Storage from shadowing jsdom storage.
 * Node lists the positive spelling in `allowedNodeEnvironmentFlags` for this negatable flag.
 */
export const vitestExecArgv = process.allowedNodeEnvironmentFlags.has('--webstorage') ? ['--no-webstorage'] : []

/**
 * Transform standard TypeScript decorators before Vite's default parser sees source files.
 * @returns a pre-transform Vite plugin shared by source-mode test configurations.
 */
export function standardDecoratorPlugin() {
  // Published Harness declarations expose const enums. Vite transpiles files
  // in isolation, so resolve their values from the public .d.ts compiler API.
  let program: ts.Program | undefined

  return {
    name: 'dsh-standard-decorators',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      const file = id.split('?', 1)[0]!
      if (!/\.[cm]?tsx?$/.test(file) || file.includes('/node_modules/')) return
      program ??= ts.createProgram(
        ts.sys.readDirectory(process.cwd(), ['.ts', '.tsx'], ['node_modules', '.test-tmp', 'RepoSentinel'], ['packages/tui/tui/**/*', 'scripts/test-invariants.ts']),
        { target: ts.ScriptTarget.ES2024, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, skipLibCheck: true },
      )
      const source = program.getSourceFile(file)
      const edits: Array<{ start: number; end: number; value: string }> = []
      if (source !== undefined) {
        const checker = program.getTypeChecker()
        const visit = (node: ts.Node): void => {
          if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
            const value = checker.getConstantValue(node)
            if (value !== undefined) {
              edits.push({ start: node.getStart(source), end: node.end, value: JSON.stringify(value) })
              return
            }
          }
          ts.forEachChild(node, visit)
        }
        visit(source)
        for (const edit of edits.sort((a, b) => b.start - a.start)) code = code.slice(0, edit.start) + edit.value + code.slice(edit.end)
      }
      if (!decoratorSyntax.test(code)) return edits.length ? { code, map: null } : undefined
      const result = ts.transpileModule(code, {
        fileName: file,
        compilerOptions: {
          target: ts.ScriptTarget.ES2024,
          module: ts.ModuleKind.ESNext,
          jsx: file.endsWith('x') ? ts.JsxEmit.ReactJSX : undefined,
          sourceMap: true,
        },
      })
      return {
        code: result.outputText
          .replace(
            /^(\s*)(__esDecorate\()/gmu,
            '$1/* v8 ignore next -- compiler-synthetic decorator accessors have no source behavior */ $2',
          )
          .replace(/\n?\/\/# sourceMappingURL=.*$/u, '\n'),
        map: result.sourceMapText,
      }
    },
  }
}
