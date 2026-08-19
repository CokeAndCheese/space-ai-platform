import { SspCapabilityManifest, type ManifestLike } from './manifest'
import {
  assertSafeJson,
  isPlainObject,
  schemaAtPath,
  validateAndApplyDefaults,
  validateJsonSchema,
  validateValueAgainstSchema,
} from './jsonSchema'
import type {
  AtomicCapabilityContract,
  AtomicResult,
  AtomicTemplateDefinition,
  CallArgument,
  JsonValue,
  RegisteredAtomicTemplate,
  TaggedAtomicTemplate,
} from './types'
import type { JsonSchema } from './types'

const TEMPLATE_KEYS = new Set([
  'schemaVersion', 'id', 'version', 'kind', 'title', 'description', 'intents', 'input', 'internalOutput', 'output',
  'effects', 'risk', 'ai', 'timeoutMs', 'tags', 'deprecated', 'call',
])
const RESULT_KEYS: Record<AtomicResult['kind'], readonly string[]> = {
  direct: ['kind'],
  receipt: ['kind', 'value'],
  'object-ref': ['kind', 'receipt'],
  'object-ref-array': ['kind', 'receipt'],
}
const EFFECTS = new Set(['scene.read', 'scene.write', 'camera.write', 'object.highlight', 'object.visibility', 'model.load', 'model.unload', 'topology.write', 'dom.write', 'download', 'timer', 'destructive'])
const RISKS = new Set(['read', 'visual', 'state', 'destructive', 'external'])

function definitionError(id: string, message: string): never {
  throw new Error(`Template ${id}: ${message}`)
}

function exactKeys(value: Record<string, unknown>, allowed: Set<string>, path: string): void {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${path}.${key}: unsupported field`)
}

function validateResult(result: unknown, id: string): asserts result is AtomicResult {
  if (!isPlainObject(result) || typeof result.kind !== 'string' || !(result.kind in RESULT_KEYS)) definitionError(id, 'call.result is invalid')
  const kind = result.kind as AtomicResult['kind']
  const expected = RESULT_KEYS[kind]
  if (Object.keys(result).some((key) => !expected.includes(key)) || expected.some((key) => !(key in result))) definitionError(id, `call.result for ${kind} has unsupported fields`)
  if (kind !== 'direct') assertSafeJson(result[kind === 'receipt' ? 'value' : 'receipt'], `Template ${id} call.result`)
}

function validateArgument(argument: unknown, input: AtomicTemplateDefinition['input'], id: string): asserts argument is CallArgument {
  if (!isPlainObject(argument)) definitionError(id, 'call.args entries must be objects')
  const keys = Object.keys(argument)
  const isInput = '$input' in argument
  const isLiteral = '$literal' in argument
  if (isInput === isLiteral || keys.some((key) => key !== '$input' && key !== '$literal' && key !== 'default')) definitionError(id, 'call.args entries must be mutually exclusive $input or $literal objects')
  if (isInput) {
    if (typeof argument.$input !== 'string') definitionError(id, '$input path must be a string')
    const pathSchema = (() => { try { return schemaAtPath(input, argument.$input) } catch (error) { throw new Error(`Template ${id}: ${error instanceof Error ? error.message : String(error)}`) } })()
    if ('default' in argument) validateValueAgainstSchema(argument.default, pathSchema, `Template ${id} call.args default`)
  } else {
    if ('default' in argument) definitionError(id, '$literal entries cannot have default')
    assertSafeJson(argument.$literal, `Template ${id} call.args literal`)
  }
}

function inputPathIsGuaranteed(schema: JsonSchema, path: string): boolean {
  const segments = path.split('.')
  function visit(current: JsonSchema, index: number): boolean {
    if (current.anyOf) return current.anyOf.every((candidate) => visit(candidate, index))
    if (current.type !== 'object') return false
    const segment = segments[index]
    const child = current.properties?.[segment]
    if (!child) return false
    const present = current.required?.includes(segment) === true || child.default !== undefined
    if (!present) return false
    return index === segments.length - 1 || visit(child, index + 1)
  }
  return visit(schema, 0)
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function validateArgumentContract(
  argument: CallArgument,
  input: JsonSchema,
  contract: AtomicCapabilityContract['args'][number],
  id: string,
  index: number,
): void {
  if ('$literal' in argument) {
    validateValueAgainstSchema(argument.$literal, contract.schema, `Template ${id} call.args[${index}]`)
    return
  }
  const inputSchema = schemaAtPath(input, argument.$input)
  if (canonicalJson(inputSchema) !== canonicalJson(contract.schema)) {
    definitionError(id, `call.args[${index}] input schema does not match the Manifest atomic contract`)
  }
  if ('default' in argument) {
    validateValueAgainstSchema(argument.default, contract.schema, `Template ${id} call.args[${index}] default`)
  }
}

function validateResultContract(
  result: AtomicResult,
  output: JsonSchema,
  contract: AtomicCapabilityContract['result'],
  id: string,
): void {
  const expectedKind = result.kind === 'direct'
    ? 'public-data'
    : result.kind === 'receipt'
      ? 'void'
      : result.kind
  if (contract.kind !== expectedKind) {
    definitionError(id, `call.result ${result.kind} conflicts with Manifest atomic result ${contract.kind}`)
  }
  if (result.kind === 'direct' && contract.kind === 'public-data' && canonicalJson(output) !== canonicalJson(contract.schema)) {
    definitionError(id, 'output schema does not match the Manifest atomic result contract')
  }
}

export function validateAtomicDefinition(definition: unknown, manifest: SspCapabilityManifest): asserts definition is AtomicTemplateDefinition {
  if (!isPlainObject(definition)) throw new Error('Template definition must be a plain object')
  assertSafeJson(definition, 'Template definition')
  const id = typeof definition.id === 'string' ? definition.id : '<unknown>'
  exactKeys(definition, TEMPLATE_KEYS, `Template ${id}`)
  const template = definition as unknown as AtomicTemplateDefinition
  if (definition.schemaVersion !== 3 || definition.kind !== 'atomic') definitionError(id, 'only schemaVersion 3 atomic templates are supported')
  for (const field of ['id', 'version', 'title', 'description'] as const) if (typeof definition[field] !== 'string' || definition[field].length === 0) definitionError(id, `${field} must be a non-empty string`)
  if (!/^[A-Za-z][A-Za-z0-9._-]*$/.test(template.id)) definitionError(id, 'id has invalid characters')
  if (!Array.isArray(definition.intents) || definition.intents.length === 0 || definition.intents.length > 32 || definition.intents.some((intent) => typeof intent !== 'string' || intent.length === 0 || intent.length > 256)) definitionError(id, 'intents must contain 1-32 bounded strings')
  if (!isPlainObject(definition.input) || !isPlainObject(definition.output)) definitionError(id, 'input and output must be JSON Schema objects')
  validateJsonSchema(definition.input)
  validateJsonSchema(definition.output)
  if (definition.input.type !== 'object') definitionError(id, 'input schema must be an object')
  if (definition.internalOutput !== undefined) validateJsonSchema(definition.internalOutput)
  if (!Array.isArray(definition.effects) || definition.effects.length === 0 || new Set(definition.effects).size !== definition.effects.length || definition.effects.some((effect) => typeof effect !== 'string' || !EFFECTS.has(effect))) definitionError(id, 'effects must contain unique supported values')
  if (!RISKS.has(definition.risk as string)) definitionError(id, 'risk is invalid')
  if (!isPlainObject(definition.ai) || typeof definition.ai.exposed !== 'boolean' || Object.keys(definition.ai).some((key) => key !== 'exposed' && key !== 'requiresConfirmation') || (definition.ai.requiresConfirmation !== undefined && typeof definition.ai.requiresConfirmation !== 'boolean')) definitionError(id, 'ai is invalid')
  if (definition.timeoutMs !== undefined && (typeof definition.timeoutMs !== 'number' || !Number.isInteger(definition.timeoutMs) || definition.timeoutMs < 1 || definition.timeoutMs > 300000)) definitionError(id, 'timeoutMs is invalid')
  if (definition.tags !== undefined && (!Array.isArray(definition.tags) || definition.tags.length > 32 || new Set(definition.tags).size !== definition.tags.length || definition.tags.some((tag) => typeof tag !== 'string' || tag.length === 0 || tag.length > 128))) definitionError(id, 'tags are invalid')
  if (definition.deprecated !== undefined && (!isPlainObject(definition.deprecated) || typeof definition.deprecated.reason !== 'string' || definition.deprecated.reason.length === 0 || Object.keys(definition.deprecated).some((key) => key !== 'reason' && key !== 'replacedBy') || (definition.deprecated.replacedBy !== undefined && typeof definition.deprecated.replacedBy !== 'string'))) definitionError(id, 'deprecated is invalid')
  if (!isPlainObject(definition.call) || Object.keys(definition.call).some((key) => !['method', 'args', 'result'].includes(key)) || typeof definition.call.method !== 'string' || !Array.isArray(definition.call.args) || definition.call.args.length > 16) definitionError(id, 'call is invalid')
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*\.[A-Za-z_$][A-Za-z0-9_$]*$/.test(definition.call.method)) definitionError(id, 'call.method must be a static namespace.method')
  const capability = manifest.validateTemplateBinding(
    definition.call.method,
    definition.call.args.length,
    template.id,
  )
  if (
    definition.timeoutMs !== undefined &&
    (!capability.async || definition.risk !== 'read' || definition.effects.some((effect) => effect !== 'scene.read'))
  ) {
    definitionError(id, 'timeoutMs is only supported for async read-only atomic calls')
  }
  template.call.args.forEach((argument, index) => {
    validateArgument(argument, template.input, id)
    const argumentContract = capability.atomicContract?.args[index]
    if (!argumentContract) definitionError(id, `call.args[${index}] has no Manifest atomic argument contract`)
    validateArgumentContract(argument, template.input, argumentContract, id, index)
    const parameter = capability.params?.[index]
    if (
      parameter?.required &&
      '$input' in argument &&
      !('default' in argument) &&
      !inputPathIsGuaranteed(template.input, argument.$input)
    ) {
      definitionError(id, `required SSP parameter ${parameter.name} may resolve to undefined`)
    }
  })
  validateResult(definition.call.result, id)
  if (!capability.atomicContract) definitionError(id, 'Manifest atomic contract is missing')
  validateResultContract(definition.call.result, template.output, capability.atomicContract.result, id)
  if (definition.call.result.kind !== 'direct') {
    const receipt = definition.call.result.kind === 'receipt' ? definition.call.result.value : definition.call.result.receipt
    validateValueAgainstSchema(receipt, definition.output, `Template ${id} receipt`)
  }
}

export class V3TemplateRegistry {
  readonly manifest: SspCapabilityManifest
  private readonly registrations: ReadonlyMap<string, RegisteredAtomicTemplate>

  constructor(definitions: readonly TaggedAtomicTemplate[], injectedManifest?: ManifestLike | SspCapabilityManifest) {
    this.manifest = injectedManifest instanceof SspCapabilityManifest ? injectedManifest : new SspCapabilityManifest(injectedManifest)
    const byId = new Map<string, RegisteredAtomicTemplate>()
    const byMethod = new Map<string, string>()
    for (const tagged of definitions) {
      if (!tagged || typeof tagged.source !== 'string' || tagged.source.length === 0) throw new Error('Template source tag must be non-empty')
      validateAtomicDefinition(tagged.definition, this.manifest)
      if (byId.has(tagged.definition.id)) throw new Error(`Duplicate atomic template id: ${tagged.definition.id}`)
      const previous = byMethod.get(tagged.definition.call.method)
      if (previous) throw new Error(`Duplicate atomic method binding ${tagged.definition.call.method}: ${previous} and ${tagged.definition.id}`)
      const registration = Object.freeze({ source: tagged.source, definition: tagged.definition, capability: this.manifest.require(tagged.definition.call.method) })
      byId.set(tagged.definition.id, registration)
      byMethod.set(tagged.definition.call.method, tagged.definition.id)
    }
    this.registrations = byId
  }

  all(): readonly AtomicTemplateDefinition[] {
    return Object.freeze([...this.registrations.values()].map((registration) => registration.definition))
  }

  aiExposed(): readonly AtomicTemplateDefinition[] {
    return Object.freeze(this.all().filter((definition) => definition.ai.exposed))
  }

  has(id: string): boolean {
    return this.registrations.has(id)
  }

  get(id: string): AtomicTemplateDefinition | undefined {
    return this.registrations.get(id)?.definition
  }

  require(id: string): AtomicTemplateDefinition {
    const definition = this.get(id)
    if (!definition) throw new Error(`Unknown v3 template: ${id}`)
    return definition
  }

  prepareInput(id: string, params: unknown): JsonValue {
    const definition = this.require(id)
    return validateAndApplyDefaults(definition.input, params)
  }

  toAiPromptSection(): string {
    return this.aiExposed().map((definition) => [
      `- ${definition.id}: ${definition.title}`,
      `  ${definition.description}`,
      `  intents: ${definition.intents.join(', ')}`,
      `  input: ${JSON.stringify(definition.input)}`,
    ].join('\n')).join('\n')
  }

  registration(id: string): RegisteredAtomicTemplate {
    const registration = this.registrations.get(id)
    if (!registration) throw new Error(`Unknown v3 template: ${id}`)
    return registration
  }
}
