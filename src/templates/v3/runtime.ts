import { ExecutionScope, assertPublicParams } from './execution'
import { projectPublicOutput, readPath } from './jsonSchema'
import { V3TemplateRegistry } from './registry'
import type { AtomicResult, ExecutionResult, JsonValue } from './types'

export type SspLikeNamespace = object

export interface ExecuteAtomicTemplateOptions {
  /** Direct AI calls may only reach explicitly exposed templates. */
  aiOnly?: boolean
}

export class AtomicTemplateRuntime {
  constructor(
    private readonly registry: V3TemplateRegistry,
    private readonly ssp: SspLikeNamespace,
  ) {}

  async execute(
    templateId: string,
    params: unknown,
    options: ExecuteAtomicTemplateOptions = {},
  ): Promise<JsonValue> {
    const scope = new ExecutionScope()
    try {
      const result = await this.executeInScope(templateId, params, scope, options)
      return result.public
    } finally {
      scope.close()
    }
  }

  async executeInScope(
    templateId: string,
    params: unknown,
    scope: ExecutionScope,
    options: ExecuteAtomicTemplateOptions = {},
  ): Promise<ExecutionResult> {
    const definition = this.registry.require(templateId)
    try {
      if ((options.aiOnly ?? true) && !definition.ai.exposed) {
        throw new Error('template is not AI-exposed')
      }
      assertPublicParams(params)
      const prepared = this.registry.prepareInput(templateId, params)
      const args = definition.call.args.map((argument) => {
        if ('$literal' in argument) return argument.$literal
        const value = readPath(prepared, argument.$input)
        return value === undefined && 'default' in argument ? argument.default : value
      })
      this.registry.manifest.validateTemplateBinding(
        definition.call.method,
        args.length,
        definition.id,
      )
      const [namespaceName, memberName] = definition.call.method.split('.')
      const namespaceValue = (this.ssp as Record<string, unknown>)[namespaceName]
      if (namespaceValue === null || (typeof namespaceValue !== 'object' && typeof namespaceValue !== 'function')) throw new Error(`SSP namespace ${namespaceName} is unavailable`)
      const method = (namespaceValue as Record<string, unknown>)[memberName]
      if (typeof method !== 'function') throw new Error(`SSP method ${definition.call.method} is unavailable`)
      const rawResult = await this.invoke(method, namespaceValue, args, definition.timeoutMs)
      return this.normalizeResult(definition.call.result, rawResult, definition.output, scope)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`[template:${templateId}] ${message}`)
    }
  }

  private async invoke(method: Function, receiver: object, args: unknown[], timeoutMs?: number): Promise<unknown> {
    const result = Promise.resolve(method.apply(receiver, args))
    if (timeoutMs === undefined) return result
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(
        `read-only response wait timed out after ${timeoutMs}ms (the SSP promise is not cancelled)`,
      )), timeoutMs)
    })
    try {
      return await Promise.race([result, timeout])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  private normalizeResult(
    result: AtomicResult,
    rawResult: unknown,
    outputSchema: Parameters<typeof projectPublicOutput>[0],
    scope: ExecutionScope,
  ): ExecutionResult {
    if (result.kind === 'direct') return { public: projectPublicOutput(outputSchema, rawResult) }
    if (result.kind === 'receipt') return { public: projectPublicOutput(outputSchema, result.value) }
    if (result.kind === 'object-ref') {
      if (rawResult === null || (typeof rawResult !== 'object' && typeof rawResult !== 'function')) throw new Error('object-ref result requires an object')
      return { public: projectPublicOutput(outputSchema, result.receipt), internal: scope.createObjectRef(rawResult) }
    }
    if (!Array.isArray(rawResult)) throw new Error('object-ref-array result requires an array')
    const refs = rawResult.map((item) => {
      if (item === null || (typeof item !== 'object' && typeof item !== 'function')) throw new Error('object-ref-array result contains a non-object')
      return scope.createObjectRef(item)
    })
    return { public: projectPublicOutput(outputSchema, result.receipt), internal: refs }
  }
}

export { ExecutionScope } from './execution'
