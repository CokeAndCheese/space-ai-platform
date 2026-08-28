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
const topologyGateFile = path.join(rootDir, 'src/templates/topologyCapabilityGate.ts')

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
const topologyTemplateIds = new Set()
for (const file of await walk(templateDir, (name) => name.endsWith('.json'))) {
  const json = JSON.parse(await fs.readFile(file, 'utf8'))
  templateIds.add(json.id)
  if (typeof json.method === 'string' && json.method.startsWith('ssp.topologyTool.')) {
    topologyTemplateIds.add(json.id)
    if (json.aiEnabled === true) {
      violations.push({
        file: path.relative(rootDir, file),
        kind: 'topology_template_ai_exposed',
        id: json.id,
      })
    }
  }
}

const gateSource = await fs.readFile(topologyGateFile, 'utf8')
if (!gateSource.includes("capability.namespace === 'topologyTool'") ||
    !gateSource.includes("definition.method.startsWith('ssp.topologyTool.')")) {
  violations.push({
    file: path.relative(rootDir, topologyGateFile),
    kind: 'topology_registry_gate_missing',
  })
}
if (/(?:@\/ssp|@\/composables)/.test(gateSource)) {
  violations.push({
    file: path.relative(rootDir, topologyGateFile),
    kind: 'capability_gate_crosses_runtime_boundary',
  })
}
const capabilitySourceInstallers = []
for (const file of await walk(path.join(rootDir, 'src'), (name) => name.endsWith('.ts'))) {
  if (file === topologyGateFile || file.includes(`${path.sep}test${path.sep}`)) continue
  const source = await fs.readFile(file, 'utf8')
  if (source.includes('installTopologyCapabilitySessionSource')) {
    capabilitySourceInstallers.push(path.relative(rootDir, file))
  }
}
if (capabilitySourceInstallers.length !== 1 ||
    capabilitySourceInstallers[0] !== 'src/composables/useTopologySceneLifecycle.ts') {
  violations.push({
    file: capabilitySourceInstallers.join(',') || 'src',
    kind: 'capability_session_source_not_unique',
  })
}

for (const relative of [
  'src/templates/runtime.ts',
  'src/templates/legacyRuntime.ts',
  'src/templates/v3/appRuntime.ts',
]) {
  const source = await fs.readFile(path.join(rootDir, relative), 'utf8')
  if (!source.includes('topologyTemplateUnavailableResult')) {
    violations.push({ file: relative, kind: 'topology_runtime_gate_missing' })
  }
}

const catalogSource = await fs.readFile(path.join(rootDir, 'src/templates/catalog.ts'), 'utf8')
if (!catalogSource.includes('isTemplateCapabilityAvailable')) {
  violations.push({ file: 'src/templates/catalog.ts', kind: 'capability_catalog_filter_missing' })
}

const promptSource = await fs.readFile(path.join(rootDir, 'src/ai/parser/prompts.ts'), 'utf8')
if (/const\s+TEMPLATE_CATALOG\s*=\s*templateCatalog\.toAiPromptSection\(\)/.test(promptSource)) {
  violations.push({ file: 'src/ai/parser/prompts.ts', kind: 'static_capability_catalog' })
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
  console.log(
    `AI/template boundary audit passed (${templateIds.size} registered template ids; ` +
    `${topologyTemplateIds.size} topology ids capability-gated).`,
  )
}
