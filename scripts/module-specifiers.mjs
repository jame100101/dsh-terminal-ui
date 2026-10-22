/** Read static imports and Node module resolution calls without domain resolve() false positives. */
import ts from 'typescript'

export function moduleSpecifiers(path, text) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
  const specs = []
  const moduleResolvers = new Set(['require'])
  function collectResolvers(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
      && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(source) === 'createRequire') {
      moduleResolvers.add(node.name.text)
    }
    ts.forEachChild(node, collectResolvers)
  }
  collectResolvers(source)
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) specs.push(node.moduleSpecifier.text)
    if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      const call = node.expression.getText(source)
      // Deferred promises and domain services also expose resolve(); only
      // Node module resolvers describe imports for dependency auditing.
      const expression = node.expression
      const moduleResolve = ts.isPropertyAccessExpression(expression) && expression.name.text === 'resolve'
        && (moduleResolvers.has(expression.expression.getText(source))
          || expression.expression.getText(source) === 'import.meta'
          || (ts.isCallExpression(expression.expression) && expression.expression.expression.getText(source) === 'createRequire'))
      if (call === 'import' || moduleResolvers.has(call) || moduleResolve) specs.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return specs
}
