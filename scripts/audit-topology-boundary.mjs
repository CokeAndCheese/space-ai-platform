import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const root = process.cwd()
const topologyRoot = path.resolve(root, 'src/ssp/topology')
const contextModule = path.resolve(root, 'src/ssp/core/context')

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) return walk(target)
    return entry.isFile() && entry.name.endsWith('.ts') ? [target] : []
  })
}

function moduleSpecifiers(file) {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const result = []
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      result.push(node.moduleSpecifier.text)
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      result.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return result
}

function stripKnownExtension(file) {
  return file.replace(/(?:\.d)?\.(?:ts|tsx|js|jsx|mjs|cjs)$/, '')
}

function isInside(child, parent) {
  const relative = path.relative(parent, child)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

const violations = []
const files = walk(topologyRoot)
for (const file of files) {
  for (const specifier of moduleSpecifiers(file)) {
    if (specifier === 'three') continue
    if (!specifier.startsWith('.')) {
      violations.push(`${path.relative(root, file)} imports forbidden package "${specifier}"`)
      continue
    }
    const resolved = stripKnownExtension(path.resolve(path.dirname(file), specifier))
    if (isInside(resolved, topologyRoot) || resolved === contextModule) continue
    violations.push(
      `${path.relative(root, file)} crosses the topology boundary via "${specifier}"`,
    )
  }
}

if (violations.length > 0) {
  console.error('[topology:boundary] FAIL')
  violations.forEach((violation) => console.error(`  - ${violation}`))
  process.exitCode = 1
} else {
  console.log(
    `[topology:boundary] PASS ${files.length} files only depend on three, core/context, and topology internals`,
  )
}
