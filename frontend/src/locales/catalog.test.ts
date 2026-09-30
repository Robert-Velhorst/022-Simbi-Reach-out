import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { expect, it } from 'vitest'
import en from './en.json'

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? sources(join(directory, entry.name)) : entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx') ? [join(directory, entry.name)] : [])
}

it('routes static visible text and labels through the catalog, excluding brand, language names and literal data formats', () => {
  const untranslated: string[] = []
  const allowedText = new Set(['Simbi Reach-Out', 'Language / Taal', 'English', 'Nederlands'])
  for (const file of sources('src')) {
    const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const visit = (node: ts.Node) => {
      if (ts.isJsxText(node) && /[a-zA-Z]/.test(node.text) && !allowedText.has(node.text.trim())) untranslated.push(`${file}: ${node.text.trim()}`)
      if (ts.isJsxAttribute(node) && ['title', 'label', 'detail', 'hint', 'placeholder', 'aria-label'].includes(node.name.getText(ast)) && node.initializer && ts.isStringLiteral(node.initializer) && /[a-zA-Z]/.test(node.initializer.text) && !node.initializer.text.startsWith('https://')) untranslated.push(`${file}: ${node.initializer.text}`)
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't' && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) expect(Object.hasOwn(en, node.arguments[0].text), `${file}: ${node.arguments[0].text}`).toBe(true)
      ts.forEachChild(node, visit)
    }
    visit(ast)
  }
  expect(untranslated).toEqual([])
})

it('keeps the exact four authored template fields and canonical CSV sample', () => {
  const source = readFileSync('src/pages/Resources.tsx', 'utf8')
  for (const field of ['name', 'organization', 'campaign', 'notes']) expect(source).toContain(`{'{${field}}'}`)
  expect(source).toContain('name,source_url,organization\\nAlex,https://simbi.com/alex,Community Lab')
})
