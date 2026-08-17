import { assertSafeJson, isPlainObject, type JsonSchemaError } from './jsonSchema'
import type { ObjectRef } from './types'

let scopeSequence = 0

function nextToken(): string {
  scopeSequence += 1
  return `v3-${scopeSequence.toString(36)}-${Math.random().toString(36).slice(2)}`
}

export class ExecutionScope {
  private readonly values = new Map<string, unknown>()
  private readonly refs = new Map<string, ObjectRef>()
  private readonly identities = new WeakMap<object, ObjectRef>()
  private closed = false

  createObjectRef(value: object): ObjectRef {
    this.assertOpen()
    const existing = this.identities.get(value)
    if (existing) return existing
    const token = nextToken()
    const ref = Object.freeze({ $refType: 'ssp-object' as const, token })
    this.values.set(token, value)
    this.refs.set(token, ref)
    this.identities.set(value, ref)
    return ref
  }

  resolve(ref: ObjectRef): unknown {
    this.assertOpen()
    if (!isPlainObject(ref) || ref.$refType !== 'ssp-object' || typeof ref.token !== 'string') throw new Error('Invalid SSP ObjectRef')
    if (this.refs.get(ref.token) !== ref) throw new Error('Forged or cross-scope SSP ObjectRef')
    return this.values.get(ref.token)
  }

  owns(ref: ObjectRef): boolean {
    if (this.closed || !isPlainObject(ref)) return false
    return this.refs.get(ref.token) === ref
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.values.clear()
    this.refs.clear()
  }

  get isClosed(): boolean {
    return this.closed
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('ExecutionScope is closed')
  }
}

export function assertPublicParams(value: unknown): void {
  try {
    assertSafeJson(value)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Unsafe public parameters: ${message}`)
  }
}

export function isExecutionScopeError(error: unknown): error is JsonSchemaError {
  return error instanceof Error && error.name === 'JsonSchemaError'
}
