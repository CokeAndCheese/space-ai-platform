import { failure } from './diagnostics'
import { packageJsonDepth } from './manifestV1'
import type {
  PackageAsset,
  PackageCapabilitiesV2,
  PackageFloor,
  PackageManifestDocumentV2,
  PackageParseResult,
} from './types'

const MAX_BYTES = 1024 * 1024
const MAX_DEPTH = 16
const MAX_STRING = 160
const MAX_URI = 4096
const SHA256 = /^[0-9a-f]{64}$/
const ENCODED_UNRESERVED = /%(?:2d|2e|5f|7e|3[0-9]|4[1-9a-f]|5[0-9a]|6[1-9a-f]|7[0-9a])/iu
const FLOOR_TYPES = new Set([
  'FLOOR',
  'TOWER',
  'ROOF',
  'BASEMENT',
  'LANDSCAPE_TERRAIN',
  'LANDSCAPE_FACADE',
  'FACILITY',
])

function utf8Fatal(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) return true
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true
    }
  }
  return false
}

function stringsOk(
  value: unknown,
  path = '',
  seen = new Set<unknown>(),
): { path: string; reason: 'limit' | 'unicode' } | null {
  const uriField = /^\/assets\/\d+\/uri$/.test(path)
  if (typeof value === 'string') {
    if (hasLoneSurrogate(value)) return { path: path || '/', reason: 'unicode' }
    if (value.length > (uriField ? MAX_URI : MAX_STRING)) return { path: path || '/', reason: 'limit' }
  }
  if (!value || typeof value !== 'object' || seen.has(value)) return null
  seen.add(value)
  const entries = Array.isArray(value) ? value.entries() : Object.entries(value)
  for (const [key, child] of entries) {
    const result = stringsOk(child, `${path}/${String(key)}`, seen)
    if (result) return result
  }
  return null
}

function object(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const result = value as Record<string, unknown>
  const allowed = new Set(keys)
  if (Object.keys(result).some((key) => !allowed.has(key))) return null
  return result
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() && value.length <= MAX_STRING
    ? value.trim()
    : null
}

function uri(value: unknown, base: URL): { original: string; canonical: string } | null {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_URI ||
    /[\\#\0]/u.test(value) ||
    /%(?![0-9a-f]{2})/iu.test(value) ||
    ENCODED_UNRESERVED.test(value)
  ) return null
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(value) || /\s/u.test(value)) return null
  const rawPath = value.split(/[?#]/, 1)[0]!
  if (rawPath.split('/').some((part) => {
    try {
      const decoded = decodeURIComponent(part)
      return decoded === '..' || (decoded === '.' && part !== '.') || /[\\/\0]/u.test(decoded)
    } catch {
      return true
    }
  })) return null
  let parsed: URL
  try {
    parsed = new URL(value, base)
  } catch {
    return null
  }
  if (parsed.origin !== base.origin || parsed.username || parsed.password || parsed.hash || parsed.search) return null
  if (!parsed.pathname || parsed.pathname.endsWith('/') || parsed.pathname.split('/').some((part) => part === '..')) return null
  return { original: value, canonical: new URL(parsed.pathname, base).toString() }
}

function digest(value: unknown): { algorithm: 'SHA-256'; value: string } | null {
  const entry = object(value, ['algorithm', 'value'])
  if (
    !entry ||
    entry.algorithm !== 'SHA-256' ||
    typeof entry.value !== 'string' ||
    !SHA256.test(entry.value)
  ) return null
  return Object.freeze({ algorithm: 'SHA-256', value: entry.value })
}

function floor(value: unknown): PackageFloor | null {
  const entry = object(value, ['floorName', 'building', 'level', 'floorType'])
  if (!entry) return null
  const floorName = text(entry.floorName)
  const floorType = text(entry.floorType)
  const building = entry.building === null ? null : text(entry.building)
  const level = entry.level === null ? null : entry.level
  if (
    !floorName ||
    !floorType ||
    !FLOOR_TYPES.has(floorType) ||
    !Object.prototype.hasOwnProperty.call(entry, 'building') ||
    !Object.prototype.hasOwnProperty.call(entry, 'level') ||
    (level !== null && (typeof level !== 'number' || !Number.isFinite(level) || !Number.isInteger(level)))
  ) return null
  if (floorType === 'LANDSCAPE_TERRAIN' || floorType === 'LANDSCAPE_FACADE') {
    if (building !== null || level !== null) return null
  } else if (!building || (level === null && floorType !== 'TOWER' && floorType !== 'ROOF')) {
    return null
  }
  return Object.freeze({ floorName, building, level, floorType })
}

function capabilities(value: unknown): PackageCapabilitiesV2 | null {
  const root = object(value, ['scene', 'metadata', 'space', 'topology'])
  if (!root) return null
  const scene = object(root.scene, ['status'])
  const metadata = object(root.metadata, ['status'])
  const space = object(root.space, ['status', 'completion'])
  const topology = object(root.topology, ['status'])
  if (
    !scene || scene.status !== 'AVAILABLE' ||
    !metadata || metadata.status !== 'AVAILABLE' ||
    !space || space.status !== 'AVAILABLE' || space.completion !== 'CONFIRMED' ||
    !topology || topology.status !== 'ABSENT'
  ) return null
  return Object.freeze({
    scene: Object.freeze({ status: 'AVAILABLE' as const }),
    metadata: Object.freeze({ status: 'AVAILABLE' as const }),
    space: Object.freeze({ status: 'AVAILABLE' as const, completion: 'CONFIRMED' as const }),
    topology: Object.freeze({ status: 'ABSENT' as const }),
  })
}

export function parsePackageManifestV2(
  bytes: Uint8Array,
  manifestUri: string,
): PackageParseResult<PackageManifestDocumentV2> {
  const context = { manifestUri }
  if (bytes.byteLength > MAX_BYTES) {
    return failure('PACKAGE_LIMIT_EXCEEDED', 'PARSE', '/', { limit: MAX_BYTES, kind: 'manifest' }, context)
  }
  const source = utf8Fatal(bytes)
  if (source === null) return failure('PACKAGE_JSON_INVALID', 'PARSE', '/', { reason: 'invalid-utf8' }, context)
  let raw: unknown
  try {
    raw = JSON.parse(source) as unknown
  } catch {
    return failure('PACKAGE_JSON_INVALID', 'PARSE', '/', { reason: 'json-parse' }, context)
  }
  if (packageJsonDepth(raw) > MAX_DEPTH) {
    return failure('PACKAGE_LIMIT_EXCEEDED', 'VALIDATE', '/', { limit: MAX_DEPTH, kind: 'depth' }, context)
  }
  const overlong = stringsOk(raw)
  if (overlong) {
    return failure(
      overlong.reason === 'unicode' ? 'PACKAGE_FIELD_INVALID' : 'PACKAGE_LIMIT_EXCEEDED',
      'VALIDATE',
      overlong.path,
      overlong.reason === 'unicode'
        ? { reason: 'invalid-unicode' }
        : { limit: /\/uri$/.test(overlong.path) ? MAX_URI : MAX_STRING, kind: 'string' },
      context,
    )
  }
  const root = object(raw, [
    'schema',
    'schemaVersion',
    'profile',
    'packageId',
    'revision',
    'metadata',
    'capabilities',
    'assets',
  ])
  if (!root) return failure('PACKAGE_FIELD_INVALID', 'VALIDATE', '/', { reason: 'closed-object' }, context)
  if (root.schema !== 'space-model-package' || root.schemaVersion !== 2) {
    return failure('PACKAGE_SCHEMA_UNSUPPORTED', 'VALIDATE', root.schema !== 'space-model-package' ? '/schema' : '/schemaVersion', {}, context)
  }
  if (root.profile !== 'TOPOLOGY_ABSENT_TRANSITION') {
    return failure('PACKAGE_PROFILE_UNSUPPORTED', 'VALIDATE', '/profile', {}, context)
  }
  const packageId = text(root.packageId)
  const revision = text(root.revision)
  if (!packageId) return failure('PACKAGE_FIELD_INVALID', 'VALIDATE', '/packageId', {}, context)
  if (!revision || !SHA256.test(revision)) {
    return failure('PACKAGE_FIELD_INVALID', 'VALIDATE', '/revision', {}, context)
  }
  const metadata = object(root.metadata, ['schema', 'version', 'carrier'])
  if (
    !metadata ||
    metadata.schema !== 'space-model-metadata' ||
    metadata.version !== '3.3-semantic' ||
    metadata.carrier !== 'GLB_SCENE_NODE_EXTRAS'
  ) return failure('PACKAGE_METADATA_UNSUPPORTED', 'VALIDATE', '/metadata', {}, context)
  const capabilityDocument = capabilities(root.capabilities)
  if (!capabilityDocument) {
    return failure('PACKAGE_CAPABILITY_DECLARATION_INVALID', 'VALIDATE', '/capabilities', {}, context)
  }
  if (!Array.isArray(root.assets) || root.assets.length < 1 || root.assets.length > 128) {
    return failure('PACKAGE_LIMIT_EXCEEDED', 'VALIDATE', '/assets', { limit: 128 }, context)
  }
  let base: URL
  try {
    base = new URL(manifestUri)
  } catch {
    return failure('PACKAGE_URI_INVALID', 'VALIDATE', '/', {}, context)
  }
  if (
    (base.protocol !== 'http:' && base.protocol !== 'https:') ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    !base.pathname.endsWith('/space-model-package.v2.json')
  ) return failure('PACKAGE_URI_INVALID', 'VALIDATE', '/', {}, context)
  const normalizedManifestUri = base.toString()
  const ids = new Set<string>()
  const uris = new Set<string>()
  const floors = new Set<string>()
  const assets: PackageAsset[] = []
  for (let index = 0; index < root.assets.length; index += 1) {
    const path = `/assets/${index}`
    const entry = object(root.assets[index], ['assetId', 'uri', 'digest', 'floor'])
    if (!entry) return failure('PACKAGE_FIELD_INVALID', 'VALIDATE', path, { reason: 'closed-object' }, context)
    const assetId = text(entry.assetId)
    const resource = uri(entry.uri, base)
    const hash = digest(entry.digest)
    const floorInfo = floor(entry.floor)
    if (!resource || !resource.canonical.toLowerCase().endsWith('.glb')) {
      return failure('PACKAGE_URI_INVALID', 'VALIDATE', `${path}/uri`, {}, context)
    }
    if (!assetId || !hash || !floorInfo) {
      return failure('PACKAGE_FIELD_INVALID', 'VALIDATE', path, {}, context)
    }
    const floorKey = `${floorInfo.building ?? ''}\u0000${floorInfo.floorName}`
    if (ids.has(assetId) || uris.has(resource.canonical) || floors.has(floorKey)) {
      return failure('PACKAGE_DUPLICATE_ID', 'VALIDATE', path, {}, { ...context, assetId })
    }
    ids.add(assetId)
    uris.add(resource.canonical)
    floors.add(floorKey)
    assets.push(Object.freeze({
      assetId,
      uri: resource.original,
      canonicalUri: resource.canonical,
      digest: hash,
      floor: floorInfo,
    }))
  }
  return {
    ok: true,
    value: Object.freeze({
      schema: 'space-model-package',
      schemaVersion: 2,
      profile: 'TOPOLOGY_ABSENT_TRANSITION',
      packageId,
      revision,
      metadata: Object.freeze({
        schema: 'space-model-metadata',
        version: '3.3-semantic',
        carrier: 'GLB_SCENE_NODE_EXTRAS',
      }),
      capabilities: capabilityDocument,
      assets: Object.freeze(assets),
      manifestUri: normalizedManifestUri,
    }),
  }
}

type CanonicalJson = null | boolean | number | string | readonly CanonicalJson[] | {
  readonly [key: string]: CanonicalJson
}

function canonicalJson(value: CanonicalJson): string {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonical JSON requires finite numbers')
    return JSON.stringify(Object.is(value, -0) ? 0 : value)
  }
  if (typeof value === 'string') {
    if (hasLoneSurrogate(value)) throw new TypeError('canonical JSON requires Unicode scalar values')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  const record = value as Readonly<Record<string, CanonicalJson>>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key]!)}`).join(',')}}`
}

export function packageManifestV2RevisionFacts(
  manifest: PackageManifestDocumentV2,
): CanonicalJson {
  return {
    schema: manifest.schema,
    schemaVersion: manifest.schemaVersion,
    profile: manifest.profile,
    packageId: manifest.packageId,
    metadata: {
      schema: manifest.metadata.schema,
      version: manifest.metadata.version,
      carrier: manifest.metadata.carrier,
    },
    capabilities: {
      scene: { status: manifest.capabilities.scene.status },
      metadata: { status: manifest.capabilities.metadata.status },
      space: {
        status: manifest.capabilities.space.status,
        completion: manifest.capabilities.space.completion,
      },
      topology: { status: manifest.capabilities.topology.status },
    },
    assets: manifest.assets.map((asset) => ({
      assetId: asset.assetId,
      uri: asset.uri,
      digest: {
        algorithm: asset.digest.algorithm,
        value: asset.digest.value,
      },
      floor: {
        floorName: asset.floor.floorName,
        building: asset.floor.building,
        level: asset.floor.level,
        floorType: asset.floor.floorType,
      },
    })),
  }
}

export function canonicalizePackageManifestV2Revision(
  manifest: PackageManifestDocumentV2,
): string {
  return canonicalJson(packageManifestV2RevisionFacts(manifest))
}

export async function computePackageManifestV2Revision(
  manifest: PackageManifestDocumentV2,
): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalizePackageManifestV2Revision(manifest))
  const digestBytes = await globalThis.crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource)
  return Array.from(new Uint8Array(digestBytes), (value) => value.toString(16).padStart(2, '0')).join('')
}

export async function verifyPackageManifestV2Revision(
  manifest: PackageManifestDocumentV2,
): Promise<PackageParseResult<PackageManifestDocumentV2>> {
  const actual = await computePackageManifestV2Revision(manifest)
  if (actual !== manifest.revision) {
    return failure(
      'PACKAGE_REVISION_MISMATCH',
      'HASH',
      '/revision',
      { expected: manifest.revision, actual },
      { manifestUri: manifest.manifestUri },
    )
  }
  return { ok: true, value: manifest }
}
