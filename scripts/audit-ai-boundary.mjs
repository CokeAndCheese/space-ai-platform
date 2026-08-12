#!/usr/bin/env node

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(scriptDir, '..')
const aiDir = path.join(rootDir, 'src/ai')
const storesDir = path.join(rootDir, 'src/stores')
const chatPanelFile = path.join(rootDir, 'src/views/ChatPanel.vue')
const templateDir = path.join(rootDir, 'src/templates/ssp_templates')

async function walk(dir, predicate) {
  const files = []
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await walk(full, predicate))
    else if (predicate(full)) files.push(full)
  }
  return files
}

const violations = []
const forbidden = [
  { kind: 'ssp_import', pattern: /(?:from\s*|import\s*\()\s*['"][^'"]*(?:@\/ssp|\/ssp(?:\/|['"]))/ },
  { kind: 'window_ssp', pattern: /\b(?:window|globalThis)\.ssp\b/ },
  { kind: 'ssp_context', pattern: /\bgetSspContext\b/ },
]

const boundaryFiles = [
  ...await walk(aiDir, (name) => /\.(?:ts|vue|md)$/.test(name)),
  ...await walk(storesDir, (name) => /\.(?:ts|vue)$/.test(name)),
  chatPanelFile,
]

for (const file of boundaryFiles) {
  const source = await fs.readFile(file, 'utf8')
  for (const rule of forbidden) {
    if (rule.pattern.test(source)) {
      violations.push({ file: path.relative(rootDir, file), kind: rule.kind })
    }
  }
}

const templateIds = new Set()
for (const file of await walk(templateDir, (name) => name.endsWith('.json'))) {
  const json = JSON.parse(await fs.readFile(file, 'utf8'))
  templateIds.add(json.id)
}

for (const file of await walk(path.join(rootDir, 'src'), (name) => /\.(?:ts|vue)$/.test(name))) {
  if (file.includes(`${path.sep}ssp${path.sep}`)) continue
  const source = await fs.readFile(file, 'utf8')
  for (const match of source.matchAll(/templateId:\s*['"]([^'"]+)['"]/g)) {
    if (!templateIds.has(match[1])) {
      violations.push({
        file: path.relative(rootDir, file),
        kind: 'unknown_template_reference',
        id: match[1],
      })
    }
  }
}

if (violations.length > 0) {
  console.error('AI/template boundary audit failed:')
  for (const violation of violations) {
    console.error(`- ${violation.file}: ${violation.kind}${violation.id ? ` (${violation.id})` : ''}`)
  }
  process.exitCode = 1
} else {
  console.log(`AI/template boundary audit passed (${templateIds.size} registered template ids).`)
}
