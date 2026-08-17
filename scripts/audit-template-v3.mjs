#!/usr/bin/env node
/**
 * Dependency-free structural and manifest audit for v3 atomic templates.
 *
 * This is intentionally not full JSON Schema validation; the core registry
 * owns that responsibility. This guard catches malformed declarations,
 * unsupported call expressions, and SSP manifest mapping mistakes early.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const ATOMIC_DIR = path.join(ROOT, 'src/templates/v3/atomic')
const MANIFEST_FILE = path.join(ROOT, 'src/templates/manifest/ssp-capabilities.generated.json')
const TEMPLATE_SCHEMA_FILE = path.join(ROOT, 'src/templates/v3/schema/template-v3.schema.json')
const V3_SOURCE_DIR = path.join(ROOT, 'src/templates/v3')

const issues = []
const files = []
const templates = []

function issue(file, kind, message) {
  issues.push({ file: path.relative(ROOT, file), kind, message })
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasOwn(value, key) {
  return isRecord(value) && Object.prototype.hasOwnProperty.call(value, key)
}

function keysExactly(value, expected) {
  if (!isRecord(value)) return false
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}

function isJsonValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  return isRecord(value) && Object.values(value).every(isJsonValue)
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const result = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) result.push(...await walk(full))
    else if (entry.isFile() && entry.name.endsWith('.json')) result.push(full)
  }
  return result
}

async function walkByExtension(dir, extension) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const result = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) result.push(...await walkByExtension(full, extension))
    else if (entry.isFile() && entry.name.endsWith(extension)) result.push(full)
  }
  return result
}

function scanForbiddenKeys(value, file, location = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForbiddenKeys(item, file, `${location}[${index}]`))
    return
  }
  if (!isRecord(value)) return
  for (const [key, nested] of Object.entries(value)) {
    if (key === 'code' || key === 'flow' || key === 'steps') {
      issue(file, 'forbidden_declaration', `${location}.${key} is not allowed in v3 atomic templates`)
    }
    scanForbiddenKeys(nested, file, `${location}.${key}`)
  }
}

function auditTopLevelShape(template, file) {
  const allowed = [
    'schemaVersion', 'id', 'version', 'kind', 'title', 'description', 'intents',
    'input', 'internalOutput', 'output', 'effects', 'risk', 'ai', 'timeoutMs',
    'tags', 'deprecated', 'call',
  ]
  for (const key of Object.keys(template)) {
    if (!allowed.includes(key)) issue(file, 'unexpected_top_level_field', key)
  }

  if (template.schemaVersion !== 3) issue(file, 'non_v3', 'schemaVersion must be 3')
  if (template.kind !== 'atomic') issue(file, 'non_atomic', 'kind must be atomic')
  if (typeof template.id !== 'string' || template.id.length === 0) issue(file, 'missing_id', 'id must be a non-empty string')
  if (typeof template.version !== 'string' || template.version.length === 0) issue(file, 'missing_version', 'version must be a non-empty string')

  for (const field of ['title', 'description']) {
    if (typeof template[field] !== 'string' || template[field].length === 0) {
      issue(file, 'invalid_metadata', `${field} must be a non-empty string`)
    }
  }
  if (!Array.isArray(template.intents) || template.intents.length === 0) issue(file, 'invalid_intents', 'intents must be a non-empty array')
  if (!Array.isArray(template.effects) || template.effects.length === 0) issue(file, 'invalid_effects', 'effects must be a non-empty array')
  if (!isRecord(template.ai) || typeof template.ai.exposed !== 'boolean') issue(file, 'invalid_ai', 'ai.exposed must be boolean')
  if (template.timeoutMs !== undefined && (!Number.isInteger(template.timeoutMs) || template.timeoutMs < 1 || template.timeoutMs > 300000)) {
    issue(file, 'invalid_timeout', 'timeoutMs must be an integer from 1 through 300000')
  }
  if (template.tags !== undefined && (!Array.isArray(template.tags) || template.tags.some((tag) => typeof tag !== 'string' || tag.length === 0))) {
    issue(file, 'invalid_tags', 'tags must contain non-empty strings')
  }
  if (template.deprecated !== undefined && (!isRecord(template.deprecated) || typeof template.deprecated.reason !== 'string')) {
    issue(file, 'invalid_deprecated', 'deprecated.reason must be a string')
  }
}

function auditClosedSchema(template, field, file) {
  const schema = template[field]
  if (!isRecord(schema) || schema.type !== 'object') {
    issue(file, 'invalid_schema', `${field} must be an object schema`)
    return null
  }
  if (schema.additionalProperties !== false) {
    issue(file, 'open_top_level_schema', `${field}.additionalProperties must be false`)
  }
  if (!isRecord(schema.properties)) issue(file, 'invalid_schema', `${field}.properties must be an object`)
  return schema
}

function schemaAtStaticPath(schema, path) {
  const segments = path.split('.')
  function visit(current, index) {
    const segment = segments[index]
    if (!segment || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment)) return null
    if (Array.isArray(current?.anyOf)) {
      const matches = current.anyOf.map((candidate) => visit(candidate, index)).filter(Boolean)
      return matches.length === 1 ? matches[0] : null
    }
    if (!isRecord(current) || current.type !== 'object' || !isRecord(current.properties) || !hasOwn(current.properties, segment)) return null
    const child = current.properties[segment]
    return index === segments.length - 1 ? child : visit(child, index + 1)
  }
  return visit(schema, 0)
}

function auditCall(template, inputSchema, file) {
  const call = template.call
  if (!isRecord(call) || !keysExactly(call, ['method', 'args', 'result'])) {
    issue(file, 'invalid_call', 'call must contain only method, args, and result')
    return
  }

  if (typeof call.method !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*\.[A-Za-z][A-Za-z0-9_]*$/.test(call.method)) {
    issue(file, 'nonstatic_method', 'call.method must be a static namespace.method string')
  }

  if (!Array.isArray(call.args)) {
    issue(file, 'invalid_args', 'call.args must be an array')
  } else {
    for (const [index, expression] of call.args.entries()) {
      if (!isRecord(expression)) {
        issue(file, 'unsupported_arg_expression', `call.args[${index}] must be an argument expression object`)
        continue
      }
      const expressionKeys = Object.keys(expression)
      if (expressionKeys.includes('$input')) {
        if (!keysExactly(expression, ['$input']) && !keysExactly(expression, ['$input', 'default'])) {
          issue(file, 'unsupported_arg_expression', `call.args[${index}] has unsupported $input fields`)
        }
        if (typeof expression.$input !== 'string' || !schemaAtStaticPath(inputSchema, expression.$input)) {
          issue(file, 'unsupported_arg_expression', `call.args[${index}] references an unknown input field`)
        }
        if (hasOwn(expression, 'default') && !isJsonValue(expression.default)) {
          issue(file, 'unsupported_arg_expression', `call.args[${index}].default is not JSON`)
        }
      } else if (keysExactly(expression, ['$literal'])) {
        if (!isJsonValue(expression.$literal)) issue(file, 'unsupported_arg_expression', `call.args[${index}].$literal is not JSON`)
      } else {
        issue(file, 'unsupported_arg_expression', `call.args[${index}] must use only $input or $literal`)
      }
    }
  }

  const result = call.result
  if (!isRecord(result) || typeof result.kind !== 'string') {
    issue(file, 'invalid_result', 'call.result must declare direct or receipt')
  } else if (result.kind === 'direct') {
    if (!keysExactly(result, ['kind'])) issue(file, 'invalid_result', 'direct result accepts only kind')
  } else if (result.kind === 'receipt') {
    if (!keysExactly(result, ['kind', 'value']) || !isJsonValue(result.value)) {
      issue(file, 'invalid_result', 'receipt result must contain JSON value')
    }
  } else if (result.kind === 'object-ref' || result.kind === 'object-ref-array') {
    if (!keysExactly(result, ['kind', 'receipt']) || !isJsonValue(result.receipt)) {
      issue(file, 'invalid_result', `${result.kind} result must contain a JSON receipt`)
    }
  } else {
    issue(file, 'invalid_result', `unsupported result kind '${result.kind}'`)
  }
}

function auditManifestContract(template, inputSchema, outputSchema, capability, file) {
  if (!Array.isArray(capability.mappedTemplates) || !capability.mappedTemplates.includes(template.id)) {
    issue(file, 'manifest_template_mapping', `${template.id} is not listed in mappedTemplates for ${template.call.method}`)
  }
  const contract = capability.atomicContract
  if (!isRecord(contract) || !Array.isArray(contract.templateIds) || !contract.templateIds.includes(template.id) || !Array.isArray(contract.args) || !isRecord(contract.result)) {
    issue(file, 'manifest_atomic_contract', `${template.id} has no complete machine-checkable atomic contract`)
    return
  }
  const params = Array.isArray(capability.params) ? capability.params : []
  if (contract.args.length !== params.length) {
    issue(file, 'manifest_atomic_contract', `argument contract count differs from SSP parameters for ${template.call.method}`)
  }
  for (const [index, argument] of (template.call.args ?? []).entries()) {
    const expected = contract.args[index]
    if (!isRecord(expected) || !isRecord(expected.schema)) {
      issue(file, 'manifest_atomic_contract', `missing argument contract at index ${index}`)
      continue
    }
    if (isRecord(argument) && typeof argument.$input === 'string') {
      const actual = schemaAtStaticPath(inputSchema, argument.$input)
      if (!actual || canonicalJson(actual) !== canonicalJson(expected.schema)) {
        issue(file, 'manifest_atomic_contract', `input schema differs from argument contract at index ${index}`)
      }
    }
    if (params[index] && expected.required !== params[index].required) {
      issue(file, 'manifest_atomic_contract', `required flag differs at argument index ${index}`)
    }
  }
  const resultKind = template.call.result?.kind
  const expectedKind = resultKind === 'direct'
    ? 'public-data'
    : resultKind === 'receipt'
      ? 'void'
      : resultKind
  if (contract.result.kind !== expectedKind) {
    issue(file, 'manifest_atomic_contract', `result ${resultKind} conflicts with ${contract.result.kind}`)
  } else if (expectedKind === 'public-data' && canonicalJson(outputSchema) !== canonicalJson(contract.result.schema)) {
    issue(file, 'manifest_atomic_contract', 'public output schema differs from the Manifest result contract')
  }
}

const auditGrammarProbe = {
  schemaVersion: 3,
  id: 'audit.grammar-probe',
  version: '1.0.0',
  kind: 'atomic',
  title: 'audit probe',
  description: 'audit grammar self-test',
  intents: ['audit'],
  input: {
    type: 'object',
    properties: {
      options: {
        type: 'object',
        properties: { color: { type: 'string' } },
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  },
  internalOutput: { type: 'object', properties: {}, additionalProperties: false },
  output: { type: 'object', properties: {}, additionalProperties: false },
  effects: ['scene.read'],
  risk: 'read',
  ai: { exposed: false },
  timeoutMs: 100,
  tags: ['audit'],
  deprecated: { reason: 'self-test only' },
  call: {
    method: 'fixtureTool.read',
    args: [{ $input: 'options.color' }],
    result: { kind: 'object-ref', receipt: {} },
  },
}
auditTopLevelShape(auditGrammarProbe, fileURLToPath(import.meta.url))
auditCall(auditGrammarProbe, auditGrammarProbe.input, fileURLToPath(import.meta.url))

let manifest
try {
  manifest = JSON.parse(await fs.readFile(MANIFEST_FILE, 'utf8'))
} catch (error) {
  issue(MANIFEST_FILE, 'manifest_json', error.message)
}

const capabilities = isRecord(manifest) && Array.isArray(manifest.capabilities) ? manifest.capabilities : []
const capabilityById = new Map(capabilities.filter((entry) => isRecord(entry) && typeof entry.id === 'string').map((entry) => [entry.id, entry]))
for (const capability of capabilities) {
  if (isRecord(capability) && capability.templatePolicy === 'allowed' && (!Array.isArray(capability.mappedTemplates) || capability.mappedTemplates.length === 0)) {
    issue(MANIFEST_FILE, 'manifest_template_mapping', `${capability.id || '<unknown>'} is allowed without a non-empty mappedTemplates allow-list`)
  }
}

try {
  const templateSchema = JSON.parse(await fs.readFile(TEMPLATE_SCHEMA_FILE, 'utf8'))
  if (!isRecord(templateSchema) || templateSchema.additionalProperties !== false) {
    issue(TEMPLATE_SCHEMA_FILE, 'template_schema', 'top-level template schema must be closed')
  }
  if (templateSchema?.properties?.kind?.const !== 'atomic') {
    issue(TEMPLATE_SCHEMA_FILE, 'template_schema', 'Phase 1 machine schema must allow only kind=atomic')
  }
} catch (error) {
  issue(TEMPLATE_SCHEMA_FILE, 'template_schema_json', error.message)
}

let atomicFiles = []
try {
  atomicFiles = await walk(ATOMIC_DIR)
} catch (error) {
  issue(ATOMIC_DIR, 'atomic_directory', error.message)
}

for (const file of atomicFiles) {
  files.push(file)
  let template
  try {
    template = JSON.parse(await fs.readFile(file, 'utf8'))
  } catch (error) {
    issue(file, 'malformed_json', error.message)
    continue
  }
  if (!isRecord(template)) {
    issue(file, 'invalid_template', 'top-level JSON value must be an object')
    continue
  }
  templates.push({ file, template })
  scanForbiddenKeys(template, file)
  auditTopLevelShape(template, file)
  const inputSchema = auditClosedSchema(template, 'input', file)
  const outputSchema = auditClosedSchema(template, 'output', file)
  auditCall(template, inputSchema, file)

  const filenameId = path.basename(file, '.json')
  if (typeof template.id === 'string' && filenameId !== template.id) {
    issue(file, 'filename_id_mismatch', `filename id is '${filenameId}', template id is '${template.id}'`)
  }

  if (typeof template.call?.method === 'string') {
    const capability = capabilityById.get(template.call.method)
    if (!capability) {
      issue(file, 'unknown_method', template.call.method)
    } else if (capability.templatePolicy === 'blocked' || capability.templatePolicy === 'host-only') {
      issue(file, 'manifest_policy', `${template.call.method} is ${capability.templatePolicy}`)
    } else if (capability.classification === 'blocked' || capability.classification === 'host-only') {
      issue(file, 'manifest_classification', `${template.call.method} is ${capability.classification}`)
    } else if (capability.classification !== 'mapped') {
      issue(file, 'manifest_classification', `${template.call.method} is ${capability.classification || 'unclassified'}`)
    }
    if (capability) auditManifestContract(template, inputSchema, outputSchema, capability, file)
    if (template.call.method === 'objectsTool.clearAllHighlights' && capability?.templatePolicy !== 'host-only') {
      issue(file, 'host_emergency_policy', 'objectsTool.clearAllHighlights must be generated as templatePolicy=host-only')
    }
  }
}

const idFiles = new Map()
const methodFiles = new Map()
for (const { file, template } of templates) {
  if (typeof template.id === 'string') idFiles.set(template.id, [...(idFiles.get(template.id) || []), file])
  if (typeof template.call?.method === 'string') methodFiles.set(template.call.method, [...(methodFiles.get(template.call.method) || []), file])
}
for (const [id, boundFiles] of idFiles) {
  if (boundFiles.length > 1) boundFiles.forEach((file) => issue(file, 'duplicate_id', `${id} appears in ${boundFiles.length} files`))
}
for (const [method, boundFiles] of methodFiles) {
  if (boundFiles.length > 1) boundFiles.forEach((file) => issue(file, 'duplicate_method_binding', `${method} appears in ${boundFiles.length} files`))
}

const declarativeSources = [
  ...await walkByExtension(V3_SOURCE_DIR, '.ts'),
  path.join(ROOT, 'src/templates/runtime.ts'),
  path.join(ROOT, 'src/templates/catalog.ts'),
]
for (const file of declarativeSources) {
  const source = await fs.readFile(file, 'utf8')
  if (/\bnew\s+Function\b|\beval\s*\(/.test(source)) {
    issue(file, 'arbitrary_code_runtime', 'v3 and unified execution paths must not evaluate source code')
  }
}

console.log('=== v3 atomic template audit ===')
console.log(`Atomic JSON files: ${files.length}`)
console.log(`Parsed templates: ${templates.length}`)
console.log(`Unique ids: ${idFiles.size}`)
console.log(`Unique method bindings: ${methodFiles.size}`)
console.log(`Manifest capabilities: ${capabilityById.size}`)
console.log(`Declarative runtime sources: ${declarativeSources.length}`)
console.log('\nMethod bindings:')
for (const { file, template } of templates) {
  console.log(`  ${template.id || '?'} -> ${template.call?.method || '?'}`)
}
console.log(`\nIssues: ${issues.length}`)
if (issues.length > 0) {
  for (const entry of issues) console.log(`  [${entry.kind}] ${entry.file}: ${entry.message}`)
  process.exitCode = 1
} else {
  console.log('Result: PASS')
}
