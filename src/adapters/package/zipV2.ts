import { crc32Bytes } from './boundedZipInflate'
import { failure } from './diagnostics'
import { parsePackageManifestV2 } from './manifestV2'
import type { PackageArchiveEntry, PackageArchiveV2, PackageParseResult } from './types'

export interface PackageZipV2Limits {
  readonly maxArchiveBytes: number
  readonly maxEntries: number
  readonly maxAssetEntries: number
  readonly maxAssetBytes: number
  readonly maxManifestBytes: number
  readonly maxAuditBytes: number
  readonly maxTotalBytes: number
}

export const DEFAULT_PACKAGE_ZIP_V2_LIMITS: PackageZipV2Limits = Object.freeze({
  maxArchiveBytes: 65 * 1024 * 1024,
  maxEntries: 130,
  maxAssetEntries: 128,
  maxAssetBytes: 32 * 1024 * 1024,
  maxManifestBytes: 1024 * 1024,
  maxAuditBytes: 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
})

interface CentralRecord {
  readonly path: string
  readonly flags: number
  readonly method: number
  readonly compressed: number
  readonly uncompressed: number
  readonly crc: number
  readonly localOffset: number
  readonly externalAttrs: number
}

const EOCD = 0x06054b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50
const UTF8 = new TextDecoder('utf-8', { fatal: true })

function u16(data: Uint8Array, at: number): number {
  return data[at]! | (data[at + 1]! << 8)
}

function u32(data: Uint8Array, at: number): number {
  return (
    data[at]! |
    (data[at + 1]! << 8) |
    (data[at + 2]! << 16) |
    (data[at + 3]! << 24)
  ) >>> 0
}

function pathKey(path: string): string {
  return path.normalize('NFC').toLocaleLowerCase('en-US')
}

function safePath(path: string): boolean {
  if (
    !path ||
    path.includes('\\') ||
    path.includes('\0') ||
    path.startsWith('/') ||
    /^[A-Za-z]:/.test(path)
  ) return false
  return path.split('/').every((part) => {
    if (!part || part === '..') return false
    try {
      const decoded = decodeURIComponent(part)
      return decoded !== '..' && decoded !== '.' && !/[\\/\0]/u.test(decoded)
    } catch {
      return false
    }
  })
}

function decodePath(bytes: Uint8Array, flags: number): string | null {
  try {
    return (flags & 0x800) ? UTF8.decode(bytes) : String.fromCharCode(...bytes)
  } catch {
    return null
  }
}

function hasZip64Extra(data: Uint8Array, at: number, length: number): boolean {
  const end = at + length
  while (at < end) {
    if (at + 4 > end) return true
    const id = u16(data, at)
    const size = u16(data, at + 2)
    at += 4
    if (at + size > end || id === 0x0001) return true
    at += size
  }
  return at !== end
}

function archiveFailure(
  code:
    | 'PACKAGE_JSON_INVALID'
    | 'PACKAGE_LIMIT_EXCEEDED'
    | 'PACKAGE_RESOURCE_NOT_FOUND'
    | 'PACKAGE_URI_INVALID'
    | 'PACKAGE_FIELD_INVALID'
    | 'PACKAGE_DUPLICATE_ID'
    | 'PACKAGE_TOPOLOGY_RESOURCE_FORBIDDEN',
  path: string,
  details: Record<string, string | number | boolean | null> = {},
  manifestUri?: string,
) {
  return failure(code, 'ARCHIVE', path, details, { manifestUri })
}

function verifyLocal(data: Uint8Array, record: CentralRecord, centralOffset: number): boolean {
  const at = record.localOffset
  if (at + 30 > centralOffset || u32(data, at) !== LOCAL) return false
  const versionNeeded = u16(data, at + 4)
  const flags = u16(data, at + 6)
  const method = u16(data, at + 8)
  const compressed = u32(data, at + 18)
  const uncompressed = u32(data, at + 22)
  const nameLength = u16(data, at + 26)
  const extraLength = u16(data, at + 28)
  const nameAt = at + 30
  const extraAt = nameAt + nameLength
  const payloadEnd = extraAt + extraLength + compressed
  if (
    versionNeeded >= 45 ||
    flags !== record.flags ||
    method !== 0 ||
    method !== record.method ||
    compressed !== record.compressed ||
    uncompressed !== record.uncompressed ||
    u32(data, at + 14) !== record.crc ||
    payloadEnd > centralOffset ||
    hasZip64Extra(data, extraAt, extraLength)
  ) return false
  const localName = decodePath(data.subarray(nameAt, nameAt + nameLength), flags)
  return localName === record.path
}

function centralRecords(
  data: Uint8Array,
  limits: PackageZipV2Limits,
  manifestUri: string,
): PackageParseResult<CentralRecord[]> {
  const start = Math.max(0, data.byteLength - 22 - 0xffff)
  let eocd = -1
  for (let index = data.byteLength - 22; index >= start; index -= 1) {
    if (u32(data, index) === EOCD) {
      eocd = index
      break
    }
  }
  if (eocd < 0 || eocd + 22 > data.byteLength) {
    return archiveFailure('PACKAGE_JSON_INVALID', '/', { reason: 'zip-eocd' }, manifestUri)
  }
  const disk = u16(data, eocd + 4)
  const centralDisk = u16(data, eocd + 6)
  const countDisk = u16(data, eocd + 8)
  const count = u16(data, eocd + 10)
  const size = u32(data, eocd + 12)
  const offset = u32(data, eocd + 16)
  const commentLength = u16(data, eocd + 20)
  if (
    disk !== 0 ||
    centralDisk !== 0 ||
    countDisk !== count ||
    count === 0xffff ||
    size === 0xffffffff ||
    offset === 0xffffffff
  ) return archiveFailure('PACKAGE_FIELD_INVALID', '/', { reason: 'zip64-or-multidisk' }, manifestUri)
  if (
    count > limits.maxEntries ||
    offset + size > data.byteLength ||
    eocd !== offset + size ||
    eocd + 22 + commentLength !== data.byteLength
  ) return archiveFailure('PACKAGE_LIMIT_EXCEEDED', '/', { kind: 'entries', limit: limits.maxEntries }, manifestUri)

  const result: CentralRecord[] = []
  const keys = new Set<string>()
  let at = offset
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > data.byteLength || u32(data, at) !== CENTRAL) {
      return archiveFailure('PACKAGE_JSON_INVALID', '/', { reason: 'central-directory' }, manifestUri)
    }
    const versionNeeded = u16(data, at + 6)
    const flags = u16(data, at + 8)
    const method = u16(data, at + 10)
    const crc = u32(data, at + 16)
    const compressed = u32(data, at + 20)
    const uncompressed = u32(data, at + 24)
    const nameLength = u16(data, at + 28)
    const extraLength = u16(data, at + 30)
    const entryCommentLength = u16(data, at + 32)
    const diskStart = u16(data, at + 34)
    const externalAttrs = u32(data, at + 38)
    const localOffset = u32(data, at + 42)
    const nameAt = at + 46
    const extraAt = nameAt + nameLength
    const recordEnd = extraAt + extraLength + entryCommentLength
    if (recordEnd > eocd) {
      return archiveFailure('PACKAGE_JSON_INVALID', '/', { reason: 'central-directory' }, manifestUri)
    }
    const rawName = data.subarray(nameAt, nameAt + nameLength)
    const name = decodePath(rawName, flags)
    if (
      !name ||
      (!(flags & 0x800) && rawName.some((byte) => byte > 0x7f)) ||
      !safePath(name)
    ) return archiveFailure('PACKAGE_FIELD_INVALID', '/', { reason: 'unsafe-entry-path' }, manifestUri)
    const key = pathKey(name)
    if (keys.has(key)) {
      return archiveFailure('PACKAGE_FIELD_INVALID', '/', { reason: 'duplicate-entry-path' }, manifestUri)
    }
    keys.add(key)
    if (
      versionNeeded >= 45 ||
      diskStart !== 0 ||
      localOffset === 0xffffffff ||
      compressed === 0xffffffff ||
      uncompressed === 0xffffffff ||
      hasZip64Extra(data, extraAt, extraLength)
    ) return archiveFailure('PACKAGE_FIELD_INVALID', '/', { reason: 'zip64-or-multidisk' }, manifestUri)
    if (
      (flags & 1) !== 0 ||
      (flags & 0x8) !== 0 ||
      (flags & ~0x800) !== 0 ||
      method !== 0 ||
      compressed !== uncompressed
    ) return archiveFailure('PACKAGE_FIELD_INVALID', `/${name}`, {
      reason: (flags & 1) !== 0
        ? 'encrypted'
        : (flags & 0x8) !== 0
          ? 'data-descriptor'
          : method !== 0
            ? 'store-only'
            : 'unknown-flags',
    }, manifestUri)
    if (name.endsWith('/') || (externalAttrs >>> 16 & 0xf000) === 0xa000 || (externalAttrs & 0x10) !== 0) {
      return archiveFailure('PACKAGE_FIELD_INVALID', `/${name}`, { reason: 'directory-or-symlink-entry' }, manifestUri)
    }
    result.push({ path: name, flags, method, compressed, uncompressed, crc, localOffset, externalAttrs })
    at = recordEnd
  }
  if (at !== eocd) {
    return archiveFailure('PACKAGE_JSON_INVALID', '/', { reason: 'central-directory-end' }, manifestUri)
  }
  const ranges: Array<readonly [number, number]> = []
  for (const record of result) {
    if (!verifyLocal(data, record, offset)) {
      return archiveFailure('PACKAGE_JSON_INVALID', '/', { reason: 'local-central-mismatch' }, manifestUri)
    }
    const nameLength = u16(data, record.localOffset + 26)
    const extraLength = u16(data, record.localOffset + 28)
    ranges.push([
      record.localOffset,
      record.localOffset + 30 + nameLength + extraLength + record.compressed,
    ])
  }
  ranges.sort((left, right) => left[0] - right[0])
  if (ranges.some((range, index) => index > 0 && range[0] < ranges[index - 1]![1])) {
    return archiveFailure('PACKAGE_JSON_INVALID', '/', { reason: 'local-header-range' }, manifestUri)
  }
  const total = result.reduce((sum, record) => sum + record.uncompressed, 0)
  if (total > limits.maxTotalBytes) {
    return archiveFailure('PACKAGE_LIMIT_EXCEEDED', '/', { kind: 'total', limit: limits.maxTotalBytes }, manifestUri)
  }
  return { ok: true, value: result }
}

function payloadOffset(data: Uint8Array, record: CentralRecord): number {
  return record.localOffset + 30 + u16(data, record.localOffset + 26) + u16(data, record.localOffset + 28)
}

function extractStoredEntry(data: Uint8Array, record: CentralRecord, retain: boolean): Uint8Array | null {
  const start = payloadOffset(data, record)
  const bytes = data.subarray(start, start + record.uncompressed)
  if (bytes.byteLength !== record.uncompressed || crc32Bytes(bytes) !== record.crc) return null
  return retain ? bytes.slice() : new Uint8Array(0)
}

function archiveEntryPath(originalUri: string): string | null {
  const raw = originalUri.replace(/^\//, '')
  const decoded: string[] = []
  try {
    for (const part of raw.split('/')) {
      const value = decodeURIComponent(part)
      if (value === '..' || (value === '.' && part !== '.') || /[\\/\0]/u.test(value)) return null
      if (value !== '.') decoded.push(value)
    }
  } catch {
    return null
  }
  let path = decoded.join('/')
  while (path.startsWith('./')) path = path.slice(2)
  return safePath(path) ? path : null
}

function canonicalEntryPath(canonicalUri: string, manifestUri: string): string | null {
  try {
    const resource = new URL(canonicalUri)
    const manifest = new URL(manifestUri)
    const prefix = manifest.pathname.slice(0, manifest.pathname.lastIndexOf('/') + 1)
    if (resource.origin !== manifest.origin || resource.search || resource.hash) return null
    const relative = resource.pathname.startsWith(prefix)
      ? resource.pathname.slice(prefix.length)
      : resource.pathname.slice(1)
    return archiveEntryPath(relative)
  } catch {
    return null
  }
}

function topologyLikeEntry(path: string): boolean {
  const lower = path.normalize('NFC').toLocaleLowerCase('en-US')
  return lower.includes('topology') || lower.endsWith('.sidecar')
}

export function parsePackageZipV2(
  data: Uint8Array,
  manifestUri: string,
  customLimits: Partial<PackageZipV2Limits> = {},
): PackageParseResult<PackageArchiveV2> {
  if (data.byteLength > DEFAULT_PACKAGE_ZIP_V2_LIMITS.maxArchiveBytes) {
    return archiveFailure('PACKAGE_LIMIT_EXCEEDED', '/', {
      kind: 'archive',
      limit: DEFAULT_PACKAGE_ZIP_V2_LIMITS.maxArchiveBytes,
    }, manifestUri)
  }
  const limits = { ...DEFAULT_PACKAGE_ZIP_V2_LIMITS, ...customLimits }
  if (Object.entries(customLimits).some(([key, value]) => (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value <= 0 ||
    value > DEFAULT_PACKAGE_ZIP_V2_LIMITS[key as keyof PackageZipV2Limits]
  ))) return archiveFailure('PACKAGE_LIMIT_EXCEEDED', '/', { kind: 'custom-limits' }, manifestUri)
  if (data.byteLength > limits.maxArchiveBytes) {
    return archiveFailure('PACKAGE_LIMIT_EXCEEDED', '/', { kind: 'archive', limit: limits.maxArchiveBytes }, manifestUri)
  }
  const parsedRecords = centralRecords(data, limits, manifestUri)
  if (!parsedRecords.ok) return parsedRecords
  const manifestRecord = parsedRecords.value.find((record) => record.path === 'space-model-package.v2.json')
  if (!manifestRecord) {
    return archiveFailure('PACKAGE_RESOURCE_NOT_FOUND', '/space-model-package.v2.json', {}, manifestUri)
  }
  if (manifestRecord.uncompressed > limits.maxManifestBytes) {
    return archiveFailure('PACKAGE_LIMIT_EXCEEDED', '/space-model-package.v2.json', {
      limit: limits.maxManifestBytes,
    }, manifestUri)
  }
  const manifestBytes = extractStoredEntry(data, manifestRecord, true)
  if (!manifestBytes) {
    return archiveFailure('PACKAGE_JSON_INVALID', '/space-model-package.v2.json', { reason: 'entry-integrity' }, manifestUri)
  }
  const manifest = parsePackageManifestV2(manifestBytes, manifestUri)
  if (!manifest.ok) return manifest
  if (manifest.value.assets.length > limits.maxAssetEntries) {
    return archiveFailure('PACKAGE_LIMIT_EXCEEDED', '/assets', { limit: limits.maxAssetEntries }, manifestUri)
  }

  const assetPaths: string[] = []
  const assetPathKeys = new Set<string>()
  for (let index = 0; index < manifest.value.assets.length; index += 1) {
    const path = canonicalEntryPath(manifest.value.assets[index]!.canonicalUri, manifestUri)
    if (!path) {
      return archiveFailure('PACKAGE_URI_INVALID', `/assets/${index}/uri`, { reason: 'asset-entry-path' }, manifestUri)
    }
    const key = pathKey(path)
    if (assetPathKeys.has(key)) {
      return archiveFailure('PACKAGE_DUPLICATE_ID', `/assets/${index}/uri`, { reason: 'archive-entry-collision' }, manifestUri)
    }
    assetPathKeys.add(key)
    assetPaths.push(path)
  }

  const allowed = new Set([
    'space-model-package.v2.json',
    'producer-validation.json',
    ...assetPaths,
  ])
  const unknown = parsedRecords.value.find((record) => !allowed.has(record.path))
  if (unknown) {
    return archiveFailure(
      topologyLikeEntry(unknown.path) ? 'PACKAGE_TOPOLOGY_RESOURCE_FORBIDDEN' : 'PACKAGE_FIELD_INVALID',
      `/${unknown.path}`,
      { reason: topologyLikeEntry(unknown.path) ? 'topology-entry' : 'unknown-entry' },
      manifestUri,
    )
  }
  const auditRecord = parsedRecords.value.find((record) => record.path === 'producer-validation.json')
  if (auditRecord && auditRecord.uncompressed > limits.maxAuditBytes) {
    return archiveFailure('PACKAGE_LIMIT_EXCEEDED', '/producer-validation.json', { limit: limits.maxAuditBytes }, manifestUri)
  }
  const recordsByPath = new Map(parsedRecords.value.map((record) => [record.path, record]))
  const assets: PackageArchiveEntry[] = []
  for (let index = 0; index < assetPaths.length; index += 1) {
    const path = assetPaths[index]!
    const record = recordsByPath.get(path)
    if (!record) {
      return archiveFailure('PACKAGE_RESOURCE_NOT_FOUND', `/assets/${index}`, { kind: 'asset' }, manifestUri)
    }
    if (record.uncompressed > limits.maxAssetBytes) {
      return archiveFailure('PACKAGE_LIMIT_EXCEEDED', `/assets/${index}`, { limit: limits.maxAssetBytes }, manifestUri)
    }
    const bytes = extractStoredEntry(data, record, true)
    if (!bytes) {
      return archiveFailure('PACKAGE_JSON_INVALID', `/${path}`, { reason: 'entry-integrity' }, manifestUri)
    }
    assets.push(Object.freeze({
      path,
      bytes,
      compressedSize: record.compressed,
      uncompressedSize: record.uncompressed,
      method: 0 as const,
    }))
  }
  if (auditRecord && !extractStoredEntry(data, auditRecord, false)) {
    return archiveFailure('PACKAGE_JSON_INVALID', '/producer-validation.json', { reason: 'entry-integrity' }, manifestUri)
  }
  return {
    ok: true,
    value: Object.freeze({
      manifest: Object.freeze({
        path: manifestRecord.path,
        bytes: manifestBytes,
        compressedSize: manifestRecord.compressed,
        uncompressedSize: manifestRecord.uncompressed,
        method: 0 as const,
      }),
      assets: Object.freeze(assets),
      manifestDocument: manifest.value,
    }),
  }
}
