import type { JsonSchema, JsonValue, ObjectRef } from './types'

export const V3_LIMITS = Object.freeze({
  maxDepth: 16,
  maxItems: 200,
  maxStringLength: 4096,
  maxSerializedBytes: 65_536,
})

const RESERVED_KEYS = new Set(['__proto__', 'prototype', 'constructor', '$refType', 'token'])
const SCHEMA_KEYS = new Set([
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'const',
  'default',
  'anyOf',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'pattern',
  'title',
  'description',
])
const ANY_OF_KEYS = new Set(['anyOf', 'default', 'title', 'description'])

export class JsonSchemaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JsonSchemaError'
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

export function isJsonValue(value: unknown, depth = 0, seen = new WeakSet<object>()): value is JsonValue {
  if (depth > V3_LIMITS.maxDepth) return false
  if (value === null || typeof value === 'boolean') return true
  if (typeof value === 'string') return value.length <= V3_LIMITS.maxStringLength
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object') return false
  if (seen.has(value)) return false
  seen.add(value)
  if (Array.isArray(value)) {
    if (value.length > V3_LIMITS.maxItems) return false
    return value.every((item) => isJsonValue(item, depth + 1, seen))
  }
  if (!isPlainObject(value)) return false
  for (const [key, item] of Object.entries(value)) {
    if (RESERVED_KEYS.has(key) || !isJsonValue(item, depth + 1, seen)) return false
  }
  return true
}

function fail(path: string, message: string): never {
  throw new JsonSchemaError(`${path}: ${message}`)
}

function assertFiniteNumber(value: unknown, path: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'expected a finite number')
}

function assertBound(value: unknown, path: string, name: string, integer = false): void {
  assertFiniteNumber(value, `${path}.${name}`)
  if (integer && !Number.isInteger(value)) fail(`${path}.${name}`, 'expected an integer')
  if (value < 0) fail(`${path}.${name}`, 'must not be negative')
}

export function validateJsonSchema(schema: unknown, path = '$', depth = 0): asserts schema is JsonSchema {
  if (!isPlainObject(schema)) fail(path, 'schema must be a plain object')
  if (depth > V3_LIMITS.maxDepth) fail(path, 'schema is too deeply nested')
  for (const key of Object.keys(schema)) {
    if (!SCHEMA_KEYS.has(key)) fail(`${path}.${key}`, 'unsupported JSON Schema keyword')
  }
  if ('type' in schema) {
    const type = schema.type
    if (!['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'].includes(String(type))) {
      fail(`${path}.type`, 'unsupported type')
    }
  }
  if ('additionalProperties' in schema && schema.additionalProperties !== false) {
    fail(`${path}.additionalProperties`, 'only false is supported')
  }
  if (schema.type === 'object') {
    if (schema.additionalProperties !== false) fail(path, 'object schemas must be closed with additionalProperties:false')
    if (schema.properties !== undefined && !isPlainObject(schema.properties)) fail(`${path}.properties`, 'must be a plain object')
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (RESERVED_KEYS.has(key)) fail(`${path}.properties.${key}`, 'reserved property name')
      validateJsonSchema(child, `${path}.properties.${key}`, depth + 1)
    }
    if (schema.required !== undefined) {
      if (!Array.isArray(schema.required) || schema.required.some((key) => typeof key !== 'string')) fail(`${path}.required`, 'must be an array of strings')
      const propertyNames = new Set(Object.keys(schema.properties ?? {}))
      for (const key of schema.required) if (!propertyNames.has(key)) fail(`${path}.required`, `unknown property ${key}`)
    }
  }
  if (schema.type === 'array' && schema.items !== undefined) validateJsonSchema(schema.items, `${path}.items`, depth + 1)
  if (schema.items !== undefined && schema.type !== 'array') fail(`${path}.items`, 'is only valid for arrays')
  if (schema.anyOf !== undefined) {
    if (!Array.isArray(schema.anyOf) || schema.anyOf.length === 0) fail(`${path}.anyOf`, 'must be a non-empty array')
    for (const key of Object.keys(schema)) {
      if (!ANY_OF_KEYS.has(key)) fail(`${path}.${key}`, 'cannot be combined with anyOf in the v3 subset')
    }
    schema.anyOf.forEach((child, index) => validateJsonSchema(child, `${path}.anyOf[${index}]`, depth + 1))
  }
  if (schema.enum !== undefined) {
    if (!Array.isArray(schema.enum) || schema.enum.length === 0 || !schema.enum.every((item) => isJsonValue(item))) fail(`${path}.enum`, 'must contain JSON values')
  }
  if ('const' in schema && !isJsonValue(schema.const)) fail(`${path}.const`, 'must be a JSON value')
  if ('default' in schema && !isJsonValue(schema.default)) fail(`${path}.default`, 'must be a JSON value')
  for (const name of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum'] as const) {
    if (name in schema) assertFiniteNumber(schema[name], `${path}.${name}`)
  }
  for (const name of ['minLength', 'maxLength', 'minItems', 'maxItems'] as const) {
    if (name in schema) assertBound(schema[name], path, name, true)
    if (name.endsWith('Length') && name in schema && (schema[name] as number) > V3_LIMITS.maxStringLength) fail(`${path}.${name}`, 'exceeds runtime bounds')
    if (name.endsWith('Items') && name in schema && (schema[name] as number) > V3_LIMITS.maxItems) fail(`${path}.${name}`, 'exceeds runtime bounds')
  }
  const minLength = typeof schema.minLength === 'number' ? schema.minLength : undefined
  const maxLength = typeof schema.maxLength === 'number' ? schema.maxLength : undefined
  const minItems = typeof schema.minItems === 'number' ? schema.minItems : undefined
  const maxItems = typeof schema.maxItems === 'number' ? schema.maxItems : undefined
  const minimum = typeof schema.minimum === 'number' ? schema.minimum : undefined
  const maximum = typeof schema.maximum === 'number' ? schema.maximum : undefined
  if (minLength !== undefined && maxLength !== undefined && minLength > maxLength) fail(path, 'minLength exceeds maxLength')
  if (minItems !== undefined && maxItems !== undefined && minItems > maxItems) fail(path, 'minItems exceeds maxItems')
  if (minimum !== undefined && maximum !== undefined && minimum > maximum) fail(path, 'minimum exceeds maximum')
  if (schema.pattern !== undefined) {
    if (typeof schema.pattern !== 'string') fail(`${path}.pattern`, 'must be a string')
    try { new RegExp(schema.pattern) } catch { fail(`${path}.pattern`, 'is not a valid regular expression') }
  }
  if (schema.title !== undefined && typeof schema.title !== 'string') fail(`${path}.title`, 'must be a string')
  if (schema.description !== undefined && typeof schema.description !== 'string') fail(`${path}.description`, 'must be a string')
  if (schema.default !== undefined) validateAgainstSchema(schema.default, schema, `${path}.default`)
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function matchesType(value: unknown, type: JsonSchema['type']): boolean {
  switch (type) {
    case 'object': return isPlainObject(value)
    case 'array': return Array.isArray(value)
    case 'string': return typeof value === 'string'
    case 'number': return typeof value === 'number' && Number.isFinite(value)
    case 'integer': return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)
    case 'boolean': return typeof value === 'boolean'
    case 'null': return value === null
    default: return true
  }
}

function validateAgainstSchema(value: unknown, schema: JsonSchema, path: string): void {
  if (schema.anyOf && !schema.anyOf.some((candidate) => {
    try { validateAgainstSchema(value, candidate, path); return true } catch { return false }
  })) fail(path, 'does not match any allowed schema')
  if (schema.type && !matchesType(value, schema.type)) fail(path, `expected ${schema.type}`)
  if (schema.const !== undefined && !sameJson(value, schema.const)) fail(path, 'does not match const')
  if (schema.enum && !schema.enum.some((item) => sameJson(value, item))) fail(path, 'is not an allowed enum value')
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(path, 'must be finite')
    if (schema.minimum !== undefined && value < schema.minimum) fail(path, 'is below minimum')
    if (schema.maximum !== undefined && value > schema.maximum) fail(path, 'is above maximum')
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) fail(path, 'is below exclusiveMinimum')
    if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) fail(path, 'is above exclusiveMaximum')
  }
  if (typeof value === 'string') {
    if (value.length > V3_LIMITS.maxStringLength) fail(path, 'string is too long')
    if (schema.minLength !== undefined && value.length < schema.minLength) fail(path, 'is shorter than minLength')
    if (schema.maxLength !== undefined && value.length > schema.maxLength) fail(path, 'is longer than maxLength')
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) fail(path, 'does not match pattern')
  }
  if (Array.isArray(value)) {
    if (value.length > V3_LIMITS.maxItems) fail(path, 'has too many items')
    if (schema.minItems !== undefined && value.length < schema.minItems) fail(path, 'has fewer than minItems')
    if (schema.maxItems !== undefined && value.length > schema.maxItems) fail(path, 'has more than maxItems')
    if (schema.items) value.forEach((item, index) => validateAgainstSchema(item, schema.items!, `${path}[${index}]`))
  }
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) if (RESERVED_KEYS.has(key)) fail(`${path}.${key}`, 'reserved property name')
    const properties = schema.properties ?? {}
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) if (!hasOwn(properties, key)) fail(`${path}.${key}`, 'unknown property')
    }
    for (const key of schema.required ?? []) if (!hasOwn(value, key)) fail(path, `missing required property ${key}`)
    for (const [key, child] of Object.entries(properties)) if (hasOwn(value, key)) validateAgainstSchema(value[key], child, `${path}.${key}`)
  }
}

export function validateValueAgainstSchema(value: unknown, schema: JsonSchema, path = '$'): void {
  validateJsonSchema(schema)
  validateAgainstSchema(value, schema, path)
}

function cloneJson(value: JsonValue, depth = 0): JsonValue {
  if (depth > V3_LIMITS.maxDepth) throw new JsonSchemaError('value is too deeply nested')
  if (Array.isArray(value)) return value.map((item) => cloneJson(item, depth + 1))
  if (isPlainObject(value)) {
    const result: Record<string, JsonValue> = {}
    for (const [key, item] of Object.entries(value)) result[key] = cloneJson(item, depth + 1)
    return result
  }
  return value
}

function applyDefaults(value: unknown, schema: JsonSchema, path: string, depth: number): JsonValue {
  if (depth > V3_LIMITS.maxDepth) fail(path, 'value is too deeply nested')
  if (value === undefined && schema.default !== undefined) value = cloneJson(schema.default)
  if (schema.anyOf) {
    for (const candidate of schema.anyOf) {
      try { return applyDefaults(value, candidate, path, depth + 1) } catch { /* try next branch */ }
    }
  }
  if (schema.type === 'object') {
    if (value === undefined) value = {}
    if (!isPlainObject(value)) fail(path, 'expected a plain object')
    const result: Record<string, JsonValue> = {}
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (hasOwn(value, key)) result[key] = applyDefaults(value[key], child, `${path}.${key}`, depth + 1)
      else if (child.default !== undefined) result[key] = applyDefaults(undefined, child, `${path}.${key}`, depth + 1)
    }
    for (const key of Object.keys(value)) {
      if (RESERVED_KEYS.has(key)) fail(`${path}.${key}`, 'reserved property name')
      if (!hasOwn(schema.properties ?? {}, key)) fail(`${path}.${key}`, 'unknown property')
    }
    for (const key of schema.required ?? []) if (!hasOwn(result, key)) fail(path, `missing required property ${key}`)
    validateAgainstSchema(result, schema, path)
    return result
  }
  if (value === undefined) fail(path, 'value is required')
  validateAgainstSchema(value, schema, path)
  return cloneJson(value as JsonValue)
}

export function validateAndApplyDefaults(schema: JsonSchema, value: unknown): JsonValue {
  validateJsonSchema(schema)
  if (!isPlainObject(value)) throw new JsonSchemaError('$: input must be a plain object')
  return serializePublicJson(applyDefaults(value, schema, '$', 0))
}

export function schemaAtPath(schema: JsonSchema, path: string): JsonSchema {
  if (!path || path.startsWith('.') || path.endsWith('.') || path.includes('..')) throw new JsonSchemaError(`$input ${path}: invalid static path`)
  let current: JsonSchema | undefined = schema
  for (const segment of path.split('.')) {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment) || RESERVED_KEYS.has(segment)) throw new JsonSchemaError(`$input ${path}: invalid path segment`)
    if (current?.anyOf) {
      const candidates: JsonSchema[] = current.anyOf.map((candidate): JsonSchema | undefined => { try { return schemaAtPath(candidate, segment) } catch { return undefined } }).filter((candidate): candidate is JsonSchema => candidate !== undefined)
      if (candidates.length !== 1) throw new JsonSchemaError(`$input ${path}: ambiguous or unknown path`)
      current = candidates[0]
    } else {
      const properties: JsonSchema['properties'] = current?.properties
      if (current?.type !== 'object' || !properties || !hasOwn(properties, segment)) throw new JsonSchemaError(`$input ${path}: unknown input path`)
      current = properties[segment]
    }
  }
  if (!current) throw new JsonSchemaError(`$input ${path}: unknown path`)
  return current
}

export function readPath(value: JsonValue, path: string): unknown {
  let current: unknown = value
  for (const segment of path.split('.')) {
    if (!isPlainObject(current) || !hasOwn(current, segment)) return undefined
    current = current[segment]
  }
  return current
}

function isObjectRef(value: unknown): value is ObjectRef {
  return isPlainObject(value) && value.$refType === 'ssp-object' && typeof value.token === 'string'
}

function project(value: unknown, schema: JsonSchema, path: string, seen: WeakSet<object>, depth: number): JsonValue {
  if (depth > V3_LIMITS.maxDepth) fail(path, 'output exceeds maximum depth')
  if (isObjectRef(value)) fail(path, 'internal object reference in public output')
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') fail(path, 'non-JSON value')
  if (typeof value === 'number' && !Number.isFinite(value)) fail(path, 'non-finite number')
  if (value !== null && typeof value === 'object') {
    if (seen.has(value)) fail(path, 'cyclic output')
    seen.add(value)
  }
  if (schema.anyOf) {
    for (const candidate of schema.anyOf) {
      try { return project(value, candidate, path, new WeakSet<object>(), depth + 1) } catch { /* try next branch */ }
    }
    fail(path, 'does not match any output schema')
  }
  if (!matchesType(value, schema.type)) fail(path, `expected ${schema.type}`)
  if (schema.const !== undefined && !sameJson(value, schema.const)) fail(path, 'does not match const')
  if (schema.enum && !schema.enum.some((item) => sameJson(value, item))) fail(path, 'is not an allowed enum value')
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) fail(path, 'is below minimum')
    if (schema.maximum !== undefined && value > schema.maximum) fail(path, 'is above maximum')
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) fail(path, 'is below exclusiveMinimum')
    if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) fail(path, 'is above exclusiveMaximum')
  }
  if (typeof value === 'string') {
    if (value.length > V3_LIMITS.maxStringLength || (schema.minLength !== undefined && value.length < schema.minLength) || (schema.maxLength !== undefined && value.length > schema.maxLength)) fail(path, 'string length is outside bounds')
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) fail(path, 'does not match pattern')
    return value
  }
  if (Array.isArray(value)) {
    if (value.length > V3_LIMITS.maxItems || (schema.minItems !== undefined && value.length < schema.minItems) || (schema.maxItems !== undefined && value.length > schema.maxItems)) fail(path, 'array length is outside bounds')
    return schema.items ? value.map((item, index) => project(item, schema.items!, `${path}[${index}]`, seen, depth + 1)) : value.map((item) => project(item, { type: undefined }, path, seen, depth + 1))
  }
  if (isPlainObject(value)) {
    const output: Record<string, JsonValue> = {}
    const properties = schema.properties ?? {}
    for (const key of schema.required ?? []) if (!hasOwn(value, key)) fail(path, `missing required property ${key}`)
    for (const [key, child] of Object.entries(properties)) if (hasOwn(value, key)) output[key] = project(value[key], child, `${path}.${key}`, seen, depth + 1)
    return output
  }
  if (value === null) return null
  return value as JsonValue
}

export function projectPublicOutput(schema: JsonSchema, value: unknown): JsonValue {
  validateJsonSchema(schema)
  const projected = project(value, schema, '$', new WeakSet<object>(), 0)
  return serializePublicJson(projected)
}

export function serializePublicJson(value: JsonValue): JsonValue {
  if (!isJsonValue(value)) throw new JsonSchemaError('public output is not safe JSON')
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new JsonSchemaError('public output cannot be serialized')
  const bytes = typeof TextEncoder === 'undefined'
    ? serialized.length
    : new TextEncoder().encode(serialized).length
  if (bytes > V3_LIMITS.maxSerializedBytes) throw new JsonSchemaError('public output exceeds serialized size limit')
  return JSON.parse(serialized) as JsonValue
}

export function assertSafeJson(value: unknown, path = '$'): asserts value is JsonValue {
  if (!isJsonValue(value)) fail(path, 'must be bounded, plain JSON')
  const serialized = JSON.stringify(value)
  const bytes = typeof TextEncoder === 'undefined'
    ? serialized.length
    : new TextEncoder().encode(serialized).length
  if (bytes > V3_LIMITS.maxSerializedBytes) fail(path, 'exceeds serialized size limit')
}
