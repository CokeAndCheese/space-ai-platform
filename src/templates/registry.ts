import type { TemplateDefinition, TemplateParamDefinition } from './types'
import { z } from 'zod'

type ImportedTemplate = TemplateDefinition | { default: TemplateDefinition }

const importedTemplates = import.meta.glob<ImportedTemplate>('./ssp_templates/**/*.json', {
  eager: true,
  import: 'default',
})

/** Legacy model outputs are normalized only at AI ingress. Runtime ids stay strict. */
const TEMPLATE_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  explodeFloors: 'explode-floor',
  explodeFloor: 'explode-floor',
  collapseFloors: 'collapse-floor',
  collapseFloor: 'collapse-floor',
})

const QueryTargetSchema = z.object({
  renderType: z.enum(['WINDOW', 'DOOR', 'ELEVATOR', 'STAIR', 'CEILING', 'WALL', 'SPACE', 'FACILITY']).optional(),
  fireType: z.enum([
    'HYDRANT', 'SMOKE_DETECTOR', 'SPRINKLER', 'EXTINGUISHER', 'EMERGENCY_LIGHT',
    'EXIT_SIGN', 'BREAK_GLASS', 'ALARM_BELL', 'FIRE_HOSE', 'FIRE_DOOR', 'OTHER',
  ]).optional(),
  spaceType: z.enum([
    'TOILET', 'LAUNDRY', 'KITCHEN', 'OFFICE', 'MEETING_ROOM', 'BEDROOM',
    'CORRIDOR', 'STAIRWELL', 'ELEVATOR_HALL', 'MECHANICAL_ROOM', 'STORAGE', 'LOBBY', 'BALCONY',
  ]).optional(),
  sid: z.string().min(1).optional(),
  meshName: z.string().min(1).optional(),
}).strict()

const QueryScopeSchema = z.object({
  buildings: z.array(z.enum(['A', 'B', 'C'])).optional(),
  levels: z.array(z.number().int().min(-10).max(50)).optional(),
  floorNames: z.array(z.string().min(1)).optional(),
  floorTypes: z.array(z.enum([
    'FLOOR', 'TOWER', 'ROOF', 'BASEMENT',
    'LANDSCAPE_TERRAIN', 'LANDSCAPE_FACADE', 'FACILITY',
  ])).optional(),
  directions: z.array(z.enum(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'])).optional(),
}).strict()

const TEMPLATE_PARAM_SCHEMAS: Readonly<Record<string, z.ZodType>> = Object.freeze({
  'query-scene': z.object({
    entity: z.enum(['object', 'floor']).optional(),
    operation: z.enum([
      'list', 'count', 'locate', 'highlight', 'flash', 'focus',
      'hide', 'show', 'isolate', 'compare', 'summarize',
    ]),
    target: QueryTargetSchema.optional(),
    scope: QueryScopeSchema.optional(),
    groupBy: z.enum([
      'renderType', 'fireType', 'spaceType',
      'building', 'level', 'direction', 'floorName',
    ]).optional(),
    visual: z.object({
      color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      duration: z.number().int().min(0).max(60_000).optional(),
    }).strict().optional(),
    output: z.object({
      format: z.enum(['list', 'table', 'chart', 'text']).optional(),
      limit: z.number().int().positive().max(10_000).optional(),
    }).strict().optional(),
  }).strict().superRefine((value, ctx) => {
    if (value.entity !== 'floor') return
    if (value.operation !== 'count' && value.operation !== 'summarize') {
      ctx.addIssue({
        code: 'custom',
        path: ['operation'],
        message: 'floor entity only supports count or summarize',
      })
    }
    if (value.groupBy !== undefined && value.groupBy !== 'building') {
      ctx.addIssue({
        code: 'custom',
        path: ['groupBy'],
        message: 'floor entity only supports groupBy=building',
      })
    }
  }),
  'explode-floor': z.object({
    gap: z.number().min(0).max(200).optional(),
    axis: z.enum(['x', 'y', 'z']).optional(),
    durationMs: z.number().int().min(0).max(10_000).optional(),
  }).strict(),
  'collapse-floor': z.object({
    durationMs: z.number().int().min(0).max(10_000).optional(),
  }).strict(),
  fitScene: z.object({
    view: z.enum(['iso', 'front', 'top', 'side', 'current']).optional(),
    padding: z.number().min(1).max(5).optional(),
    maxSafeDistance: z.number().positive().max(700).optional(),
    animate: z.boolean().optional(),
  }).strict(),
  flyToMainViewpoint: z.object({ viewpoint: z.record(z.string(), z.unknown()).optional() }).strict(),
  captureMainViewpoint: z.object({}).strict(),
  resetVisibility: z.object({}).strict(),
  help: z.object({}).strict(),
})

function unwrapTemplate(value: ImportedTemplate): TemplateDefinition {
  if ('default' in value) return value.default
  return value
}

function filenameFromPath(path: string): string {
  return path.split('/').pop() ?? path
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor'])

function paramPath(name: string): string[] {
  const segments = name.split('.').filter(Boolean)
  if (segments.length === 0 || segments.some((segment) => FORBIDDEN_PATH_SEGMENTS.has(segment))) {
    throw new Error(`[templates] invalid param path: ${name}`)
  }
  return segments
}

function readParamPath(
  params: Record<string, unknown>,
  name: string,
): { exists: boolean; value: unknown } {
  let current: unknown = params
  for (const segment of paramPath(name)) {
    if (!current || typeof current !== 'object' || !hasOwn(current, segment)) {
      return { exists: false, value: undefined }
    }
    current = (current as Record<string, unknown>)[segment]
  }
  return { exists: true, value: current }
}

function writeParamPath(
  params: Record<string, unknown>,
  name: string,
  value: unknown,
): void {
  const segments = paramPath(name)
  let current = params
  for (let index = 0; index < segments.length - 1; index++) {
    const segment = segments[index]
    const exists = hasOwn(current, segment)
    const existing = current[segment]
    if (exists && !isPlainRecord(existing)) {
      throw new Error(`[templates] invalid param container: ${segments.slice(0, index + 1).join('.')}`)
    }
    const next: Record<string, unknown> = exists
      ? { ...(existing as Record<string, unknown>) }
      : {}
    current[segment] = next
    current = next
  }
  current[segments[segments.length - 1]] = value
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

interface ParamPathNode {
  terminal: boolean
  children: Map<string, ParamPathNode>
}

function createPathNode(): ParamPathNode {
  return { terminal: false, children: new Map() }
}

function buildParamPathTree(schema: ReadonlyArray<TemplateParamDefinition>): ParamPathNode {
  const root = createPathNode()
  for (const param of schema) {
    let current = root
    for (const segment of paramPath(param.name)) {
      let child = current.children.get(segment)
      if (!child) {
        child = createPathNode()
        current.children.set(segment, child)
      }
      current = child
    }
    current.terminal = true
  }
  return root
}

function validateParamShape(
  value: Record<string, unknown>,
  node: ParamPathNode,
  prefix = '',
): void {
  for (const [key, childValue] of Object.entries(value)) {
    const childNode = node.children.get(key)
    const path = prefix ? `${prefix}.${key}` : key
    if (!childNode) throw new Error(`[templates] unknown param: ${path}`)

    // A terminal object parameter (for example query-scene.target) owns its
    // nested schema. AI-enabled templates validate that content with Zod.
    if (childNode.terminal) continue
    if (!isPlainRecord(childValue)) {
      throw new Error(`[templates] invalid param container: ${path}`)
    }
    validateParamShape(childValue, childNode, path)
  }
}

function normalizeDefault(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) ||
      (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1)
  }
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed !== '' && Number.isFinite(Number(trimmed))) return Number(trimmed)
  return value
}

function valueMatchesType(value: unknown, param: TemplateParamDefinition): boolean {
  if (value === undefined) return !param.required
  if (value === null) return /\bnull\b/i.test(param.type)
  if (param.enum && !param.enum.includes(value)) return false

  const type = param.type.toLowerCase()
  if (type.includes('[]')) return Array.isArray(value)
  const allowsNumber = /\bnumber\b/.test(type)
  const allowsBoolean = /\bboolean\b/.test(type)
  const allowsString = /\bstring\b/.test(type) || /'[^']*'/.test(type)
  const allowsFunction = /\bfunction\b/.test(type) || type.includes('=>')
  const allowsObject = type.includes('object') || type.includes('{') ||
    type.includes('viewpoint') || /\bvec\d?\b/.test(type) || type.includes('options')

  if (allowsNumber && typeof value === 'number' && Number.isFinite(value)) return true
  if (allowsBoolean && typeof value === 'boolean') return true
  if (allowsString && typeof value === 'string') return true
  if (allowsFunction && typeof value === 'function') return true
  if (allowsObject && typeof value === 'object' && !Array.isArray(value)) return true

  return !allowsNumber && !allowsBoolean && !allowsString && !allowsFunction && !allowsObject
}

export class TemplateRegistry {
  private readonly definitions = new Map<string, Readonly<TemplateDefinition>>()

  constructor(modules: Record<string, ImportedTemplate>) {
    for (const [sourcePath, imported] of Object.entries(modules)) {
      const raw = unwrapTemplate(imported)
      if (!raw?.id || !raw.code) {
        throw new Error(`[templates] invalid template module: ${sourcePath}`)
      }
      if (this.definitions.has(raw.id)) {
        throw new Error(`[templates] duplicate template id: ${raw.id}`)
      }
      const definition = Object.freeze({
        ...raw,
        intent: raw.intent ?? [],
        params: raw.params ?? [],
        sourcePath,
        filename: filenameFromPath(sourcePath),
      })
      if (definition.aiEnabled === true && !TEMPLATE_PARAM_SCHEMAS[definition.id]) {
        throw new Error(`[templates] AI template has no param validator: ${definition.id}`)
      }
      this.definitions.set(definition.id, definition)
    }

    for (const id of Object.keys(TEMPLATE_PARAM_SCHEMAS)) {
      if (this.definitions.get(id)?.aiEnabled !== true) {
        throw new Error(`[templates] orphan AI param validator: ${id}`)
      }
    }
  }

  all(): ReadonlyArray<Readonly<TemplateDefinition>> {
    return Array.from(this.definitions.values()).sort((a, b) => a.id.localeCompare(b.id))
  }

  aiEnabled(): ReadonlyArray<Readonly<TemplateDefinition>> {
    return this.all().filter((definition) => definition.aiEnabled === true)
  }

  canonicalId(id: string): string | null {
    return this.definitions.has(id) ? id : null
  }

  get(id: string): Readonly<TemplateDefinition> | undefined {
    const canonicalId = this.canonicalId(id)
    return canonicalId ? this.definitions.get(canonicalId) : undefined
  }

  require(id: string): Readonly<TemplateDefinition> {
    const definition = this.get(id)
    if (!definition) throw new Error(`[templates] unknown template: ${id}`)
    return definition
  }

  isAiEnabled(id: string): boolean {
    return this.get(id)?.aiEnabled === true
  }

  prepareParams(
    definition: Readonly<TemplateDefinition>,
    input: Record<string, unknown>,
    strict = true,
  ): Record<string, unknown> {
    const params = { ...input }
    const schema = definition.params ?? []
    if (strict) validateParamShape(params, buildParamPathTree(schema))

    for (const param of schema) {
      const current = readParamPath(params, param.name)
      if (!current.exists && param.default !== undefined) {
        const normalized = normalizeDefault(param.default)
        // Some legacy metadata defaults are prose or JS-like object examples.
        // Only inject defaults that are already valid literal values.
        if (valueMatchesType(normalized, param)) {
          writeParamPath(params, param.name, normalized)
        }
      }
    }

    for (const param of schema) {
      const current = readParamPath(params, param.name)
      if (param.required && !current.exists) {
        throw new Error(`[templates] ${definition.id} missing required param: ${param.name}`)
      }
      if (current.exists && !valueMatchesType(current.value, param)) {
        throw new Error(`[templates] ${definition.id} invalid param ${param.name}; expected ${param.type}`)
      }
    }

    if (definition.aiEnabled === true) {
      const validator = TEMPLATE_PARAM_SCHEMAS[definition.id]
      if (!validator) throw new Error(`[templates] AI template has no param validator: ${definition.id}`)
      const parsed = validator.safeParse(params)
      if (!parsed.success) {
        const issue = parsed.error.issues[0]
        const path = issue.path.length > 0 ? issue.path.join('.') : 'params'
        throw new Error(`[templates] ${definition.id} invalid ${path}: ${issue.message}`)
      }
    }
    return params
  }

  toAiPromptSection(excludedIds: ReadonlySet<string> = new Set()): string {
    return this.aiEnabled().filter((definition) => !excludedIds.has(definition.id)).map((definition) => {
      const lines = [`### ${definition.id}`]
      lines.push(`用途: ${definition.intent.join('；')}`)
      const params = definition.params ?? []
      if (params.length === 0) {
        lines.push('参数: {}')
      } else {
        lines.push('参数:')
        for (const param of params) {
          const flags = [param.type, param.required ? '必填' : '可选']
          if (param.default !== undefined) flags.push(`默认=${JSON.stringify(normalizeDefault(param.default))}`)
          lines.push(`- ${param.name} (${flags.join(', ')}): ${param.desc ?? param.description ?? ''}`)
        }
      }
      if (definition.returns) lines.push(`返回: ${definition.returns}`)
      if (definition.guard?.length) lines.push(`约束: ${definition.guard.join('；')}`)
      return lines.join('\n')
    }).join('\n\n')
  }
}

export const templateRegistry = new TemplateRegistry(importedTemplates)

export function normalizeTemplateAlias(id: string): string {
  return TEMPLATE_ALIASES[id] ?? id
}

export function resolveAiTemplateId(id: string): string | null {
  const candidate = normalizeTemplateAlias(id)
  const canonicalId = templateRegistry.canonicalId(candidate)
  if (!canonicalId || !templateRegistry.isAiEnabled(canonicalId)) return null
  return canonicalId
}

export type { TemplateDefinition, TemplateParamDefinition } from './types'
