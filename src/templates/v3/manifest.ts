import generatedManifest from '../manifest/ssp-capabilities.generated.json'
import { isPlainObject, validateJsonSchema } from './jsonSchema'
import type { AtomicCapabilityContract, SspCapability, SspManifest } from './types'

export type ManifestLike = SspManifest | readonly SspCapability[]

function asManifest(manifest: ManifestLike): SspManifest {
  return Array.isArray(manifest) ? { capabilities: manifest } : manifest as SspManifest
}

function methodId(method: string): { namespace: string; member: string } {
  const match = /^([A-Za-z_$][A-Za-z0-9_$]*)\.([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(method)
  if (!match) throw new Error(`Invalid static SSP method: ${method}`)
  return { namespace: match[1], member: match[2] }
}

function validateStringArray(value: unknown, path: string, allowEmpty = true): asserts value is readonly string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new Error(`${path} must be ${allowEmpty ? 'an array' : 'a non-empty array'} of strings`)
  }
  if (new Set(value).size !== value.length) throw new Error(`${path} must not contain duplicates`)
}

function validateAtomicContract(
  value: unknown,
  capabilityId: string,
  params: SspCapability['params'],
  returnType: string | undefined,
): asserts value is AtomicCapabilityContract {
  if (!isPlainObject(value) || Object.keys(value).some((key) => !['templateIds', 'args', 'result'].includes(key))) {
    throw new Error(`${capabilityId}: malformed atomic capability contract`)
  }
  validateStringArray(value.templateIds, `${capabilityId}.atomicContract.templateIds`, false)
  if (!Array.isArray(value.args) || value.args.length !== (params?.length ?? 0)) {
    throw new Error(`${capabilityId}: atomic contract must describe every SSP parameter`)
  }
  value.args.forEach((argument, index) => {
    if (!isPlainObject(argument) || Object.keys(argument).some((key) => !['required', 'schema'].includes(key)) || typeof argument.required !== 'boolean') {
      throw new Error(`${capabilityId}: malformed atomic argument contract at index ${index}`)
    }
    if (argument.required !== params?.[index]?.required) {
      throw new Error(`${capabilityId}: atomic argument required flag mismatch at index ${index}`)
    }
    validateJsonSchema(argument.schema, `${capabilityId}.atomicContract.args[${index}].schema`)
  })
  if (!isPlainObject(value.result) || typeof value.result.kind !== 'string') {
    throw new Error(`${capabilityId}: malformed atomic result contract`)
  }
  const resultKeys = Object.keys(value.result)
  if (value.result.kind === 'public-data') {
    if (resultKeys.some((key) => !['kind', 'schema'].includes(key)) || !('schema' in value.result)) {
      throw new Error(`${capabilityId}: public-data result contract requires only kind and schema`)
    }
    validateJsonSchema(value.result.schema, `${capabilityId}.atomicContract.result.schema`)
  } else if (['void', 'object-ref', 'object-ref-array'].includes(value.result.kind)) {
    if (resultKeys.length !== 1) throw new Error(`${capabilityId}: ${value.result.kind} result contract accepts only kind`)
  } else {
    throw new Error(`${capabilityId}: unsupported atomic result contract kind`)
  }
  const returnShape = classifyReturnType(returnType)
  if (value.result.kind === 'void' && returnShape !== 'void') {
    throw new Error(`${capabilityId}: void atomic contract conflicts with SSP return type`)
  }
  if (value.result.kind !== 'void' && returnShape === 'void') {
    throw new Error(`${capabilityId}: non-void atomic contract conflicts with SSP return type`)
  }
  if (value.result.kind === 'object-ref' && returnShape !== 'object') {
    throw new Error(`${capabilityId}: object-ref atomic contract requires an object SSP return`)
  }
  if (value.result.kind === 'object-ref-array' && returnShape !== 'object-array') {
    throw new Error(`${capabilityId}: object-ref-array atomic contract requires an object-array SSP return`)
  }
  if (value.result.kind === 'public-data') {
    const schemaShape = classifySchema(value.result.schema)
    const comparableReturn = returnShape === 'object-array' || returnShape === 'primitive-array'
      ? 'array'
      : returnShape
    if (['object', 'array', 'string', 'number', 'boolean', 'null'].includes(comparableReturn) && schemaShape !== 'unknown' && schemaShape !== comparableReturn) {
      throw new Error(`${capabilityId}: public-data schema conflicts with SSP return type`)
    }
  }
}

type ContractShape = 'void' | 'object' | 'object-array' | 'primitive-array' | 'string' | 'number' | 'boolean' | 'null' | 'function' | 'unknown'

function unwrapPromise(value: string): string {
  const normalized = value.trim()
  const promise = /^Promise<([\s\S]+)>$/.exec(normalized)
  return (promise?.[1] ?? normalized).trim()
}

function classifyReturnType(value: string | undefined): ContractShape {
  const normalized = unwrapPromise(value ?? '')
  const members = normalized.split('|').map((member) => member.trim()).filter((member) => member !== 'undefined' && member !== 'null')
  if (members.length === 0) return normalized.includes('null') ? 'null' : 'void'
  if (members.length > 1) {
    const shapes = new Set(members.map((member) => classifyReturnType(member)))
    return shapes.size === 1 ? [...shapes][0] : 'unknown'
  }
  const member = members[0]
  if (member === 'void' || member === 'undefined') return 'void'
  if (member === 'string' || /^['"`]/.test(member)) return 'string'
  if (member === 'number' || /^-?\d/.test(member)) return 'number'
  if (member === 'boolean' || member === 'true' || member === 'false') return 'boolean'
  if (/=>/.test(member) || /^Function\b/.test(member)) return 'function'
  const genericArray = /^(?:readonly\s+)?Array<([\s\S]+)>$/.exec(member)
  const suffixArray = /^([\s\S]+)\[\]$/.exec(member)
  const element = genericArray?.[1] ?? suffixArray?.[1]
  if (element) {
    const elementShape = classifyReturnType(element.replace(/^readonly\s+/, ''))
    return ['string', 'number', 'boolean', 'null'].includes(elementShape) ? 'primitive-array' : 'object-array'
  }
  if (member.startsWith('{') || /^[A-Za-z_$][A-Za-z0-9_$.]*(?:<.*>)?$/.test(member)) return 'object'
  return 'unknown'
}

function classifySchema(schema: unknown): ContractShape | 'array' {
  if (!isPlainObject(schema)) return 'unknown'
  if (typeof schema.type === 'string') return schema.type === 'integer' ? 'number' : schema.type as ContractShape | 'array'
  if (Array.isArray(schema.anyOf)) {
    const shapes = new Set(schema.anyOf.map(classifySchema))
    return shapes.size === 1 ? [...shapes][0] : 'unknown'
  }
  return 'unknown'
}

export class SspCapabilityManifest {
  readonly capabilities: readonly SspCapability[]
  private readonly byId: ReadonlyMap<string, SspCapability>

  constructor(manifest: ManifestLike = generatedManifest as unknown as SspManifest) {
    const normalized = asManifest(manifest)
    if (!Array.isArray(normalized.capabilities)) throw new Error('SSP manifest capabilities must be an array')
    const entries = normalized.capabilities.map((capability) => {
      if (!isPlainObject(capability) || typeof capability.id !== 'string' || typeof capability.namespace !== 'string' || typeof capability.method !== 'string') throw new Error('Malformed SSP manifest capability')
      const id = `${capability.namespace}.${capability.method}`
      if (id !== capability.id) throw new Error(`SSP manifest capability id mismatch: ${capability.id}`)
      methodId(id)
      if (typeof capability.async !== 'boolean') throw new Error(`${id}: async must be boolean`)
      if (!Array.isArray(capability.params) || capability.params.some((param) => !isPlainObject(param) || typeof param.name !== 'string' || typeof param.required !== 'boolean' || (param.type !== undefined && typeof param.type !== 'string'))) {
        throw new Error(`${id}: params must be declared SSP parameter records`)
      }
      if (capability.returnType !== undefined && typeof capability.returnType !== 'string') throw new Error(`${id}: returnType must be a string`)
      const templatePolicy = capability.templatePolicy
      if (templatePolicy !== undefined && (typeof templatePolicy !== 'string' || !['allowed', 'host-only', 'blocked'].includes(templatePolicy))) {
        throw new Error(`${id}: invalid templatePolicy`)
      }
      if (capability.mappedTemplates !== undefined) validateStringArray(capability.mappedTemplates, `${id}.mappedTemplates`)
      if (capability.templatePolicy === 'allowed' && (!capability.mappedTemplates || capability.mappedTemplates.length === 0)) {
        throw new Error(`${id}: allowed capability requires a non-empty mappedTemplates allow-list`)
      }
      if (capability.atomicContract !== undefined) validateAtomicContract(capability.atomicContract, id, capability.params, capability.returnType)
      return capability as unknown as SspCapability
    })
    const byId = new Map<string, SspCapability>()
    for (const capability of entries) {
      if (byId.has(capability.id)) throw new Error(`Duplicate SSP manifest capability: ${capability.id}`)
      byId.set(capability.id, capability)
    }
    this.capabilities = Object.freeze(entries)
    this.byId = byId
  }

  get(method: string): SspCapability | undefined {
    return this.byId.get(method)
  }

  require(method: string): SspCapability {
    const parsed = methodId(method)
    const capability = this.byId.get(`${parsed.namespace}.${parsed.member}`)
    if (!capability) throw new Error(`Unknown SSP capability: ${method}`)
    const policy = capability.templatePolicy
    const allowed = policy === 'allowed' || (policy === undefined && capability.classification === 'mapped')
    if (!allowed) {
      throw new Error(`SSP capability is not template-allowed: ${method}`)
    }
    return capability
  }

  isAllowed(method: string): boolean {
    try { this.require(method); return true } catch { return false }
  }

  validateBinding(method: string, argCount: number): SspCapability {
    const capability = this.require(method)
    const params = capability.params ?? []
    const required = params.filter((param) => param.required).length
    if (argCount < required || argCount > params.length) throw new Error(`${method}: expected ${required}-${params.length} arguments, received ${argCount}`)
    return capability
  }

  validateTemplateBinding(
    method: string,
    argCount: number,
    templateId: string,
  ): SspCapability {
    const capability = this.validateBinding(method, argCount)
    if (!capability.mappedTemplates?.includes(templateId)) {
      throw new Error(`${method}: template ${templateId} is not approved by the SSP manifest`)
    }
    if (!capability.atomicContract?.templateIds.includes(templateId)) {
      throw new Error(`${method}: template ${templateId} has no machine-checkable atomic contract`)
    }
    return capability
  }
}

export const defaultSspManifest = new SspCapabilityManifest()

export function getSspCapability(method: string, manifest: SspCapabilityManifest = defaultSspManifest): SspCapability {
  return manifest.require(method)
}
