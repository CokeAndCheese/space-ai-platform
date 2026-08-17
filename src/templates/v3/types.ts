export type JsonPrimitive = string | number | boolean | null

export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export type JsonSchemaType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null'

export interface JsonSchema {
  readonly type?: JsonSchemaType
  readonly properties?: Readonly<Record<string, JsonSchema>>
  readonly required?: readonly string[]
  readonly additionalProperties?: false
  readonly items?: JsonSchema
  readonly enum?: readonly JsonValue[]
  readonly const?: JsonValue
  readonly default?: JsonValue
  readonly anyOf?: readonly JsonSchema[]
  readonly minimum?: number
  readonly maximum?: number
  readonly exclusiveMinimum?: number
  readonly exclusiveMaximum?: number
  readonly minLength?: number
  readonly maxLength?: number
  readonly minItems?: number
  readonly maxItems?: number
  readonly pattern?: string
  readonly title?: string
  readonly description?: string
  readonly [key: string]: unknown
}

export type TemplateEffect =
  | 'scene.read'
  | 'scene.write'
  | 'camera.write'
  | 'object.highlight'
  | 'object.visibility'
  | 'model.load'
  | 'model.unload'
  | 'topology.write'
  | 'dom.write'
  | 'download'
  | 'timer'
  | 'destructive'

export type TemplateRisk = 'read' | 'visual' | 'state' | 'destructive' | 'external'

export interface InputBinding {
  readonly $input: string
  readonly default?: JsonValue
}

export interface LiteralBinding {
  readonly $literal: JsonValue
}

export type CallArgument = InputBinding | LiteralBinding

export type AtomicResult =
  | { readonly kind: 'direct' }
  | { readonly kind: 'receipt'; readonly value: JsonValue }
  | { readonly kind: 'object-ref'; readonly receipt: JsonValue }
  | { readonly kind: 'object-ref-array'; readonly receipt: JsonValue }

export interface AtomicCall {
  readonly method: string
  readonly args: readonly CallArgument[]
  readonly result: AtomicResult
}

export interface DeprecatedInfo {
  readonly replacedBy?: string
  readonly reason: string
}

export interface AtomicTemplateDefinition {
  readonly schemaVersion: 3
  readonly id: string
  readonly version: string
  readonly kind: 'atomic'
  readonly title: string
  readonly description: string
  readonly intents: readonly string[]
  readonly input: JsonSchema
  readonly internalOutput?: JsonSchema
  readonly output: JsonSchema
  readonly effects: readonly TemplateEffect[]
  readonly risk: TemplateRisk
  readonly ai: {
    readonly exposed: boolean
    readonly requiresConfirmation?: boolean
  }
  readonly timeoutMs?: number
  readonly tags?: readonly string[]
  readonly deprecated?: DeprecatedInfo
  readonly call: AtomicCall
}

export interface TaggedAtomicTemplate {
  readonly source: string
  readonly definition: AtomicTemplateDefinition
}

export interface SspCapability {
  readonly id: string
  readonly namespace: string
  readonly method: string
  readonly signature?: string
  readonly params?: readonly {
    readonly name: string
    readonly required: boolean
    readonly type?: string
  }[]
  readonly returnType?: string
  readonly async: boolean
  readonly classification?: string
  readonly templatePolicy?: 'allowed' | 'host-only' | 'blocked'
  readonly aiPolicy?: 'never' | 'composite-only' | 'reviewable'
  readonly mappedTemplates?: readonly string[]
  readonly legacyReferences?: readonly string[]
  readonly atomicContract?: AtomicCapabilityContract
  readonly [key: string]: unknown
}

export interface AtomicCapabilityArgumentContract {
  readonly required: boolean
  readonly schema: JsonSchema
}

export type AtomicCapabilityResultContract =
  | { readonly kind: 'public-data'; readonly schema: JsonSchema }
  | { readonly kind: 'void' }
  | { readonly kind: 'object-ref' }
  | { readonly kind: 'object-ref-array' }

export interface AtomicCapabilityContract {
  readonly templateIds: readonly string[]
  readonly args: readonly AtomicCapabilityArgumentContract[]
  readonly result: AtomicCapabilityResultContract
}

export interface SspManifest {
  readonly schemaVersion?: number
  readonly capabilities: readonly SspCapability[]
  readonly [key: string]: unknown
}

export interface RegisteredAtomicTemplate extends TaggedAtomicTemplate {
  readonly capability: SspCapability
}

export interface ObjectRef {
  readonly $refType: 'ssp-object'
  readonly token: string
}

export interface ExecutionResult {
  readonly public: JsonValue
  readonly internal?: unknown
}
