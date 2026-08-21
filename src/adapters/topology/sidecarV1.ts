import type {
  TopologyJsonObject,
  TopologyJsonValue,
  TopologySidecarAssetV1,
  TopologySidecarBlockerV1,
  TopologySidecarConnectorV1,
  TopologySidecarDiagnostic,
  TopologySidecarDiagnosticCode,
  TopologySidecarDigest,
  TopologySidecarEdgeStateV1,
  TopologySidecarEdgeV1,
  TopologySidecarLayerV1,
  TopologySidecarNodeV1,
  TopologySidecarParseResult,
  TopologySidecarPointV1,
  TopologySidecarV1,
  TopologySidecarViaPointV1,
} from './types'

const SIDECAR_SCHEMA = 'space-ai-platform/topology-sidecar'
const MAX_SIDECAR_UTF8_BYTES = 8 * 1024 * 1024
const MAX_STRING_LENGTH = 160
const MAX_ASSET_URI_LENGTH = 4_096
const MAX_ASSETS = 128
const MAX_LAYERS = 32
const MAX_NODES = 2_000
const MAX_EDGES = 5_000
const MAX_CONNECTORS = 2_000
const MAX_BLOCKERS = 5_000
const MAX_VIA_POINTS = 64
const MAX_SEGMENTS = 20_000
const MAX_TAGS = 64
const MAX_CONNECTOR_REFERENCES = 20_000
const MAX_BLOCKER_REFERENCES = 20_000
const MAX_ACTIVE_BLOCKERS_PER_EDGE = 64
const MAX_DATA_DEPTH = 16
const MAX_DATA_NODES = 4_096
const MAX_DATA_MEMBERS = 1_024
const MAX_DATA_STRING_LENGTH = 4_096

const TOP_LEVEL_FIELDS = [
  'schema',
  'schemaVersion',
  'revision',
  'graphId',
  'coordinateSpace',
  'unit',
  'upAxis',
  'assets',
  'layers',
  'nodes',
  'edges',
  'connectors',
  'blockers',
  'tags',
  'data',
] as const

type RecordValue = Record<string, unknown>

interface ValidationContext {
  sidecarUri: string
}

export function redactTopologySidecarUri(sidecarUri: string): string {
  try {
    const url = new URL(sidecarUri)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return '[non-http-sidecar-uri]'
    }
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.href
  } catch {
    return '[non-http-sidecar-uri]'
  }
}

class SidecarValidationFailure extends Error {
  readonly diagnostic: TopologySidecarDiagnostic

  constructor(diagnostic: TopologySidecarDiagnostic) {
    super(diagnostic.message)
    this.name = 'SidecarValidationFailure'
    this.diagnostic = diagnostic
  }
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pointer(path: string, segment: string | number): string {
  const escaped = String(segment).replace(/~/g, '~0').replace(/\//g, '~1')
  return `${path}/${escaped}`
}

function measureUtf8BytesThroughLimit(
  value: string,
  limit: number,
): { bytes: number; exceeded: boolean } {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit <= 0x7f) {
      bytes += 1
    } else if (codeUnit <= 0x7ff) {
      bytes += 2
    } else if (
      codeUnit >= 0xd800 &&
      codeUnit <= 0xdbff &&
      index + 1 < value.length
    ) {
      const nextCodeUnit = value.charCodeAt(index + 1)
      if (nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
        bytes += 4
        index += 1
      } else {
        bytes += 3
      }
    } else {
      bytes += 3
    }
    if (bytes > limit) return { bytes, exceeded: true }
  }
  return { bytes, exceeded: false }
}

function fail(
  context: ValidationContext,
  code: TopologySidecarDiagnosticCode,
  phase: TopologySidecarDiagnostic['phase'],
  path: string,
  message: string,
  options: {
    assetId?: string | null
    entityId?: string | null
    details?: TopologyJsonObject
  } = {},
): never {
  throw new SidecarValidationFailure({
    code,
    phase,
    message,
    path,
    sidecarUri: redactTopologySidecarUri(context.sidecarUri),
    assetId: options.assetId ?? null,
    entityId: options.entityId ?? null,
    details: options.details ?? {},
  })
}

function requireField(
  record: RecordValue,
  key: string,
  path: string,
  context: ValidationContext,
  code: TopologySidecarDiagnosticCode = 'SIDECAR_FIELD_INVALID',
): unknown {
  if (!Object.prototype.hasOwnProperty.call(record, key)) {
    fail(context, code, 'VALIDATE', pointer(path, key), `required field "${key}" is missing`)
  }
  return record[key]
}

function assertClosed(
  record: RecordValue,
  allowedFields: readonly string[],
  path: string,
  context: ValidationContext,
): void {
  const allowed = new Set(allowedFields)
  const unknown = Object.keys(record).find((key) => !allowed.has(key))
  if (unknown !== undefined) {
    fail(
      context,
      'SIDECAR_FIELD_INVALID',
      'VALIDATE',
      pointer(path, unknown),
      `unknown sidecar field "${unknown}" is not allowed in schema v1`,
    )
  }
}

function readRecord(
  value: unknown,
  path: string,
  context: ValidationContext,
  code: TopologySidecarDiagnosticCode = 'SIDECAR_FIELD_INVALID',
): RecordValue {
  if (!isRecord(value)) {
    fail(context, code, 'VALIDATE', path, 'expected an object')
  }
  return value
}

function readArray(
  value: unknown,
  path: string,
  context: ValidationContext,
  code: TopologySidecarDiagnosticCode = 'SIDECAR_FIELD_INVALID',
): readonly unknown[] {
  if (!Array.isArray(value)) {
    fail(context, code, 'VALIDATE', path, 'expected an array')
  }
  return value
}

function readString(
  value: unknown,
  path: string,
  context: ValidationContext,
  options: {
    code?: TopologySidecarDiagnosticCode
    maxLength?: number
    assetId?: string | null
    entityId?: string | null
  } = {},
): string {
  const code = options.code ?? 'SIDECAR_FIELD_INVALID'
  if (typeof value !== 'string') {
    fail(context, code, 'VALIDATE', path, 'expected a string', options)
  }
  const normalized = value.trim()
  const maxLength = options.maxLength ?? MAX_STRING_LENGTH
  if (normalized.length === 0) {
    fail(
      context,
      code,
      'VALIDATE',
      path,
      'string must be non-empty after trimming',
      options,
    )
  }
  if (normalized.length > maxLength) {
    fail(
      context,
      'SIDECAR_LIMIT_EXCEEDED',
      'VALIDATE',
      path,
      `string exceeds the ${String(maxLength)} character limit`,
      {
        assetId: options.assetId,
        entityId: options.entityId,
        details: { limit: maxLength, actual: normalized.length },
      },
    )
  }
  return normalized
}

function readOptionalString(
  record: RecordValue,
  key: string,
  path: string,
  context: ValidationContext,
  code: TopologySidecarDiagnosticCode = 'SIDECAR_FIELD_INVALID',
): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(record, key)) return undefined
  return readString(record[key], pointer(path, key), context, { code })
}

function readFiniteNumber(
  value: unknown,
  path: string,
  context: ValidationContext,
  options: {
    code?: TopologySidecarDiagnosticCode
    nonNegative?: boolean
    phase?: TopologySidecarDiagnostic['phase']
  } = {},
): number {
  const code = options.code ?? 'SIDECAR_FIELD_INVALID'
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(context, code, options.phase ?? 'VALIDATE', path, 'expected a finite number')
  }
  if (options.nonNegative && value < 0) {
    fail(context, code, options.phase ?? 'VALIDATE', path, 'expected a non-negative number')
  }
  return value
}

function readOptionalFiniteNumber(
  record: RecordValue,
  key: string,
  path: string,
  context: ValidationContext,
  options: { nonNegative?: boolean } = {},
): number | undefined {
  if (!Object.prototype.hasOwnProperty.call(record, key)) return undefined
  return readFiniteNumber(record[key], pointer(path, key), context, options)
}

function readStringArray(
  value: unknown,
  path: string,
  context: ValidationContext,
  options: {
    code?: TopologySidecarDiagnosticCode
    minLength?: number
    maxItems?: number
  } = {},
): readonly string[] {
  const code = options.code ?? 'SIDECAR_FIELD_INVALID'
  const values = readArray(value, path, context, code)
  if (values.length < (options.minLength ?? 0)) {
    fail(
      context,
      code,
      'VALIDATE',
      path,
      `array must contain at least ${String(options.minLength ?? 0)} item(s)`,
    )
  }
  if (options.maxItems !== undefined && values.length > options.maxItems) {
    fail(
      context,
      'SIDECAR_LIMIT_EXCEEDED',
      'VALIDATE',
      path,
      `array exceeds the ${String(options.maxItems)} item limit`,
      { details: { limit: options.maxItems, actual: values.length } },
    )
  }
  const normalized = values.map((item, index) =>
    readString(item, pointer(path, index), context, { code }),
  )
  const seen = new Set<string>()
  normalized.forEach((item, index) => {
    if (seen.has(item)) {
      fail(context, code, 'VALIDATE', pointer(path, index), `duplicate value "${item}" is not allowed`)
    }
    seen.add(item)
  })
  return normalized
}

function readOptionalTags(
  record: RecordValue,
  path: string,
  context: ValidationContext,
): readonly string[] | undefined {
  if (!Object.prototype.hasOwnProperty.call(record, 'tags')) return undefined
  return readStringArray(record.tags, pointer(path, 'tags'), context, { maxItems: MAX_TAGS })
}

function assertJsonSafe(value: unknown, path: string, context: ValidationContext): asserts value is TopologyJsonValue {
  interface PendingDataValue {
    value: unknown
    path: string
    containerDepth: number
  }

  const pending: PendingDataValue[] = [{ value, path, containerDepth: 1 }]
  let scheduledNodes = 1
  while (pending.length > 0) {
    const current = pending.pop()!
    if (current.value === null || typeof current.value === 'boolean') continue
    if (typeof current.value === 'number') {
      if (!Number.isFinite(current.value)) {
        fail(context, 'SIDECAR_FIELD_INVALID', 'VALIDATE', current.path, 'data contains a non-finite number')
      }
      continue
    }
    if (typeof current.value === 'string') {
      if (current.value.length > MAX_DATA_STRING_LENGTH) {
        fail(
          context,
          'SIDECAR_LIMIT_EXCEEDED',
          'VALIDATE',
          current.path,
          `data string exceeds the ${String(MAX_DATA_STRING_LENGTH)} character limit`,
          { details: { limit: MAX_DATA_STRING_LENGTH, actual: current.value.length } },
        )
      }
      continue
    }

    let memberKeys: string[]
    let childAt: (key: string, index: number) => unknown
    let isArrayContainer: boolean
    if (Array.isArray(current.value)) {
      const container = current.value
      memberKeys = Array.from({ length: container.length }, (_, index) => String(index))
      childAt = (_key, index) => container[index]
      isArrayContainer = true
    } else if (isRecord(current.value)) {
      const container = current.value
      memberKeys = Object.keys(container)
      childAt = (key) => container[key]
      isArrayContainer = false
    } else {
      fail(context, 'SIDECAR_FIELD_INVALID', 'VALIDATE', current.path, 'data must contain only JSON-safe values')
    }
    if (current.containerDepth > MAX_DATA_DEPTH) {
      fail(
        context,
        'SIDECAR_LIMIT_EXCEEDED',
        'VALIDATE',
        current.path,
        `data exceeds the ${String(MAX_DATA_DEPTH)} container-depth limit`,
        { details: { limit: MAX_DATA_DEPTH, actual: current.containerDepth } },
      )
    }

    if (memberKeys.length > MAX_DATA_MEMBERS) {
      fail(
        context,
        'SIDECAR_LIMIT_EXCEEDED',
        'VALIDATE',
        current.path,
        `data container exceeds the ${String(MAX_DATA_MEMBERS)} member limit`,
        { details: { limit: MAX_DATA_MEMBERS, actual: memberKeys.length } },
      )
    }
    scheduledNodes += memberKeys.length
    if (scheduledNodes > MAX_DATA_NODES) {
      fail(
        context,
        'SIDECAR_LIMIT_EXCEEDED',
        'VALIDATE',
        current.path,
        `data exceeds the ${String(MAX_DATA_NODES)} JSON-node limit`,
        { details: { limit: MAX_DATA_NODES, actualAtLeast: scheduledNodes } },
      )
    }

    for (let index = memberKeys.length - 1; index >= 0; index -= 1) {
      const key = memberKeys[index]!
      if (!isArrayContainer && key.length > MAX_DATA_STRING_LENGTH) {
        fail(
          context,
          'SIDECAR_LIMIT_EXCEEDED',
          'VALIDATE',
          current.path,
          `data object key exceeds the ${String(MAX_DATA_STRING_LENGTH)} character limit`,
          {
            details: {
              limit: MAX_DATA_STRING_LENGTH,
              actual: key.length,
              memberIndex: index,
            },
          },
        )
      }
      const child = childAt(key, index)
      const childIsContainer = Array.isArray(child) || isRecord(child)
      pending.push({
        value: child,
        path: pointer(current.path, key),
        containerDepth: childIsContainer ? current.containerDepth + 1 : current.containerDepth,
      })
    }
  }
}

function readOptionalData(
  record: RecordValue,
  path: string,
  context: ValidationContext,
): TopologyJsonObject | undefined {
  if (!Object.prototype.hasOwnProperty.call(record, 'data')) return undefined
  const dataPath = pointer(path, 'data')
  const value = readRecord(record.data, dataPath, context)
  assertJsonSafe(value, dataPath, context)
  return value as TopologyJsonObject
}

function duplicateId(
  id: string,
  path: string,
  namespace: string,
  context: ValidationContext,
): never {
  return fail(
    context,
    'SIDECAR_DUPLICATE_ID',
    'VALIDATE',
    path,
    `duplicate ${namespace} ID "${id}"`,
    { entityId: id, details: { namespace } },
  )
}

function assertUniqueIds<T extends { id: string }>(
  values: readonly T[],
  collectionPath: string,
  namespace: string,
  context: ValidationContext,
  idField = 'id',
): void {
  const seen = new Set<string>()
  values.forEach((value, index) => {
    if (seen.has(value.id)) {
      duplicateId(value.id, `${collectionPath}/${String(index)}/${idField}`, namespace, context)
    }
    seen.add(value.id)
  })
}

function readPoint(
  value: unknown,
  path: string,
  context: ValidationContext,
): TopologySidecarPointV1 {
  const record = readRecord(value, path, context, 'SIDECAR_COORDINATE_INVALID')
  assertClosed(record, ['x', 'y', 'z'], path, context)
  return {
    x: readFiniteNumber(requireField(record, 'x', path, context), pointer(path, 'x'), context, {
      code: 'SIDECAR_COORDINATE_INVALID',
      phase: 'VALIDATE',
    }),
    y: readFiniteNumber(requireField(record, 'y', path, context), pointer(path, 'y'), context, {
      code: 'SIDECAR_COORDINATE_INVALID',
      phase: 'VALIDATE',
    }),
    z: readFiniteNumber(requireField(record, 'z', path, context), pointer(path, 'z'), context, {
      code: 'SIDECAR_COORDINATE_INVALID',
      phase: 'VALIDATE',
    }),
  }
}

function readDigest(
  value: unknown,
  path: string,
  context: ValidationContext,
): TopologySidecarDigest {
  const record = readRecord(value, path, context)
  assertClosed(record, ['algorithm', 'value'], path, context)
  const algorithm = requireField(record, 'algorithm', path, context)
  if (algorithm !== 'SHA-256') {
    fail(context, 'SIDECAR_FIELD_INVALID', 'VALIDATE', pointer(path, 'algorithm'), 'digest algorithm must be SHA-256')
  }
  const digestValue = requireField(record, 'value', path, context)
  if (typeof digestValue !== 'string' || !/^[0-9a-f]{64}$/.test(digestValue)) {
    fail(
      context,
      'SIDECAR_FIELD_INVALID',
      'VALIDATE',
      pointer(path, 'value'),
      'digest value must be exactly 64 lowercase hexadecimal characters',
    )
  }
  return { algorithm, value: digestValue }
}

function readAsset(
  value: unknown,
  index: number,
  context: ValidationContext,
): TopologySidecarAssetV1 {
  const path = `/assets/${String(index)}`
  const record = readRecord(value, path, context)
  assertClosed(record, ['assetId', 'uri', 'digest', 'revision'], path, context)
  const assetId = readString(requireField(record, 'assetId', path, context), `${path}/assetId`, context)
  const uri = readString(requireField(record, 'uri', path, context), `${path}/uri`, context, {
    maxLength: MAX_ASSET_URI_LENGTH,
    assetId,
  })
  const digest = Object.prototype.hasOwnProperty.call(record, 'digest')
    ? readDigest(record.digest, `${path}/digest`, context)
    : undefined
  const revision = Object.prototype.hasOwnProperty.call(record, 'revision')
    ? readString(record.revision, `${path}/revision`, context, { assetId })
    : undefined
  if (digest === undefined && revision === undefined) {
    fail(
      context,
      'SIDECAR_FIELD_INVALID',
      'VALIDATE',
      path,
      'asset must declare digest, revision, or both',
      { assetId },
    )
  }
  return { assetId, uri, ...(digest === undefined ? {} : { digest }), ...(revision === undefined ? {} : { revision }) }
}

function readLayer(
  value: unknown,
  index: number,
  context: ValidationContext,
): TopologySidecarLayerV1 {
  const path = `/layers/${String(index)}`
  const record = readRecord(value, path, context)
  assertClosed(record, ['id', 'label', 'order', 'elevation', 'tags', 'data'], path, context)
  const id = readString(requireField(record, 'id', path, context), `${path}/id`, context)
  const label = readOptionalString(record, 'label', path, context)
  const order = readOptionalFiniteNumber(record, 'order', path, context)
  const elevation = readOptionalFiniteNumber(record, 'elevation', path, context)
  const tags = readOptionalTags(record, path, context)
  const data = readOptionalData(record, path, context)
  return {
    id,
    ...(label === undefined ? {} : { label }),
    ...(order === undefined ? {} : { order }),
    ...(elevation === undefined ? {} : { elevation }),
    ...(tags === undefined ? {} : { tags }),
    ...(data === undefined ? {} : { data }),
  }
}

function readNode(
  value: unknown,
  index: number,
  context: ValidationContext,
): TopologySidecarNodeV1 {
  const path = `/nodes/${String(index)}`
  const record = readRecord(value, path, context)
  assertClosed(
    record,
    ['id', 'layerId', 'assetId', 'position', 'label', 'kind', 'subtype', 'tags', 'data'],
    path,
    context,
  )
  const id = readString(requireField(record, 'id', path, context), `${path}/id`, context)
  const layerId = readString(requireField(record, 'layerId', path, context), `${path}/layerId`, context)
  const assetId = readString(requireField(record, 'assetId', path, context), `${path}/assetId`, context)
  const position = readPoint(requireField(record, 'position', path, context), `${path}/position`, context)
  const label = readOptionalString(record, 'label', path, context)
  const kind = readOptionalString(record, 'kind', path, context)
  const subtype = readOptionalString(record, 'subtype', path, context)
  const tags = readOptionalTags(record, path, context)
  const data = readOptionalData(record, path, context)
  return {
    id,
    layerId,
    assetId,
    position,
    ...(label === undefined ? {} : { label }),
    ...(kind === undefined ? {} : { kind }),
    ...(subtype === undefined ? {} : { subtype }),
    ...(tags === undefined ? {} : { tags }),
    ...(data === undefined ? {} : { data }),
  }
}

function readViaPoint(
  value: unknown,
  edgeIndex: number,
  viaIndex: number,
  context: ValidationContext,
): TopologySidecarViaPointV1 {
  const path = `/edges/${String(edgeIndex)}/path/via/${String(viaIndex)}`
  const record = readRecord(value, path, context)
  assertClosed(record, ['assetId', 'position'], path, context)
  return {
    assetId: readString(requireField(record, 'assetId', path, context), `${path}/assetId`, context),
    position: readPoint(requireField(record, 'position', path, context), `${path}/position`, context),
  }
}

function readInitialState(
  value: unknown,
  edgeIndex: number,
  context: ValidationContext,
): TopologySidecarEdgeStateV1 {
  const path = `/edges/${String(edgeIndex)}/initialState`
  const record = readRecord(value, path, context)
  assertClosed(record, ['enabled', 'weightOverride'], path, context)
  let enabled: boolean | undefined
  if (Object.prototype.hasOwnProperty.call(record, 'enabled')) {
    if (typeof record.enabled !== 'boolean') {
      fail(context, 'SIDECAR_FIELD_INVALID', 'VALIDATE', `${path}/enabled`, 'enabled must be a boolean')
    }
    enabled = record.enabled
  }
  let weightOverride: number | null | undefined
  if (Object.prototype.hasOwnProperty.call(record, 'weightOverride')) {
    if (record.weightOverride === null) {
      weightOverride = null
    } else {
      weightOverride = readFiniteNumber(record.weightOverride, `${path}/weightOverride`, context, {
        nonNegative: true,
      })
    }
  }
  return {
    ...(enabled === undefined ? {} : { enabled }),
    ...(weightOverride === undefined ? {} : { weightOverride }),
  }
}

function readEdge(
  value: unknown,
  index: number,
  context: ValidationContext,
): TopologySidecarEdgeV1 {
  const path = `/edges/${String(index)}`
  const record = readRecord(value, path, context)
  assertClosed(
    record,
    ['id', 'source', 'target', 'relation', 'direction', 'path', 'weight', 'initialState', 'mode', 'tags', 'data'],
    path,
    context,
  )
  const id = readString(requireField(record, 'id', path, context), `${path}/id`, context)
  const source = readString(requireField(record, 'source', path, context), `${path}/source`, context)
  const target = readString(requireField(record, 'target', path, context), `${path}/target`, context)
  const relation = requireField(record, 'relation', path, context)
  if (relation !== 'LINK' && relation !== 'CONNECTOR') {
    fail(context, 'SIDECAR_FIELD_INVALID', 'VALIDATE', `${path}/relation`, 'relation must be LINK or CONNECTOR', {
      entityId: id,
    })
  }
  const direction = requireField(record, 'direction', path, context)
  if (direction !== 'FORWARD' && direction !== 'BIDIRECTIONAL') {
    fail(
      context,
      'SIDECAR_FIELD_INVALID',
      'VALIDATE',
      `${path}/direction`,
      'direction must be FORWARD or BIDIRECTIONAL',
      { entityId: id },
    )
  }
  let edgePath: TopologySidecarEdgeV1['path']
  if (Object.prototype.hasOwnProperty.call(record, 'path')) {
    const pathRecord = readRecord(record.path, `${path}/path`, context)
    assertClosed(pathRecord, ['type', 'via'], `${path}/path`, context)
    if (requireField(pathRecord, 'type', `${path}/path`, context) !== 'POLYLINE') {
      fail(context, 'SIDECAR_FIELD_INVALID', 'VALIDATE', `${path}/path/type`, 'path type must be POLYLINE')
    }
    const viaValues = readArray(requireField(pathRecord, 'via', `${path}/path`, context), `${path}/path/via`, context)
    if (viaValues.length > MAX_VIA_POINTS) {
      fail(
        context,
        'SIDECAR_LIMIT_EXCEEDED',
        'VALIDATE',
        `${path}/path/via`,
        `edge path exceeds the ${String(MAX_VIA_POINTS)} via-point limit`,
        { entityId: id, details: { limit: MAX_VIA_POINTS, actual: viaValues.length } },
      )
    }
    edgePath = {
      type: 'POLYLINE',
      via: viaValues.map((item, viaIndex) => readViaPoint(item, index, viaIndex, context)),
    }
  }
  const weight = readOptionalFiniteNumber(record, 'weight', path, context, { nonNegative: true })
  const initialState = Object.prototype.hasOwnProperty.call(record, 'initialState')
    ? readInitialState(record.initialState, index, context)
    : undefined
  const mode = readOptionalString(record, 'mode', path, context)
  const tags = readOptionalTags(record, path, context)
  const data = readOptionalData(record, path, context)
  return {
    id,
    source,
    target,
    relation,
    direction,
    ...(edgePath === undefined ? {} : { path: edgePath }),
    ...(weight === undefined ? {} : { weight }),
    ...(initialState === undefined ? {} : { initialState }),
    ...(mode === undefined ? {} : { mode }),
    ...(tags === undefined ? {} : { tags }),
    ...(data === undefined ? {} : { data }),
  }
}

function readConnector(
  value: unknown,
  index: number,
  context: ValidationContext,
): TopologySidecarConnectorV1 {
  const path = `/connectors/${String(index)}`
  const record = readRecord(value, path, context, 'SIDECAR_CONNECTOR_INVALID')
  assertClosed(record, ['id', 'nodeIds', 'edgeIds', 'label', 'tags', 'data'], path, context)
  const id = readString(requireField(record, 'id', path, context, 'SIDECAR_CONNECTOR_INVALID'), `${path}/id`, context, {
    code: 'SIDECAR_CONNECTOR_INVALID',
  })
  const nodeIds = readStringArray(
    requireField(record, 'nodeIds', path, context, 'SIDECAR_CONNECTOR_INVALID'),
    `${path}/nodeIds`,
    context,
    {
      code: 'SIDECAR_CONNECTOR_INVALID',
      minLength: 2,
      maxItems: MAX_CONNECTOR_REFERENCES,
    },
  )
  const edgeIds = readStringArray(
    requireField(record, 'edgeIds', path, context, 'SIDECAR_CONNECTOR_INVALID'),
    `${path}/edgeIds`,
    context,
    {
      code: 'SIDECAR_CONNECTOR_INVALID',
      minLength: 1,
      maxItems: MAX_CONNECTOR_REFERENCES,
    },
  )
  const label = readOptionalString(record, 'label', path, context, 'SIDECAR_CONNECTOR_INVALID')
  const tags = readOptionalTags(record, path, context)
  const data = readOptionalData(record, path, context)
  return {
    id,
    nodeIds,
    edgeIds,
    ...(label === undefined ? {} : { label }),
    ...(tags === undefined ? {} : { tags }),
    ...(data === undefined ? {} : { data }),
  }
}

function readBlocker(
  value: unknown,
  index: number,
  context: ValidationContext,
): TopologySidecarBlockerV1 {
  const path = `/blockers/${String(index)}`
  const record = readRecord(value, path, context, 'SIDECAR_BLOCKER_INVALID')
  assertClosed(record, ['id', 'active', 'edgeIds', 'label', 'kind', 'tags', 'data'], path, context)
  const id = readString(requireField(record, 'id', path, context, 'SIDECAR_BLOCKER_INVALID'), `${path}/id`, context, {
    code: 'SIDECAR_BLOCKER_INVALID',
  })
  const activeValue = requireField(record, 'active', path, context, 'SIDECAR_BLOCKER_INVALID')
  if (typeof activeValue !== 'boolean') {
    fail(context, 'SIDECAR_BLOCKER_INVALID', 'VALIDATE', `${path}/active`, 'blocker active must be a boolean', {
      entityId: id,
    })
  }
  const edgeIds = readStringArray(
    requireField(record, 'edgeIds', path, context, 'SIDECAR_BLOCKER_INVALID'),
    `${path}/edgeIds`,
    context,
    {
      code: 'SIDECAR_BLOCKER_INVALID',
      minLength: 1,
      maxItems: MAX_BLOCKER_REFERENCES,
    },
  )
  const label = readOptionalString(record, 'label', path, context, 'SIDECAR_BLOCKER_INVALID')
  const kind = readOptionalString(record, 'kind', path, context, 'SIDECAR_BLOCKER_INVALID')
  const tags = readOptionalTags(record, path, context)
  const data = readOptionalData(record, path, context)
  return {
    id,
    active: activeValue,
    edgeIds,
    ...(label === undefined ? {} : { label }),
    ...(kind === undefined ? {} : { kind }),
    ...(tags === undefined ? {} : { tags }),
    ...(data === undefined ? {} : { data }),
  }
}

function readCollection(
  record: RecordValue,
  key: string,
  context: ValidationContext,
): readonly unknown[] {
  return readArray(requireField(record, key, '', context), `/${key}`, context)
}

function assertCollectionLimit(
  values: readonly unknown[],
  key: string,
  min: number,
  max: number | null,
  context: ValidationContext,
): void {
  if (values.length < min) {
    fail(
      context,
      'SIDECAR_FIELD_INVALID',
      'VALIDATE',
      `/${key}`,
      `${key} must contain at least ${String(min)} item(s)`,
      { details: { min, actual: values.length } },
    )
  }
  if (max !== null && values.length > max) {
    fail(
      context,
      'SIDECAR_LIMIT_EXCEEDED',
      'VALIDATE',
      `/${key}`,
      `${key} exceeds the ${String(max)} item limit`,
      { details: { max, actual: values.length } },
    )
  }
}

function canonicalizeAssetUri(
  asset: TopologySidecarAssetV1,
  assetIndex: number,
  context: ValidationContext,
): string {
  const path = `/assets/${String(assetIndex)}/uri`
  let sidecarUrl: URL
  try {
    sidecarUrl = new URL(context.sidecarUri)
  } catch {
    fail(context, 'SIDECAR_FIELD_INVALID', 'VALIDATE', '', 'sidecarUri must be an absolute URL')
  }
  if (!['http:', 'https:'].includes(sidecarUrl.protocol) || sidecarUrl.username || sidecarUrl.password) {
    fail(context, 'SIDECAR_FIELD_INVALID', 'VALIDATE', '', 'sidecarUri must use HTTP(S) without credentials')
  }
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(asset.uri) || asset.uri.startsWith('//') || asset.uri.includes('\\')) {
    fail(
      context,
      'SIDECAR_FIELD_INVALID',
      'VALIDATE',
      path,
      'asset uri must be relative to the sidecar or root-relative',
      { assetId: asset.assetId },
    )
  }
  let resolved: URL
  try {
    resolved = new URL(asset.uri, sidecarUrl)
  } catch {
    fail(context, 'SIDECAR_FIELD_INVALID', 'VALIDATE', path, 'asset uri cannot be normalized', {
      assetId: asset.assetId,
    })
  }
  if (resolved.origin !== sidecarUrl.origin || resolved.hash) {
    fail(
      context,
      'SIDECAR_FIELD_INVALID',
      'VALIDATE',
      path,
      'asset uri must resolve to a same-origin resource without a fragment',
      { assetId: asset.assetId },
    )
  }
  return resolved.href
}

function validateReferencesAndTopology(document: TopologySidecarV1, context: ValidationContext): void {
  const assetIds = new Set(document.assets.map((asset) => asset.assetId))
  const layerById = new Map(document.layers.map((layer) => [layer.id, layer]))
  const nodeById = new Map(document.nodes.map((node) => [node.id, node]))
  const edgeById = new Map(document.edges.map((edge) => [edge.id, edge]))

  const canonicalUris = new Map<string, string>()
  document.assets.forEach((asset, index) => {
    const canonicalUri = canonicalizeAssetUri(asset, index, context)
    const previous = canonicalUris.get(canonicalUri)
    if (previous !== undefined) {
      fail(
        context,
        'SIDECAR_FIELD_INVALID',
        'VALIDATE',
        `/assets/${String(index)}/uri`,
        'asset canonical uri must be unique within the sidecar',
        { assetId: asset.assetId, details: { conflictsWithAssetId: previous } },
      )
    }
    canonicalUris.set(canonicalUri, asset.assetId)
  })

  document.nodes.forEach((node, index) => {
    if (!layerById.has(node.layerId)) {
      fail(
        context,
        'SIDECAR_REFERENCE_BROKEN',
        'VALIDATE',
        `/nodes/${String(index)}/layerId`,
        'node references an unknown layer',
        { entityId: node.id, details: { referenceType: 'layer' } },
      )
    }
    if (!assetIds.has(node.assetId)) {
      fail(
        context,
        'SIDECAR_REFERENCE_BROKEN',
        'VALIDATE',
        `/nodes/${String(index)}/assetId`,
        'node references an unknown asset',
        { assetId: node.assetId, entityId: node.id, details: { referenceType: 'asset' } },
      )
    }
  })

  let segmentCount = 0
  document.edges.forEach((edge, edgeIndex) => {
    const source = nodeById.get(edge.source)
    const target = nodeById.get(edge.target)
    if (source === undefined) {
      fail(
        context,
        'SIDECAR_REFERENCE_BROKEN',
        'VALIDATE',
        `/edges/${String(edgeIndex)}/source`,
        'edge source references an unknown node',
        { entityId: edge.id, details: { referenceType: 'node' } },
      )
    }
    if (target === undefined) {
      fail(
        context,
        'SIDECAR_REFERENCE_BROKEN',
        'VALIDATE',
        `/edges/${String(edgeIndex)}/target`,
        'edge target references an unknown node',
        { entityId: edge.id, details: { referenceType: 'node' } },
      )
    }
    if (edge.source === edge.target) {
      fail(context, 'SIDECAR_FIELD_INVALID', 'VALIDATE', `/edges/${String(edgeIndex)}/target`, 'edge source and target must differ', {
        entityId: edge.id,
      })
    }
    edge.path?.via.forEach((via, viaIndex) => {
      if (!assetIds.has(via.assetId)) {
        fail(
          context,
          'SIDECAR_REFERENCE_BROKEN',
          'VALIDATE',
          `/edges/${String(edgeIndex)}/path/via/${String(viaIndex)}/assetId`,
          'via point references an unknown asset',
          { assetId: via.assetId, entityId: edge.id, details: { referenceType: 'asset' } },
        )
      }
    })
    segmentCount += (edge.path?.via.length ?? 0) + 1
  })
  if (segmentCount > MAX_SEGMENTS) {
    fail(
      context,
      'SIDECAR_LIMIT_EXCEEDED',
      'VALIDATE',
      '/edges',
      `compiled polylines exceed the ${String(MAX_SEGMENTS)} segment limit`,
      { details: { limit: MAX_SEGMENTS, actual: segmentCount } },
    )
  }

  const edgeOwner = new Map<string, string>()
  const nodeOwner = new Map<string, string>()
  document.connectors.forEach((connector, connectorIndex) => {
    const connectorPath = `/connectors/${String(connectorIndex)}`
    const connectorNodeIds = new Set(connector.nodeIds)
    const nodes = connector.nodeIds.map((nodeId, nodeIndex) => {
      const node = nodeById.get(nodeId)
      if (node === undefined) {
        fail(
          context,
          'SIDECAR_CONNECTOR_INVALID',
          'VALIDATE',
          `${connectorPath}/nodeIds/${String(nodeIndex)}`,
          'connector references an unknown node',
          { entityId: connector.id, details: { referenceType: 'node' } },
        )
      }
      const previousOwner = nodeOwner.get(nodeId)
      if (previousOwner !== undefined) {
        fail(
          context,
          'SIDECAR_CONNECTOR_INVALID',
          'VALIDATE',
          `${connectorPath}/nodeIds/${String(nodeIndex)}`,
          'a node may belong to at most one connector',
          { entityId: connector.id, details: { conflictsWithConnectorId: previousOwner } },
        )
      }
      nodeOwner.set(nodeId, connector.id)
      return node
    })
    if (new Set(nodes.map((node) => node.layerId)).size < 2) {
      fail(
        context,
        'SIDECAR_CONNECTOR_INVALID',
        'VALIDATE',
        `${connectorPath}/nodeIds`,
        'connector nodes must span at least two layers',
        { entityId: connector.id },
      )
    }
    const participatingNodeIds = new Set<string>()
    connector.edgeIds.forEach((edgeId, edgeIndex) => {
      const edge = edgeById.get(edgeId)
      if (edge === undefined) {
        fail(
          context,
          'SIDECAR_CONNECTOR_INVALID',
          'VALIDATE',
          `${connectorPath}/edgeIds/${String(edgeIndex)}`,
          'connector references an unknown edge',
          { entityId: connector.id, details: { referenceType: 'edge' } },
        )
      }
      const previousOwner = edgeOwner.get(edgeId)
      if (previousOwner !== undefined) {
        fail(
          context,
          'SIDECAR_CONNECTOR_INVALID',
          'VALIDATE',
          `${connectorPath}/edgeIds/${String(edgeIndex)}`,
          'a connector edge must have exactly one owner',
          { entityId: connector.id, details: { conflictsWithConnectorId: previousOwner } },
        )
      }
      edgeOwner.set(edgeId, connector.id)
      if (!connectorNodeIds.has(edge.source) || !connectorNodeIds.has(edge.target)) {
        fail(
          context,
          'SIDECAR_CONNECTOR_INVALID',
          'VALIDATE',
          `${connectorPath}/edgeIds/${String(edgeIndex)}`,
          'connector edge endpoints must both be connector members',
          { entityId: connector.id, details: { edgeId } },
        )
      }
      const source = nodeById.get(edge.source)!
      const target = nodeById.get(edge.target)!
      if (edge.relation !== 'CONNECTOR' || source.layerId === target.layerId) {
        fail(
          context,
          'SIDECAR_CONNECTOR_INVALID',
          'VALIDATE',
          `${connectorPath}/edgeIds/${String(edgeIndex)}`,
          'connector-owned edges must be cross-layer CONNECTOR edges',
          { entityId: connector.id, details: { edgeId } },
        )
      }
      participatingNodeIds.add(edge.source)
      participatingNodeIds.add(edge.target)
    })
    connector.nodeIds.forEach((nodeId, nodeIndex) => {
      if (!participatingNodeIds.has(nodeId)) {
        fail(
          context,
          'SIDECAR_CONNECTOR_INVALID',
          'VALIDATE',
          `${connectorPath}/nodeIds/${String(nodeIndex)}`,
          'every connector node must participate in a listed connector edge',
          { entityId: connector.id },
        )
      }
    })
  })

  document.edges.forEach((edge, edgeIndex) => {
    const source = nodeById.get(edge.source)!
    const target = nodeById.get(edge.target)!
    const crossLayer = source.layerId !== target.layerId
    const owner = edgeOwner.get(edge.id)
    if (crossLayer && (edge.relation !== 'CONNECTOR' || owner === undefined)) {
      fail(
        context,
        'SIDECAR_CONNECTOR_INVALID',
        'VALIDATE',
        `/edges/${String(edgeIndex)}`,
        'every cross-layer edge must be CONNECTOR and owned by exactly one connector',
        { entityId: edge.id },
      )
    }
    if (!crossLayer && (edge.relation !== 'LINK' || owner !== undefined)) {
      fail(
        context,
        'SIDECAR_CONNECTOR_INVALID',
        'VALIDATE',
        `/edges/${String(edgeIndex)}`,
        'same-layer edges must be LINK and cannot be connector-owned',
        { entityId: edge.id },
      )
    }
  })

  const activeBlockerCountByEdge = new Map<string, number>()
  document.blockers.forEach((blocker, blockerIndex) => {
    blocker.edgeIds.forEach((edgeId, edgeIndex) => {
      if (!edgeById.has(edgeId)) {
        fail(
          context,
          'SIDECAR_BLOCKER_INVALID',
          'VALIDATE',
          `/blockers/${String(blockerIndex)}/edgeIds/${String(edgeIndex)}`,
          'blocker references an unknown edge',
          { entityId: blocker.id, details: { referenceType: 'edge' } },
        )
      }
      if (blocker.active) {
        const activeCount = (activeBlockerCountByEdge.get(edgeId) ?? 0) + 1
        if (activeCount > MAX_ACTIVE_BLOCKERS_PER_EDGE) {
          fail(
            context,
            'SIDECAR_LIMIT_EXCEEDED',
            'VALIDATE',
            `/blockers/${String(blockerIndex)}/edgeIds/${String(edgeIndex)}`,
            `edge exceeds the ${String(MAX_ACTIVE_BLOCKERS_PER_EDGE)} active-blocker limit`,
            {
              entityId: blocker.id,
              details: {
                limit: MAX_ACTIVE_BLOCKERS_PER_EDGE,
                actual: activeCount,
                edgeId,
              },
            },
          )
        }
        activeBlockerCountByEdge.set(edgeId, activeCount)
      }
    })
  })
}

function parseDocument(value: unknown, context: ValidationContext): TopologySidecarV1 {
  const record = readRecord(value, '', context)

  const schema = requireField(record, 'schema', '', context)
  if (schema !== SIDECAR_SCHEMA) {
    fail(context, 'SIDECAR_SCHEMA_UNSUPPORTED', 'PARSE', '/schema', 'unsupported topology sidecar schema')
  }
  const schemaVersion = requireField(record, 'schemaVersion', '', context)
  if (schemaVersion !== 1) {
    fail(context, 'SIDECAR_SCHEMA_UNSUPPORTED', 'PARSE', '/schemaVersion', 'unsupported topology sidecar schema version')
  }

  assertClosed(record, TOP_LEVEL_FIELDS, '', context)
  const coordinateSpace = requireField(record, 'coordinateSpace', '', context)
  const unit = requireField(record, 'unit', '', context)
  const upAxis = requireField(record, 'upAxis', '', context)
  if (coordinateSpace !== 'ASSET_LOCAL') {
    fail(context, 'SIDECAR_FIELD_INVALID', 'VALIDATE', '/coordinateSpace', 'coordinateSpace must be ASSET_LOCAL')
  }
  if (unit !== 'meter') {
    fail(context, 'SIDECAR_FIELD_INVALID', 'VALIDATE', '/unit', 'unit must be meter')
  }
  if (upAxis !== 'Y') {
    fail(context, 'SIDECAR_FIELD_INVALID', 'VALIDATE', '/upAxis', 'upAxis must be Y')
  }

  const assetValues = readCollection(record, 'assets', context)
  const layerValues = readCollection(record, 'layers', context)
  const nodeValues = readCollection(record, 'nodes', context)
  const edgeValues = readCollection(record, 'edges', context)
  const connectorValues = readCollection(record, 'connectors', context)
  const blockerValues = readCollection(record, 'blockers', context)
  assertCollectionLimit(assetValues, 'assets', 1, MAX_ASSETS, context)
  assertCollectionLimit(layerValues, 'layers', 1, MAX_LAYERS, context)
  assertCollectionLimit(nodeValues, 'nodes', 1, MAX_NODES, context)
  assertCollectionLimit(edgeValues, 'edges', 0, MAX_EDGES, context)
  assertCollectionLimit(connectorValues, 'connectors', 0, MAX_CONNECTORS, context)
  assertCollectionLimit(blockerValues, 'blockers', 0, MAX_BLOCKERS, context)

  const assets = assetValues.map((item, index) => readAsset(item, index, context))
  const layers = layerValues.map((item, index) => readLayer(item, index, context))
  const nodes = nodeValues.map((item, index) => readNode(item, index, context))
  const edges = edgeValues.map((item, index) => readEdge(item, index, context))
  const connectors = connectorValues.map((item, index) => readConnector(item, index, context))
  const blockers = blockerValues.map((item, index) => readBlocker(item, index, context))

  let connectorReferenceCount = 0
  connectors.forEach((connector) => {
    connectorReferenceCount += connector.nodeIds.length + connector.edgeIds.length
    if (connectorReferenceCount > MAX_CONNECTOR_REFERENCES) {
      fail(
        context,
        'SIDECAR_LIMIT_EXCEEDED',
        'VALIDATE',
        '/connectors',
        `connectors exceed the ${String(MAX_CONNECTOR_REFERENCES)} total-reference limit`,
        {
          entityId: connector.id,
          details: { limit: MAX_CONNECTOR_REFERENCES, actual: connectorReferenceCount },
        },
      )
    }
  })
  let blockerReferenceCount = 0
  blockers.forEach((blocker) => {
    blockerReferenceCount += blocker.edgeIds.length
    if (blockerReferenceCount > MAX_BLOCKER_REFERENCES) {
      fail(
        context,
        'SIDECAR_LIMIT_EXCEEDED',
        'VALIDATE',
        '/blockers',
        `blockers exceed the ${String(MAX_BLOCKER_REFERENCES)} total-reference limit`,
        {
          entityId: blocker.id,
          details: { limit: MAX_BLOCKER_REFERENCES, actual: blockerReferenceCount },
        },
      )
    }
  })
  assertUniqueIds(assets.map((asset) => ({ id: asset.assetId })), '/assets', 'asset', context, 'assetId')
  assertUniqueIds(layers, '/layers', 'layer', context)
  assertUniqueIds(nodes, '/nodes', 'node', context)
  assertUniqueIds(edges, '/edges', 'edge', context)
  assertUniqueIds(connectors, '/connectors', 'connector', context)
  assertUniqueIds(blockers, '/blockers', 'blocker', context)

  const tags = readOptionalTags(record, '', context)
  const data = readOptionalData(record, '', context)
  const document: TopologySidecarV1 = {
    schema,
    schemaVersion,
    revision: readString(requireField(record, 'revision', '', context), '/revision', context),
    graphId: readString(requireField(record, 'graphId', '', context), '/graphId', context),
    coordinateSpace,
    unit,
    upAxis,
    assets,
    layers,
    nodes,
    edges,
    connectors,
    blockers,
    ...(tags === undefined ? {} : { tags }),
    ...(data === undefined ? {} : { data }),
  }
  validateReferencesAndTopology(document, context)
  return document
}

/**
 * Parses and fully validates a closed topology sidecar v1 document.
 * No asset lookup, world transform, network request, or SSP call occurs here.
 */
export function parseTopologySidecarV1(jsonText: string, sidecarUri: string): TopologySidecarParseResult {
  const context: ValidationContext = { sidecarUri }
  const sourceSize = measureUtf8BytesThroughLimit(jsonText, MAX_SIDECAR_UTF8_BYTES)
  if (sourceSize.exceeded) {
    return {
      ok: false,
      diagnostics: [{
        code: 'SIDECAR_LIMIT_EXCEEDED',
        phase: 'PARSE',
        message: 'topology sidecar source exceeds the 8 MiB UTF-8 limit',
        path: '',
        sidecarUri: redactTopologySidecarUri(sidecarUri),
        assetId: null,
        entityId: null,
        details: {
          limitBytes: MAX_SIDECAR_UTF8_BYTES,
          actualBytesAtLeast: sourceSize.bytes,
        },
      }],
    }
  }
  let raw: unknown
  try {
    raw = JSON.parse(jsonText) as unknown
  } catch {
    return {
      ok: false,
      diagnostics: [{
        code: 'SIDECAR_JSON_INVALID',
        phase: 'PARSE',
        message: 'topology sidecar is not valid JSON',
        path: '',
        sidecarUri: redactTopologySidecarUri(sidecarUri),
        assetId: null,
        entityId: null,
        details: {},
      }],
    }
  }

  try {
    return { ok: true, document: parseDocument(raw, context) }
  } catch (error) {
    if (error instanceof SidecarValidationFailure) {
      return { ok: false, diagnostics: [error.diagnostic] }
    }
    return {
      ok: false,
      diagnostics: [{
        code: 'SIDECAR_FIELD_INVALID',
        phase: 'PARSE',
        message: 'topology sidecar could not be validated',
        path: '',
        sidecarUri: redactTopologySidecarUri(sidecarUri),
        assetId: null,
        entityId: null,
        details: {},
      }],
    }
  }
}

/** Internal shared URI rule used by the compiler after parse-time validation. */
export function canonicalizeTopologyAssetUri(assetUri: string, sidecarUri: string): string {
  return new URL(assetUri, new URL(sidecarUri)).href
}
