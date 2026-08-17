#!/usr/bin/env node

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(scriptDir, '..')
const templateRoot = path.join(root, 'src/templates/ssp_templates')
const manifestDir = path.join(root, 'src/templates/manifest')
const docsGeneratedDir = path.join(root, 'docs/generated')
const manifestFile = path.join(manifestDir, 'ssp-capabilities.generated.json')
const baselineFile = path.join(manifestDir, 'v2-template-baseline.json')
const reportFile = path.join(docsGeneratedDir, 'TEMPLATE_PHASE0_INVENTORY.md')
const requestFile = path.join(root, 'docs/SSP_CHANGE_REQUEST_PHASE0.md')

const args = new Set(process.argv.slice(2))
const shouldWrite = args.has('--write')
const shouldCheck = args.has('--check')
const shouldInitBaseline = args.has('--init-baseline')

const SSP_PHASE0_IMPLEMENTATION = Object.freeze({
  verifiedDate: '2026-08-14',
  status: 'implemented-upstream-template-runtime-migration-pending',
  expectedMethodsBeforeIntegration: 81,
  expectedMethodsAfterIntegration: 85,
  addedMethods: Object.freeze([
    'objectsTool.query',
    'objectsTool.describe',
    'objectsTool.applyHighlight',
    'objectsTool.releaseHighlight',
  ]),
  runtimeObligations: Object.freeze([
    'execution-local capability table',
    'maximum 32 active highlight leases per execution',
    'AI durationMs maximum 60000',
    'release execution-owned leases on cancel or timeout',
    'project, redact, bound, and serialize every public result',
  ]),
  validationEvidence: Object.freeze([
    'test:objects (13 cases)',
    'typecheck',
    'test:topology',
    'audit:topology-boundary',
    'audit:templates',
    'audit:ai-boundary',
    'build',
  ]),
})

if (!shouldWrite && !shouldCheck && !shouldInitBaseline) {
  console.error('Usage: node scripts/phase0-template-inventory.mjs --write|--check [--init-baseline]')
  process.exit(2)
}

const CONTROLLERS = [
  { namespace: 'cameraController', expected: 6, interfaces: [['src/ssp/camera/cameraController.ts', 'CameraController']] },
  { namespace: 'sceneTool', expected: 5, interfaces: [['src/ssp/scene/sceneTool.ts', 'SceneTool']] },
  { namespace: 'lightTool', expected: 3, interfaces: [['src/ssp/light/lightTool.ts', 'LightTool']] },
  { namespace: 'helperTool', expected: 3, interfaces: [['src/ssp/helper/helperTool.ts', 'HelperTool']] },
  { namespace: 'modelTool', expected: 12, interfaces: [['src/ssp/model/modelTool.ts', 'ModelTool']] },
  // 12 is the pre-integration template worktree snapshot; 16 is the approved
  // CR-SSP-001/003 contract after the upstream SSP implementation is merged.
  { namespace: 'objectsTool', expected: [12, 16], interfaces: [['src/ssp/objects/objectsTool.ts', 'ObjectsTool']] },
  { namespace: 'poiManager', expected: 8, interfaces: [['src/ssp/poi/poiManager.ts', 'PoiManager']] },
  { namespace: 'cssTool', expected: 3, interfaces: [['src/ssp/css/cssTool.ts', 'CSSTool']] },
  { namespace: 'viewerTool', expected: 6, interfaces: [['src/ssp/viewer/viewerTool.ts', 'ViewerTool']] },
  {
    namespace: 'topologyTool',
    expected: 23,
    interfaces: [
      ['src/ssp/topology/topologyTool.ts', 'TopologyTool'],
      ['src/ssp/topology/types.ts', 'TopologyGraphApi'],
      ['src/ssp/topology/types.ts', 'TopologyRouteApi'],
    ],
  },
]

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8')
}

function relative(file) {
  return path.relative(root, file).split(path.sep).join('/')
}

function maskComments(source) {
  let result = ''
  let state = 'code'
  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    const next = source[i + 1]
    if (state === 'line-comment') {
      if (char === '\n') {
        result += '\n'
        state = 'code'
      } else result += ' '
      continue
    }
    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        result += '  '
        i++
        state = 'code'
      } else result += char === '\n' ? '\n' : ' '
      continue
    }
    if (state === 'single' || state === 'double' || state === 'template') {
      result += char
      if (char === '\\') {
        if (i + 1 < source.length) result += source[++i]
        continue
      }
      if ((state === 'single' && char === "'") ||
          (state === 'double' && char === '"') ||
          (state === 'template' && char === '`')) state = 'code'
      continue
    }
    if (char === '/' && next === '/') {
      result += '  '
      i++
      state = 'line-comment'
    } else if (char === '/' && next === '*') {
      result += '  '
      i++
      state = 'block-comment'
    } else {
      result += char
      if (char === "'") state = 'single'
      else if (char === '"') state = 'double'
      else if (char === '`') state = 'template'
    }
  }
  return result
}

function findMatching(source, start, open, close) {
  let depth = 0
  for (let i = start; i < source.length; i++) {
    if (source[i] === open) depth++
    else if (source[i] === close && --depth === 0) return i
  }
  throw new Error(`Unbalanced ${open}${close} near offset ${start}`)
}

function splitTopLevel(value, delimiter = ',') {
  const parts = []
  let start = 0
  const depth = { '(': 0, '[': 0, '{': 0, '<': 0 }
  const closing = { ')': '(', ']': '[', '}': '{', '>': '<' }
  for (let i = 0; i < value.length; i++) {
    const char = value[i]
    if (Object.hasOwn(depth, char)) depth[char]++
    else if (Object.hasOwn(closing, char)) depth[closing[char]] = Math.max(0, depth[closing[char]] - 1)
    else if (char === delimiter && Object.values(depth).every((count) => count === 0)) {
      parts.push(value.slice(start, i).trim())
      start = i + 1
    }
  }
  parts.push(value.slice(start).trim())
  return parts.filter(Boolean)
}

function extractInterfaceMethods(relativeFile, interfaceName) {
  const original = read(relativeFile)
  const source = maskComments(original)
  const pattern = new RegExp(`\\bexport\\s+interface\\s+${interfaceName}\\b[^\\{]*\\{`, 'm')
  const match = pattern.exec(source)
  if (!match) throw new Error(`Interface ${interfaceName} not found in ${relativeFile}`)
  const open = source.indexOf('{', match.index)
  const close = findMatching(source, open, '{', '}')
  const body = source.slice(open + 1, close)
  const originalBody = original.slice(open + 1, close)
  const methods = []
  const methodStart = /(?:^|\n)\s*([A-Za-z_$][\w$]*)\s*\(/g
  let candidate
  while ((candidate = methodStart.exec(body)) !== null) {
    const name = candidate[1]
    const nameOffset = candidate.index + candidate[0].lastIndexOf(name)
    const parenOpen = body.indexOf('(', nameOffset + name.length)
    const parenClose = findMatching(body, parenOpen, '(', ')')
    let cursor = parenClose + 1
    while (/\s/.test(body[cursor] ?? '') && body[cursor] !== '\n') cursor++
    if (body[cursor] !== ':') continue
    cursor++
    let end = cursor
    const depths = { '(': 0, '[': 0, '{': 0, '<': 0 }
    const closing = { ')': '(', ']': '[', '}': '{', '>': '<' }
    while (end < body.length) {
      const char = body[end]
      if (Object.hasOwn(depths, char)) depths[char]++
      else if (Object.hasOwn(closing, char)) depths[closing[char]] = Math.max(0, depths[closing[char]] - 1)
      if ((char === '\n' || char === ';') && Object.values(depths).every((count) => count === 0)) break
      end++
    }
    const rawParams = originalBody.slice(parenOpen + 1, parenClose).trim()
    const returnType = originalBody.slice(cursor, end).trim().replace(/;$/, '')
    const rawSignature = originalBody.slice(nameOffset, end).trim().replace(/\s+/g, ' ')
    const params = splitTopLevel(rawParams).map((raw) => {
      const paramMatch = raw.match(/^([A-Za-z_$][\w$]*)(\?)?\s*:\s*([\s\S]+)$/)
      return paramMatch
        ? { name: paramMatch[1], required: !paramMatch[2], type: paramMatch[3].trim() }
        : { name: raw, required: true, type: 'unknown' }
    })
    const absoluteOffset = open + 1 + nameOffset
    methods.push({
      name,
      signature: rawSignature,
      params,
      returnType,
      async: /\bPromise\s*</.test(returnType),
      source: `${relativeFile}:${original.slice(0, absoluteOffset).split('\n').length}`,
      declaredIn: interfaceName,
    })
    methodStart.lastIndex = end
  }
  return methods
}

function buildCapabilities() {
  const capabilities = []
  for (const controller of CONTROLLERS) {
    const methods = controller.interfaces.flatMap(([file, name]) => extractInterfaceMethods(file, name))
    const names = new Set(methods.map((method) => method.name))
    if (names.size !== methods.length) throw new Error(`${controller.namespace} has duplicate method declarations`)
    const expectedCounts = Array.isArray(controller.expected) ? controller.expected : [controller.expected]
    if (!expectedCounts.includes(methods.length)) {
      throw new Error(`${controller.namespace}: expected ${expectedCounts.join(' or ')} methods, found ${methods.length}`)
    }
    for (const method of methods) capabilities.push({ namespace: controller.namespace, ...method })
  }
  const capabilityIds = new Set(capabilities.map((item) => `${item.namespace}.${item.name}`))
  const implementedMethodsPresent = SSP_PHASE0_IMPLEMENTATION.addedMethods.filter((id) => capabilityIds.has(id))
  if (![0, SSP_PHASE0_IMPLEMENTATION.addedMethods.length].includes(implementedMethodsPresent.length)) {
    throw new Error(`Partial CR-SSP-001/003 integration detected: ${implementedMethodsPresent.join(', ') || 'none'}`)
  }
  const expectedTotal = implementedMethodsPresent.length === SSP_PHASE0_IMPLEMENTATION.addedMethods.length
    ? SSP_PHASE0_IMPLEMENTATION.expectedMethodsAfterIntegration
    : SSP_PHASE0_IMPLEMENTATION.expectedMethodsBeforeIntegration
  if (CONTROLLERS.length !== 10 || capabilities.length !== expectedTotal) {
    throw new Error(`Expected 10 controllers / ${expectedTotal} methods, found ${CONTROLLERS.length} / ${capabilities.length}`)
  }
  return capabilities.sort((a, b) => `${a.namespace}.${a.name}`.localeCompare(`${b.namespace}.${b.name}`))
}

function walkJson(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) return walkJson(target)
    return entry.isFile() && entry.name.endsWith('.json') ? [target] : []
  }).sort()
}

function uniqueSorted(values) {
  return [...new Set(values)].sort()
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function tokenizeCode(code) {
  const tokens = []
  let lineBreakBefore = false
  const push = (type, value) => {
    tokens.push({ type, value, lineBreakBefore })
    lineBreakBefore = false
  }
  for (let i = 0; i < code.length;) {
    const char = code[i]
    const next = code[i + 1]
    if (/\s/.test(char)) {
      if (char === '\n' || char === '\r') lineBreakBefore = true
      i++
      continue
    }
    if (char === '/' && next === '/') {
      i += 2
      while (i < code.length && code[i] !== '\n') i++
      continue
    }
    if (char === '/' && next === '*') {
      i += 2
      while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) {
        if (code[i] === '\n' || code[i] === '\r') lineBreakBefore = true
        i++
      }
      i = Math.min(code.length, i + 2)
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      const quote = char
      let value = ''
      i++
      while (i < code.length && code[i] !== quote) {
        if (code[i] === '\\' && i + 1 < code.length) {
          value += code[i + 1]
          i += 2
        } else value += code[i++]
      }
      i++
      push(quote === '`' && value.includes('${') ? 'template-interpolation' : 'string', value)
      continue
    }
    if (/[A-Za-z_$]/.test(char)) {
      let end = i + 1
      while (end < code.length && /[A-Za-z0-9_$]/.test(code[end])) end++
      push('identifier', code.slice(i, end))
      i = end
      continue
    }
    if (char === '?' && next === '.') {
      push('punctuator', '?.')
      i += 2
      continue
    }
    push('punctuator', char)
    i++
  }
  return tokens
}

function readStaticMember(tokens, index) {
  const operator = tokens[index]
  if (!operator) return null
  if (operator.value === '?.' && tokens[index + 1]?.value === '[') {
    return readStaticMember(tokens, index + 1)
  }
  if ((operator.value === '.' || operator.value === '?.') && tokens[index + 1]?.type === 'identifier') {
    return { name: tokens[index + 1].value, next: index + 2, dynamic: false }
  }
  if (operator.value === '[') {
    if (tokens[index + 1]?.type === 'string' && tokens[index + 2]?.value === ']') {
      return { name: tokens[index + 1].value, next: index + 3, dynamic: false }
    }
    let cursor = index + 1
    let depth = 1
    while (cursor < tokens.length && depth > 0) {
      if (tokens[cursor].value === '[') depth++
      if (tokens[cursor].value === ']') depth--
      cursor++
    }
    return { name: '<dynamic>', next: cursor, dynamic: true }
  }
  return null
}

function isCallStart(tokens, index) {
  return tokens[index]?.value === '(' ||
    (tokens[index]?.value === '?.' && tokens[index + 1]?.value === '(')
}

function findClosingToken(tokens, start, open, close) {
  let depth = 0
  for (let i = start; i < tokens.length; i++) {
    if (tokens[i].value === open) depth++
    else if (tokens[i].value === close && --depth === 0) return i
  }
  return -1
}

function extractSspCalls(code, capabilityIds) {
  const tokens = tokenizeCode(code)
  const calls = []
  const forcedInvalid = []
  const aliases = new Map()

  for (const token of tokens) {
    if (token.type === 'template-interpolation') forcedInvalid.push('<template-interpolation>')
  }

  // Legacy v2 templates may not destructure SSP namespaces or methods. The
  // frozen code set does not need this syntax, and rejecting it avoids hidden
  // method aliases that cannot be proven by the bounded scanner.
  for (let i = 0; i < tokens.length; i++) {
    if (!['const', 'let', 'var'].includes(tokens[i].value) || tokens[i + 1]?.value !== '{') continue
    const close = findClosingToken(tokens, i + 1, '{', '}')
    if (close < 0 || tokens[close + 1]?.value !== '=' || tokens[close + 2]?.value !== 'ssp') continue
    const namespace = readStaticMember(tokens, close + 3)
    forcedInvalid.push(namespace && !namespace.dynamic
      ? `${namespace.name}.<destructured-method>`
      : '<destructured-ssp>')
  }

  for (let i = 0; i < tokens.length; i++) {
    if (!['const', 'let', 'var'].includes(tokens[i].value) ||
        tokens[i + 1]?.type !== 'identifier' || tokens[i + 2]?.value !== '=' ||
        tokens[i + 3]?.value !== 'ssp') continue
    const namespace = readStaticMember(tokens, i + 4)
    if (!namespace || namespace.dynamic) continue
    // Only the namespace itself may be assigned. A method call result is not an alias.
    const following = tokens[namespace.next]
    const continuesMemberAccess = ['.', '?.', '['].includes(following?.value)
    if (following?.value === ';' || following?.value === ',' || namespace.next === tokens.length ||
        (following?.lineBreakBefore && !continuesMemberAccess)) {
      aliases.set(tokens[i + 1].value, namespace.name)
    }
  }

  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].value === 'ssp') {
      const namespace = readStaticMember(tokens, i + 1)
      if (!namespace) continue
      if (namespace.dynamic) {
        forcedInvalid.push('<dynamic-namespace>')
        continue
      }
      const method = readStaticMember(tokens, namespace.next)
      if (!method) continue
      if (method.dynamic) {
        forcedInvalid.push(`${namespace.name}.<dynamic-method>`)
        continue
      }
      const call = `${namespace.name}.${method.name}`
      if (isCallStart(tokens, method.next)) calls.push(call)
      else if (capabilityIds.has(call)) forcedInvalid.push(`${call}.<indirect-reference>`)
      else forcedInvalid.push(call)
      continue
    }
    const namespace = aliases.get(tokens[i].value)
    if (!namespace) continue
    const method = readStaticMember(tokens, i + 1)
    if (!method) continue
    if (method.dynamic) {
      forcedInvalid.push(`${namespace}.<dynamic-method>`)
      continue
    }
    const call = `${namespace}.${method.name}`
    if (isCallStart(tokens, method.next)) calls.push(call)
    else if (capabilityIds.has(call)) forcedInvalid.push(`${call}.<indirect-reference>`)
    else forcedInvalid.push(call)
  }
  return {
    actualCalls: uniqueSorted(calls.filter((call) => capabilityIds.has(call))),
    invalidSspCalls: uniqueSorted([...forcedInvalid, ...calls.filter((call) => !capabilityIds.has(call))]),
  }
}

function analyzeTemplate(file, capabilityIds) {
  const content = fs.readFileSync(file, 'utf8')
  const json = JSON.parse(content)
  const code = typeof json.code === 'string' ? json.code : ''
  const { actualCalls, invalidSspCalls } = extractSspCalls(code, capabilityIds)
  const metadataMethods = uniqueSorted(
    [...String(json.method ?? '').matchAll(/\bssp\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\b/g)]
      .map((match) => `${match[1]}.${match[2]}`),
  )
  const dependencies = []
  const dependencyRules = [
    ['window', /\bwindow\b/],
    ['document', /\bdocument\b/],
    ['THREE', /\bTHREE\b/],
    ['ssp-context', /\bssp\.(?:getContext|setContext|clearContext|hasContext)\s*\(/],
    ['scene-traverse', /\.scene\b|\.traverse\s*\(/],
    ['timer', /\b(?:setTimeout|setInterval)\s*\(/],
  ]
  for (const [name, pattern] of dependencyRules) if (pattern.test(code)) dependencies.push(name)
  const declaredParams = uniqueSorted((json.params ?? []).map((param) => String(param.name)).filter(Boolean))
  const consumedParams = declaredParams.filter((name) => {
    const rootName = name.split('.')[0]
    return new RegExp(`\\bparams(?:\\.${escapeRegex(rootName)}\\b|\\[['\"]${escapeRegex(rootName)}['\"]\\])`).test(code)
  })
  const ignoredParams = declaredParams.filter((name) => !consumedParams.includes(name))
  let classification
  if (dependencies.length > 0) classification = 'app-dependent'
  else if (actualCalls.length === 0) classification = 'non-SSP'
  else if (actualCalls.length === 1) classification = 'atomic'
  else classification = 'composite'
  const fileName = path.relative(templateRoot, file).split(path.sep).join('/')
  return {
    id: json.id,
    file: fileName,
    category: json.category,
    aiEnabled: json.aiEnabled === true,
    status: json.status ?? 'active',
    hasCode: code.length > 0,
    hasSteps: Array.isArray(json.steps),
    stepsCount: Array.isArray(json.steps) ? json.steps.length : 0,
    classification,
    actualSspCalls: actualCalls,
    invalidSspCalls,
    metadataMethods,
    methodMatchesCode: metadataMethods.length === actualCalls.length && metadataMethods.every((item) => actualCalls.includes(item)),
    dependencies: uniqueSorted(dependencies),
    declaredParams,
    consumedParams,
    ignoredParams,
    contentSha256: sha256(content),
    codeSha256: sha256(code),
  }
}

function baselineContent(templates) {
  return `${JSON.stringify({
    schemaVersion: 1,
    purpose: 'Freeze the legacy v2 code-template set. Deletions are allowed; additions require an explicit baseline review.',
    templates: templates.filter((item) => item.hasCode).map(({ id, file }) => ({ id, file })),
  }, null, 2)}\n`
}

function loadBaseline() {
  if (!fs.existsSync(baselineFile)) {
    throw new Error('v2 template baseline is missing; initialize once with --init-baseline')
  }
  return JSON.parse(fs.readFileSync(baselineFile, 'utf8'))
}

function buildInventory() {
  const capabilities = buildCapabilities()
  const capabilityIds = new Set(capabilities.map((item) => `${item.namespace}.${item.name}`))
  const aliasProbe = extractSspCalls(
    "const tool = ssp.objectsTool; tool.getById('x'); tool['getById']('b'); tool?.['getById']('c'); const asiTool = ssp.objectsTool\n asiTool.getById('asi'); const list = ssp.objectsTool.getById('y'); list.forEach(() => {}); ssp.objectsTool?.getById('z'); ssp.objectsTool?.['getById']('optional-bracket'); ssp.objectsTool.__unknown__(); ssp.objectsTool?.__unknown_optional__(); ssp.objectsTool['__unknown_bracket__'](); ssp.objectsTool?.['__unknown_optional_bracket__'](); tool['__unknown_alias__'](); tool?.[dynamicAliasMethod](); ssp.objectsTool[dynamicMethod](); ssp.objectsTool?.[dynamicOptionalMethod](); const indirect = ssp.objectsTool.getById; const { getById } = ssp.objectsTool; `${ssp.objectsTool.getById('template')}`; 'ssp.objectsTool.__string_only__()'; /* ssp.objectsTool.__comment_only__() */",
    capabilityIds,
  )
  if (aliasProbe.actualCalls.join(',') !== 'objectsTool.getById' ||
      aliasProbe.invalidSspCalls.join(',') !== '<template-interpolation>,objectsTool.<destructured-method>,objectsTool.<dynamic-method>,objectsTool.__unknown__,objectsTool.__unknown_alias__,objectsTool.__unknown_bracket__,objectsTool.__unknown_optional__,objectsTool.__unknown_optional_bracket__,objectsTool.getById.<indirect-reference>') {
    throw new Error(`SSP call extractor self-test failed: ${JSON.stringify(aliasProbe)}`)
  }
  const templates = walkJson(templateRoot).map((file) => analyzeTemplate(file, capabilityIds))
  const ids = new Set(templates.map((item) => item.id))
  if (ids.size !== templates.length) {
    throw new Error(`Legacy v2 template ids must be unique: found ${templates.length} files / ${ids.size} ids`)
  }
  const invalidCalls = templates.flatMap((template) => template.invalidSspCalls.map((call) => ({ template: template.id, call })))
  if (invalidCalls.length > 0) {
    throw new Error(`Unknown SSP calls: ${invalidCalls.map((item) => `${item.template} -> ${item.call}`).join(', ')}`)
  }
  const referencedBy = new Map(capabilities.map((item) => [`${item.namespace}.${item.name}`, []]))
  const acceptableReferences = new Map(capabilities.map((item) => [`${item.namespace}.${item.name}`, []]))
  const appDependentReferences = new Map(capabilities.map((item) => [`${item.namespace}.${item.name}`, []]))
  for (const template of templates) {
    for (const call of template.actualSspCalls) {
      referencedBy.get(call)?.push(template.id)
      if (template.classification === 'atomic' || template.classification === 'composite') {
        acceptableReferences.get(call)?.push(template.id)
      } else if (template.classification === 'app-dependent') {
        appDependentReferences.get(call)?.push(template.id)
      }
    }
  }
  const enrichedCapabilities = capabilities.map((item) => {
    const id = `${item.namespace}.${item.name}`
    const legacyReferences = uniqueSorted(referencedBy.get(id) ?? [])
    const mappedTemplates = uniqueSorted(acceptableReferences.get(id) ?? [])
    const appDependentTemplates = uniqueSorted(appDependentReferences.get(id) ?? [])
    const classification = mappedTemplates.length > 0
      ? 'mapped'
      : appDependentTemplates.length > 0
        ? 'blocked'
        : 'host-only'
    return {
      id,
      namespace: item.namespace,
      method: item.name,
      signature: item.signature,
      params: item.params,
      returnType: item.returnType,
      async: item.async,
      source: item.source,
      declaredIn: item.declaredIn,
      classification,
      classificationReason: classification === 'mapped'
        ? 'Referenced by current atomic/composite legacy v2 code; this does not imply AI exposure.'
        : classification === 'blocked'
          ? 'Referenced only by app-dependent legacy v2 code; a reviewed SSP-only mapping is required.'
          : 'No current legacy v2 template code reference; keep host-only until a reviewed v3 atomic mapping exists.',
      mappedTemplates,
      appDependentTemplates,
      legacyReferences,
    }
  })
  const counts = Object.fromEntries(['atomic', 'composite', 'non-SSP', 'app-dependent'].map((name) => [
    name,
    templates.filter((item) => item.classification === name).length,
  ]))
  const capabilityCounts = Object.fromEntries(['mapped', 'host-only', 'blocked', 'deprecated'].map((name) => [
    name,
    enrichedCapabilities.filter((item) => item.classification === name).length,
  ]))
  capabilityCounts.unclassified = enrichedCapabilities.filter((item) => !['mapped', 'host-only', 'blocked', 'deprecated'].includes(item.classification)).length
  const duplicateAtomicBindings = enrichedCapabilities
    .map((capability) => ({
      capability: capability.id,
      templates: templates
        .filter((template) => template.classification === 'atomic' && template.actualSspCalls.includes(capability.id))
        .map((template) => template.id)
        .sort(),
    }))
    .filter((item) => item.templates.length > 1)
  const sourceFiles = uniqueSorted(CONTROLLERS.flatMap((item) => item.interfaces.map(([file]) => file)))
  const implementationMethodPresence = SSP_PHASE0_IMPLEMENTATION.addedMethods.map((id) => ({
    id,
    presentInCheckout: capabilityIds.has(id),
  }))
  const implementationHandoff = {
    verifiedDate: SSP_PHASE0_IMPLEMENTATION.verifiedDate,
    status: SSP_PHASE0_IMPLEMENTATION.status,
    sourceIntegration: implementationMethodPresence.every((item) => item.presentInCheckout)
      ? 'integrated-in-current-checkout'
      : 'implemented-upstream-current-checkout-not-synced',
    expectedMethodsAfterIntegration: SSP_PHASE0_IMPLEMENTATION.expectedMethodsAfterIntegration,
    addedCapabilities: implementationMethodPresence,
    runtimeMigration: {
      status: 'pending',
      obligations: [...SSP_PHASE0_IMPLEMENTATION.runtimeObligations],
    },
    knownLegacyBlockers: [
      'query-scene still traverses scene, reads metadata, and creates timers in legacy code',
      'clearAllHighlights remains an AI-enabled legacy template although the API is host emergency only',
    ],
    upstreamValidationEvidence: [...SSP_PHASE0_IMPLEMENTATION.validationEvidence],
  }
  const manifest = {
    schemaVersion: 0,
    phase: 'template-layer-phase-0',
    sourceDigest: sha256(sourceFiles.map((file) => `${file}\n${read(file)}`).join('\n')),
    sspImplementationHandoff: implementationHandoff,
    summary: {
      controllers: CONTROLLERS.length,
      methods: enrichedCapabilities.length,
      classifications: capabilityCounts,
    },
    capabilities: enrichedCapabilities,
    templateInventory: {
      total: templates.length,
      classifications: counts,
      duplicateAtomicBindings,
      templates,
    },
  }
  return {
    manifest,
    implementationHandoff,
    templates,
    capabilities: enrichedCapabilities,
    counts,
    capabilityCounts,
    duplicateAtomicBindings,
  }
}

function renderReport(data) {
  const { templates, capabilities, counts, capabilityCounts, duplicateAtomicBindings, implementationHandoff } = data
  const appTemplates = templates.filter((item) => item.classification === 'app-dependent')
  const nonSspTemplates = templates.filter((item) => item.classification === 'non-SSP')
  const ignored = templates.filter((item) => item.ignoredParams.length > 0)
  const mismatches = templates.filter((item) => !item.methodMatchesCode)
  const unmapped = capabilities.filter((item) => item.classification !== 'mapped')
  const duplicatedReferences = capabilities.filter((item) => item.mappedTemplates.length > 1)
  const queryScene = templates.find((item) => item.id === 'query-scene')
  const clearAllHighlights = templates.find((item) => item.id === 'clearAllHighlights')
  const integratedAddedMethods = implementationHandoff.addedCapabilities.filter((item) => item.presentInCheckout).length
  const lines = [
    '# Template Layer Phase 0 Inventory',
    '',
    '> 自动生成：`npm run phase0:generate`。不要手工编辑。本模板任务不修改 SSP 源码。',
    '',
    '## 完成状态',
    '',
    `- Controller：${data.manifest.summary.controllers}/10`,
    `- Controller methods（当前 checkout 实际扫描）：${data.manifest.summary.methods}`,
    `- CR-SSP-001/003 新增方法（当前 checkout）：${integratedAddedMethods}/${implementationHandoff.addedCapabilities.length}`,
    `- SSP 合入后目标方法数：${implementationHandoff.expectedMethodsAfterIntegration}`,
    `- Capability classification：mapped ${capabilityCounts.mapped} / host-only ${capabilityCounts['host-only']} / blocked ${capabilityCounts.blocked} / deprecated ${capabilityCounts.deprecated}`,
    `- Unclassified：${capabilityCounts.unclassified}`,
    `- Legacy v2 templates：${templates.length}/${data.baselineTotal} baseline entries`,
    `- Template code classification：atomic ${counts.atomic} / composite ${counts.composite} / non-SSP ${counts['non-SSP']} / app-dependent ${counts['app-dependent']}`,
    '',
    capabilityCounts.unclassified === 0
      ? '**Phase 0 分类账完成：unclassified=0；SSP 已实施，模板 Runtime 语义迁移仍待完成。**'
      : '**Phase 0 未完成。**',
    '',
    '说明：`mapped` 表示至少有一个 atomic/composite v2 code 引用，不表示允许 AI 调用；`blocked` 表示只被 app-dependent 模板引用；`host-only` 表示当前没有 v2 code 引用。',
    '',
    '## SSP 实施交接与模板迁移门槛',
    '',
    `- SSP 状态：${implementationHandoff.status}`,
    `- 源码同步状态：${implementationHandoff.sourceIntegration}`,
    `- 已实施公共方法：${implementationHandoff.addedCapabilities.map((item) => `\`${item.id}\``).join(', ')}`,
    '- 当前清单只把本 checkout 中实际存在的方法计入 Capability classification，不伪造尚未合入此 checkout 的源码能力。',
    `- \`query-scene\` 当前状态：${queryScene?.classification ?? 'missing'}; dependencies=[${queryScene?.dependencies.join(', ') || 'none'}]。必须迁移为 \`query -> describe/action\`，不得再遍历 scene、直读 metadata 或创建 timer。`,
    `- \`clearAllHighlights\` 当前状态：aiEnabled=${clearAllHighlights?.aiEnabled === true}; classification=${clearAllHighlights?.classification ?? 'missing'}。该 SSP API 仅供宿主紧急全局恢复，AI/template 必须撤销直接调用。`,
    '- Runtime 待办：' + implementationHandoff.runtimeMigration.obligations.join('；') + '。',
    '- 主任务验证记录：' + implementationHandoff.upstreamValidationEvidence.join('、') + '。',
    '',
    '## Controller 计数',
    '',
    '| Namespace | Methods | Mapped | Blocked | Host-only |',
    '|---|---:|---:|---:|---:|',
  ]
  for (const controller of CONTROLLERS) {
    const entries = capabilities.filter((item) => item.namespace === controller.namespace)
    lines.push(`| ${controller.namespace} | ${entries.length} | ${entries.filter((item) => item.classification === 'mapped').length} | ${entries.filter((item) => item.classification === 'blocked').length} | ${entries.filter((item) => item.classification === 'host-only').length} |`)
  }
  lines.push('', '## 尚无可接受 v2 映射的 SSP 方法', '')
  if (unmapped.length === 0) lines.push('- 无')
  else unmapped.forEach((item) => lines.push(`- \`${item.id}\` — ${item.classification}; ${item.source}; app-dependent=[${item.appDependentTemplates.join(', ') || 'none'}]`))
  lines.push('', '## 非 SSP 或应用依赖模板', '')
  for (const item of [...appTemplates, ...nonSspTemplates]) {
    lines.push(`- \`${item.id}\` — ${item.classification}; dependencies=[${item.dependencies.join(', ') || 'none'}]; calls=[${item.actualSspCalls.join(', ') || 'none'}]`)
  }
  lines.push('', '## 重复映射', '', `- 被多个模板引用的 SSP 方法：${duplicatedReferences.length}`)
  duplicatedReferences.forEach((item) => lines.push(`  - \`${item.id}\` <- ${item.mappedTemplates.map((id) => `\`${id}\``).join(', ')}`))
  lines.push('', `- 被多个 atomic v2 模板一一绑定的方法：${duplicateAtomicBindings.length}`)
  duplicateAtomicBindings.forEach((item) => lines.push(`  - \`${item.capability}\` <- ${item.templates.map((id) => `\`${id}\``).join(', ')}`))
  lines.push('', '## 元数据与真实代码不一致', '', `共有 ${mismatches.length} 个模板的 \`method\` 元数据与实际 SSP 调用集合不一致。`)
  mismatches.forEach((item) => lines.push(`- \`${item.id}\`: metadata=[${item.metadataMethods.join(', ') || 'none'}], code=[${item.actualSspCalls.join(', ') || 'none'}]`))
  lines.push('', '## 参数消费', '', `共有 ${ignored.length} 个模板至少存在一个声明但未被 code 消费的参数。`)
  ignored.forEach((item) => lines.push(`- \`${item.id}\`: ignored=[${item.ignoredParams.join(', ')}], consumed=[${item.consumedParams.join(', ') || 'none'}]`))
  lines.push('', '## v2 冻结规则', '',
    '- `v2-template-baseline.json` 固定现有 code 模板的 id + path。',
    '- 删除现有 v2 模板允许用于迁移；新增或重命名含 `code` 的 v2 模板会使 `npm run audit:phase0` 失败。',
    '- 未知 SSP 方法、动态/间接方法访问、SSP 解构和模板字符串插值一律失败；冻结阶段不再扩展 legacy JavaScript 语法。',
    '- 只有显式运行 `--init-baseline` 才能重建基线；普通 generate/check 不会扩展基线。',
    '- Phase 1+ 新模板必须使用 v3 目录与声明式 schema，不得加入 legacy `ssp_templates` code 集合。',
  )
  return `${lines.join('\n')}\n`
}

function renderSspChangeRequest() {
  return `# SSP Change Requests from Template Phase 0

> 最后更新：2026-08-17
> 对接状态：主任务已获用户明确授权并完成 CR-SSP-001 与 CR-SSP-003 的 SSP 实施和复审；CR-SSP-002 维持关闭。
> 模板任务边界：本任务未修改任何 \`src/ssp/**\` 文件，也不重复实现 SSP。
> 职责边界：AI 公共输出的字段投影、脱敏、截断和最终序列化仍属于模板 Runtime，不下沉 SSP。

| 编号 | 最终状态 | SSP 结果 | 模板侧状态 |
|---|---|---|---|
| CR-SSP-001 | SSP 已批准并实施 | \`objectsTool.query\` / \`objectsTool.describe\` | \`query-scene\` 声明式组合迁移待完成 |
| CR-SSP-002 | 已驳回并关闭 | 不新增 SSP 命名视角能力 | 转宿主适配器/应用会话状态 |
| CR-SSP-003 | SSP 已批准并实施 | 不透明 \`HighlightLease\`、统一高亮状态引擎与 lifecycle cleanup | execution-local capability 接入待完成 |

## CR-SSP-001：有界结构化场景查询（SSP 已实施）

实施 namespace：\`ssp.objectsTool\`。

\`\`\`ts
query(
  criteria: ObjectQueryCriteria,
  options: { limit: number },
): THREE.Object3D[]

describe(
  objects: readonly THREE.Object3D[],
  options?: ObjectDescribeOptions,
): SceneObjectDescriptor[]
\`\`\`

已实施边界：

- \`SceneQueryField\` / \`SceneDescriptorField\` 是编译期白名单，不支持动态属性路径。
- 条件只允许扁平 AND 与 \`equals/in\`；最多 8 个条件，\`in\` 最多 50 个值，字符串查询值最长 256 字符。
- \`limit\` 必填且为 1～200；结果按稳定 scene traversal 顺序，达到上限立即停止。
- 输入只接受严格 plain-data shape/array；只返回当前 context/current scene 中具有稳定 \`sid\` 或 \`findId\` 的对象。
- \`describe\` 最多接收 200 个对象、最多 16 个字段；foreign/stale/无稳定 ID 的对象使整次调用原子失败。
- 描述结果只含有界 plain data，不返回任意 \`userData\` 对象。
- 不包含 \`group/compare/summarize/project/sort/offset/cursor\`，也不包含行业、项目、楼栋或楼层业务判断。
- 原有 \`getById/getByName/getByUserDataProperty\` 保持兼容。

\`query\` 返回的 \`Object3D[]\` 仅供受控 Runtime 内部步骤消费；AI 公共响应必须经过 Runtime 的 schema 投影、脱敏、截断和序列化。

模板侧待办：将旧 \`query-scene\` 拆为 \`query -> describe\`（只读）或 \`query -> setHighlight/flyToObject/setVisible\`（动作），删除模板内 scene traversal、metadata 直读、timer 和自由业务分支。

## CR-SSP-002：命名视角存取（继续关闭）

\`cameraController.getViewpoint/setViewpoint\` 已提供 SSP 原子能力；命名、默认值和持久化属于宿主应用/会话状态。宿主适配器保存受控状态，禁止 \`window.__chatStore\`，不新增 SSP API。

模板侧待办：\`captureMainViewpoint\` 移出严格 SSP 模板 Registry；默认视角由宿主解析，再调用通用 \`setViewpoint\` 原子模板，或保留为宿主触发动作。

## CR-SSP-003：受作用域约束的高亮租约（SSP 已实施）

实施 namespace：\`ssp.objectsTool\`。

\`\`\`ts
interface HighlightLease {
  readonly id: string
  readonly objectIds: readonly string[]
  readonly status: 'ACTIVE' | 'RELEASED' | 'EXPIRED'
}

applyHighlight(
  objects: readonly THREE.Object3D[],
  options?: HighlightOptions,
): HighlightLease

releaseHighlight(lease: HighlightLease): boolean
\`\`\`

已实施边界：

- SSP 只接受当前 manager 创建的原始 handle identity；复制、伪造或其他 manager 的 handle 被拒绝。真实 handle 首次释放返回 \`true\`，已释放/已过期后再次释放返回 \`false\`。
- 单租约最多 256 个对象，当前 context 最多 128 个活动租约，\`durationMs\` 为 100～300000ms。
- 状态按 \`mesh + material slot\` 维护，重叠采用 last-applied-wins；释放非顶层不改变视觉，释放顶层显示下一活动层，最后释放恢复原材质。
- 共享单材质和 \`Material[]\` 均使用 clone-on-write；最后一层结束后恢复原引用并 dispose SSP-owned clone。
- apply 失败原子回滚；子 Mesh/模型根移除、scene/context cleanup 会释放对应租约和视觉资源。
- pulse 使用 manager 级共享调度器，周期固定 500ms。
- legacy \`setHighlight/unHighlight/clearAllHighlights\` 接入同一状态引擎；\`setHighlight/unHighlight\` 兼容 detached/no-context，\`unHighlight\` 只释放 legacy owner layer。
- \`clearAllHighlights\` 仅保留为宿主紧急全局恢复能力，AI/template 和补偿流程不得直接调用。

模板 Runtime 仍必须实现：

- 每次 execution 独立的 capability table，租约只能在本 execution 的 internal output 中传递；
- 每 execution 最多 32 个活动租约，AI \`durationMs <= 60000\`；
- cancel/timeout/finally 时逐一释放本 execution 持有的原始 handle；
- 拒绝跨 execution 解引用、顶层参数伪造和公共输出句柄残留；
- AI 只接收如 \`{ applied, objectCount, expiresAt? }\` 的有界回执。

## 当前模板迁移风险

- 旧 \`query-scene\` 仍直接 traverse scene、读取 metadata 并创建 timer；现有审计通过不代表其满足严格 SSP 组合语义。
- \`clearAllHighlights\` 仍是 AI-enabled legacy 模板，但公共 API 已明确为 host-only 紧急恢复；必须撤销 AI 直接暴露。
- 新模板应使用通用 GLB metadata 命名，不得引入面向单一 fixture 或行业的生产命名。
- CR-SSP-001/003 的 SSP 实施已完成，但只有 Runtime capability、声明式组合和 AI policy 迁移完成后才算端到端关闭。

## 主任务实施与验证记录

主任务实施范围：

- \`src/ssp/objects/objectsTool.ts\`
- \`src/ssp/objects/highlightLeaseManager.ts\`
- \`src/ssp/core/context.ts\`（仅新增内部 cleanup hook，不挂到公共 \`ssp\` namespace）
- \`src/composables/useThreeScene.ts\`（销毁时先释放 scene-bound SSP 资源，再 dispose 模型材质）
- \`src/test/objects/objectsToolSuite.ts\`
- \`scripts/test-objects.mjs\`

本模板任务只读核对接口与提交，不修改上述 SSP 实施文件。主任务验证命令：

\`\`\`bash
npm run test:objects
npm run typecheck
npm run test:topology
npm run audit:topology-boundary
npm run audit:templates
npm run audit:ai-boundary
npm run build
\`\`\`

独立对象回归共 13 项，覆盖 inherited/non-enumerable 与严格输入、重叠与到期、伪造 handle、共享单材质与材质数组、异常原子回滚、资源上限、子 Mesh/模型根移除、复用 context 对象切换 scene、context 清理和 detached legacy 兼容。

实现授权不扩大到行业适配器。后续 topology 数据适配必须以“通用 GLB metadata -> world-space 显式 graph”为目标；行业模型仅可作为测试 fixture，生产函数、变量、模板和文档不得使用 \`hospital-navigation\` 一类定向命名。
`
}
function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true })
}

function writeFile(file, content) {
  ensureDirectory(path.dirname(file))
  fs.writeFileSync(file, content)
}

function checkFile(file, expected) {
  if (!fs.existsSync(file)) throw new Error(`Generated file missing: ${relative(file)}`)
  const actual = fs.readFileSync(file, 'utf8')
  if (actual !== expected) throw new Error(`Generated file is stale: ${relative(file)}; run npm run phase0:generate`)
}

try {
  const data = buildInventory()
  const currentBaseline = baselineContent(data.templates)
  if (shouldInitBaseline) {
    if (fs.existsSync(baselineFile) && !args.has('--force')) {
      throw new Error('Baseline already exists; refusing to replace it without --force')
    }
    writeFile(baselineFile, currentBaseline)
    console.log(`[phase0] initialized ${relative(baselineFile)}`)
  }
  const baseline = loadBaseline()
  if (baseline.schemaVersion !== 1 || !Array.isArray(baseline.templates)) {
    throw new Error('Invalid v2 template baseline schema')
  }
  const baselineKeys = baseline.templates.map((item) => `${item.id}\0${item.file}`)
  if (new Set(baselineKeys).size !== baselineKeys.length) {
    throw new Error('v2 template baseline contains duplicate id/path entries')
  }
  data.baselineTotal = baseline.templates.length
  const allowed = new Set(baselineKeys)
  const additions = data.templates.filter((item) => item.hasCode && !allowed.has(`${item.id}\0${item.file}`))
  if (additions.length > 0) {
    throw new Error(`Legacy v2 code-template freeze violation: ${additions.map((item) => `${item.id} (${item.file})`).join(', ')}`)
  }
  const manifestContent = `${JSON.stringify(data.manifest, null, 2)}\n`
  const reportContent = renderReport(data)
  const requestContent = renderSspChangeRequest()
  if (shouldWrite) {
    writeFile(manifestFile, manifestContent)
    writeFile(reportFile, reportContent)
    writeFile(requestFile, requestContent)
  }
  if (shouldCheck) {
    checkFile(manifestFile, manifestContent)
    checkFile(reportFile, reportContent)
    checkFile(requestFile, requestContent)
  }
  console.log(`[phase0] PASS controllers=${data.manifest.summary.controllers} methods=${data.manifest.summary.methods} unclassified=${data.capabilityCounts.unclassified} templates=${data.templates.length}`)
  console.log(`[phase0] SSP handoff=${data.implementationHandoff.status} source=${data.implementationHandoff.sourceIntegration}`)
  console.log(`[phase0] template classes atomic=${data.counts.atomic} composite=${data.counts.composite} non-SSP=${data.counts['non-SSP']} app-dependent=${data.counts['app-dependent']}`)
} catch (error) {
  console.error(`[phase0] FAIL ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
