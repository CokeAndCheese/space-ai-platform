import { failure } from './diagnostics'
import type { PackageManifestDocument, PackageParseResult, PackageAsset, PackageFloor } from './types'

const MAX_BYTES = 1024 * 1024
const MAX_DEPTH = 16
const MAX_STRING = 160
const MAX_URI = 4096
const SHA256 = /^[0-9a-f]{64}$/
const ENCODED_UNRESERVED = /%(?:2d|2e|5f|7e|3[0-9]|4[1-9a-f]|5[0-9a]|6[1-9a-f]|7[0-9a])/iu
const FLOOR_TYPES = new Set(['FLOOR', 'TOWER', 'ROOF', 'BASEMENT', 'LANDSCAPE_TERRAIN', 'LANDSCAPE_FACADE', 'FACILITY'])

function utf8Fatal(bytes: Uint8Array): string | null {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { return null }
}

export function packageJsonDepth(value: unknown): number {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: value && typeof value === 'object' ? 1 : 0 }]; let max = 0
  while (stack.length > 0) { const item = stack.pop()!; max = Math.max(max, item.depth); if (item.value && typeof item.value === 'object') { const values = Array.isArray(item.value) ? item.value : Object.values(item.value as Record<string, unknown>); for (const child of values) if (child && typeof child === 'object') stack.push({ value: child, depth: item.depth + 1 }) } }
  return max
}

function stringsOk(value: unknown, path = '', seen = new Set<unknown>()): string | null {
  const uriField = /^(?:\/assets\/\d+\/uri|\/topology\/uri)$/.test(path)
  if (typeof value === 'string' && value.length > (uriField ? MAX_URI : MAX_STRING)) return path || '/'
  if (!value || typeof value !== 'object' || seen.has(value)) return null
  seen.add(value)
  const entries = Array.isArray(value) ? value.entries() : Object.entries(value)
  for (const [key, child] of entries) {
    const result = stringsOk(child, `${path}/${String(key)}`, seen)
    if (result) return result
  }
  return null
}

function object(value: unknown, keys: readonly string[], _path: string): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const result = value as Record<string, unknown>
  const allowed = new Set(keys)
  if (Object.keys(result).some((key) => !allowed.has(key))) return null
  return result
}

function text(value: unknown, _path: string): string | null {
  return typeof value === 'string' && value.trim() && value.length <= MAX_STRING ? value.trim() : null
}

function uri(value: unknown, base: URL, _path: string): { original: string; canonical: string } | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URI || /[\\#\0]/u.test(value) || /%(?![0-9a-f]{2})/iu.test(value) || ENCODED_UNRESERVED.test(value)) return null
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(value) || /\s/u.test(value)) return null
  const rawPath = value.split(/[?#]/, 1)[0]!
  if (rawPath.split('/').some((part) => { try { const decoded = decodeURIComponent(part); return decoded === '..' || (decoded === '.' && part !== '.') || /[\\/\0]/u.test(decoded) } catch { return true } })) return null
  let parsed: URL
  try { parsed = new URL(value, base) } catch { return null }
  if (parsed.origin !== base.origin || parsed.username || parsed.password || parsed.hash || parsed.search) return null
  const pathname = parsed.pathname
  if (!pathname || pathname.endsWith('/') || pathname.split('/').some((part) => part === '..')) return null
  const canonical = new URL(pathname, base).toString()
  return { original: value, canonical }
}

function digest(value: unknown): { algorithm: 'SHA-256'; value: string } | null {
  const entry = object(value, ['algorithm', 'value'], '/digest')
  if (!entry || entry.algorithm !== 'SHA-256' || typeof entry.value !== 'string' || !SHA256.test(entry.value)) return null
  return Object.freeze({ algorithm: 'SHA-256', value: entry.value })
}

function floor(value: unknown, path: string): PackageFloor | null {
  const entry = object(value, ['floorName', 'building', 'level', 'floorType'], path)
  if (!entry) return null
  const floorName = text(entry.floorName, `${path}/floorName`)
  const floorType = text(entry.floorType, `${path}/floorType`)
  const building = entry.building === null ? null : text(entry.building, `${path}/building`)
  const level = entry.level === null ? null : entry.level
  if (!floorName || !floorType || !FLOOR_TYPES.has(floorType) || !Object.prototype.hasOwnProperty.call(entry, 'building') || !Object.prototype.hasOwnProperty.call(entry, 'level')) return null
  if (level !== null && (typeof level !== 'number' || !Number.isFinite(level) || !Number.isInteger(level))) return null
  if (floorType === 'LANDSCAPE_TERRAIN' || floorType === 'LANDSCAPE_FACADE') {
    if (building !== null || level !== null) return null
  } else if (!building || (level === null && floorType !== 'TOWER' && floorType !== 'ROOF')) return null
  return Object.freeze({ floorName, building, level, floorType })
}

export function parsePackageManifestV1(bytes: Uint8Array, manifestUri: string): PackageParseResult<PackageManifestDocument> {
  const context = { manifestUri }
  if (bytes.byteLength > MAX_BYTES) return failure('PACKAGE_LIMIT_EXCEEDED', 'PARSE', '/', { limit: MAX_BYTES, kind: 'manifest' }, context)
  const source = utf8Fatal(bytes)
  if (source === null) return failure('PACKAGE_JSON_INVALID', 'PARSE', '/', { reason: 'invalid-utf8' }, context)
  let raw: unknown
  try { raw = JSON.parse(source) as unknown } catch { return failure('PACKAGE_JSON_INVALID', 'PARSE', '/', { reason: 'json-parse' }, context) }
  if (packageJsonDepth(raw) > MAX_DEPTH) return failure('PACKAGE_LIMIT_EXCEEDED', 'VALIDATE', '/', { limit: MAX_DEPTH, kind: 'depth' }, context)
  const overlong = stringsOk(raw)
  if (overlong) return failure('PACKAGE_LIMIT_EXCEEDED', 'VALIDATE', overlong, { limit: /\/uri$/.test(overlong) ? MAX_URI : MAX_STRING, kind: 'string' }, context)
  const root = object(raw, ['schema', 'schemaVersion', 'packageId', 'revision', 'metadata', 'assets', 'topology'], '/')
  if (!root) return failure('PACKAGE_FIELD_INVALID', 'VALIDATE', '/', { reason: 'closed-object' }, context)
  if (root.schema !== 'space-model-package' || root.schemaVersion !== 1) return failure('PACKAGE_SCHEMA_UNSUPPORTED', 'VALIDATE', '/schema', {}, context)
  const packageId = text(root.packageId, '/packageId')
  const revision = text(root.revision, '/revision')
  if (!packageId || !revision) return failure('PACKAGE_FIELD_INVALID', 'VALIDATE', !packageId ? '/packageId' : '/revision', {}, context)
  const metadata = object(root.metadata, ['schema', 'version', 'carrier'], '/metadata')
  if (!metadata || metadata.schema !== 'space-model-metadata' || metadata.version !== '3.3-semantic' || metadata.carrier !== 'GLB_SCENE_NODE_EXTRAS') {
    return failure('PACKAGE_METADATA_UNSUPPORTED', 'VALIDATE', '/metadata', {}, context)
  }
  if (!Array.isArray(root.assets) || root.assets.length < 1 || root.assets.length > 128) return failure('PACKAGE_LIMIT_EXCEEDED', 'VALIDATE', '/assets', { limit: 128 }, context)
  let base: URL
  try { base = new URL(manifestUri) } catch { return failure('PACKAGE_URI_INVALID', 'VALIDATE', '/', {}, context) }
  if ((base.protocol !== 'http:' && base.protocol !== 'https:') || base.username || base.password || base.search || base.hash || !base.pathname.endsWith('/space-model-package.v1.json')) return failure('PACKAGE_URI_INVALID', 'VALIDATE', '/', {}, context)
  const normalizedManifestUri = base.toString()
  const ids = new Set<string>(); const uris = new Set<string>(); const floors = new Set<string>(); const assets: PackageAsset[] = []
  for (let index = 0; index < root.assets.length; index += 1) {
    const path = `/assets/${index}`
    const entry = object(root.assets[index], ['assetId', 'uri', 'digest', 'floor'], path)
    if (!entry) return failure('PACKAGE_FIELD_INVALID', 'VALIDATE', path, { reason: 'closed-object' }, context)
    const assetId = text(entry.assetId, `${path}/assetId`); const resource = uri(entry.uri, base, `${path}/uri`); const hash = digest(entry.digest); const floorInfo = floor(entry.floor, `${path}/floor`)
    if (!assetId || !resource || !resource.canonical.toLowerCase().endsWith('.glb') || !hash || !floorInfo) return failure(!resource || !resource.canonical.toLowerCase().endsWith('.glb') ? 'PACKAGE_URI_INVALID' : 'PACKAGE_FIELD_INVALID', 'VALIDATE', path, {}, context)
    if (ids.has(assetId) || uris.has(resource.canonical) || floors.has(`${floorInfo.building ?? ''}\u0000${floorInfo.floorName}`)) return failure('PACKAGE_DUPLICATE_ID', 'VALIDATE', path, {}, { ...context, assetId })
    ids.add(assetId); uris.add(resource.canonical); floors.add(`${floorInfo.building ?? ''}\u0000${floorInfo.floorName}`)
    assets.push(Object.freeze({ assetId, uri: resource.original, canonicalUri: resource.canonical, digest: hash, floor: floorInfo }))
  }
  const topology = object(root.topology, ['uri', 'digest', 'schema', 'schemaVersion', 'revision'], '/topology')
  if (!topology) return failure('PACKAGE_FIELD_INVALID', 'VALIDATE', '/topology', {}, context)
  const topologyResource = uri(topology.uri, base, '/topology/uri'); const topologyDigest = digest(topology.digest)
  if (!topologyResource || !topologyDigest || topologyResource.canonical === normalizedManifestUri) return failure('PACKAGE_URI_INVALID', 'VALIDATE', '/topology/uri', {}, context)
  if (uris.has(topologyResource.canonical)) return failure('PACKAGE_DUPLICATE_ID', 'VALIDATE', '/topology/uri', { reason: 'resource-collision' }, context)
  if (topology.schema !== 'space-ai-platform/topology-sidecar' || topology.schemaVersion !== 1) return failure('PACKAGE_SCHEMA_UNSUPPORTED', 'VALIDATE', '/topology/schema', {}, context)
  const topologyRevision = text(topology.revision, '/topology/revision')
  if (!topologyRevision || topologyRevision !== revision) return failure('PACKAGE_REVISION_MISMATCH', 'VALIDATE', '/topology/revision', {}, context)
  return { ok: true, value: Object.freeze({ schema: 'space-model-package', schemaVersion: 1, packageId, revision, metadata: Object.freeze({ schema: 'space-model-metadata', version: '3.3-semantic', carrier: 'GLB_SCENE_NODE_EXTRAS' }), assets: Object.freeze(assets), topology: Object.freeze({ uri: topologyResource.original, canonicalUri: topologyResource.canonical, digest: topologyDigest, schema: 'space-ai-platform/topology-sidecar', schemaVersion: 1, revision }), manifestUri: normalizedManifestUri }) }
}
