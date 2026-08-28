import {
  BoundedZipEntryError,
  crc32Bytes,
  extractBoundedZipEntry,
  type BoundedZipOutputBudget,
} from './boundedZipInflate'
import { failure } from './diagnostics'
import { parsePackageManifestV1 } from './manifestV1'
import type { PackageArchive, PackageArchiveEntry, PackageParseResult } from './types'

export interface PackageZipLimits {
  readonly maxArchiveBytes: number
  readonly maxEntries: number
  readonly maxEntryBytes: number
  readonly maxTotalBytes: number
  readonly maxCompressionRatio: number
}

export const DEFAULT_PACKAGE_ZIP_LIMITS: PackageZipLimits = Object.freeze({
  maxArchiveBytes: 1024 * 1024 * 1024,
  maxEntries: 256,
  maxEntryBytes: 512 * 1024 * 1024,
  maxTotalBytes: 1024 * 1024 * 1024,
  maxCompressionRatio: 200,
})

interface CentralRecord { path: string; flags: number; method: number; compressed: number; uncompressed: number; crc: number; localOffset: number; externalAttrs: number }
const EOCD = 0x06054b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50
const UTF8 = new TextDecoder('utf-8', { fatal: true })

function u16(data: Uint8Array, at: number): number { return data[at]! | (data[at + 1]! << 8) }
function u32(data: Uint8Array, at: number): number { return (data[at]! | (data[at + 1]! << 8) | (data[at + 2]! << 16) | (data[at + 3]! << 24)) >>> 0 }
function crc32(bytes: Uint8Array): number { return crc32Bytes(bytes) }
function pathKey(path: string): string { return path.normalize('NFC').toLocaleLowerCase('en-US') }
function safePath(path: string): boolean {
  if (!Boolean(path) || path.includes('\\') || path.includes('\0') || path.startsWith('/') || /^[A-Za-z]:/.test(path)) return false
  return path.split('/').every((part) => { if (!part || part === '..') return false; try { const decoded = decodeURIComponent(part); return decoded !== '..' && decoded !== '.' && !/[\\/\0]/u.test(decoded) } catch { return false } })
}
function decodePath(bytes: Uint8Array, flags: number): string | null {
  try { return (flags & 0x800) ? UTF8.decode(bytes) : String.fromCharCode(...bytes) } catch { return null }
}
function failureArchive(code: 'PACKAGE_JSON_INVALID' | 'PACKAGE_LIMIT_EXCEEDED' | 'PACKAGE_RESOURCE_NOT_FOUND' | 'PACKAGE_URI_INVALID' | 'PACKAGE_FIELD_INVALID', path: string, details: Record<string, string | number | boolean | null> = {}, manifestUri?: string) {
  return failure(code, 'ARCHIVE', path, details, { manifestUri })
}

function records(data: Uint8Array, limits: PackageZipLimits, manifestUri: string): PackageParseResult<CentralRecord[]> {
  const start = Math.max(0, data.byteLength - 22 - 0xffff); let eocd = -1
  for (let i = data.byteLength - 22; i >= start; i -= 1) if (u32(data, i) === EOCD) { eocd = i; break }
  if (eocd < 0 || eocd + 22 > data.byteLength) return failureArchive('PACKAGE_JSON_INVALID', '/', { reason: 'zip-eocd' }, manifestUri)
  const disk = u16(data, eocd + 4); const centralDisk = u16(data, eocd + 6); const countDisk = u16(data, eocd + 8); const count = u16(data, eocd + 10); const size = u32(data, eocd + 12); const offset = u32(data, eocd + 16); const commentLength = u16(data, eocd + 20)
  if (disk !== 0 || centralDisk !== 0 || countDisk !== count || count === 0xffff || size === 0xffffffff || offset === 0xffffffff) return failureArchive('PACKAGE_FIELD_INVALID', '/', { reason: 'zip64-or-multidisk' }, manifestUri)
  if (count > limits.maxEntries || offset + size > data.byteLength || eocd !== offset + size || eocd + 22 + commentLength !== data.byteLength) return failureArchive('PACKAGE_LIMIT_EXCEEDED', '/', { kind: 'entries', limit: limits.maxEntries }, manifestUri)
  const result: CentralRecord[] = []; const keys = new Set<string>(); let at = offset
  for (let i = 0; i < count; i += 1) {
    if (at + 46 > data.byteLength || u32(data, at) !== CENTRAL) return failureArchive('PACKAGE_JSON_INVALID', '/', { reason: 'central-directory' }, manifestUri)
    const flags = u16(data, at + 8); const method = u16(data, at + 10); const crc = u32(data, at + 16); const compressed = u32(data, at + 20); const uncompressed = u32(data, at + 24); const nameLength = u16(data, at + 28); const extraLength = u16(data, at + 30); const commentLength = u16(data, at + 32); const diskStart = u16(data, at + 34); const localOffset = u32(data, at + 42)
    const rawName = data.subarray(at + 46, at + 46 + nameLength); const name = decodePath(rawName, flags); if (!name || (!(flags & 0x800) && rawName.some((byte) => byte > 0x7f)) || !safePath(name)) return failureArchive('PACKAGE_FIELD_INVALID', '/', { reason: 'unsafe-entry-path' }, manifestUri)
    const key = pathKey(name); if (keys.has(key)) return failureArchive('PACKAGE_FIELD_INVALID', '/', { reason: 'duplicate-entry-path' }, manifestUri); keys.add(key)
    const flagsMask = method === 0 ? 0x800 : 0x806; if (diskStart !== 0 || (flags & 1) !== 0 || (flags & 0x8) !== 0 || (flags & ~flagsMask) !== 0 || (method !== 0 && method !== 8)) return failureArchive('PACKAGE_FIELD_INVALID', '/', { reason: (flags & 1) !== 0 ? 'encrypted' : (flags & 0x8) !== 0 ? 'data-descriptor' : 'unknown-flags' }, manifestUri)
    if (compressed === 0 && uncompressed !== 0 || uncompressed === 0xffffffff || compressed === 0xffffffff || localOffset === 0xffffffff || uncompressed > limits.maxEntryBytes || (compressed > 0 && uncompressed / compressed > limits.maxCompressionRatio)) return failureArchive('PACKAGE_LIMIT_EXCEEDED', '/', { reason: 'entry-budget' }, manifestUri)
    if (name.endsWith('/') || (u16(data, at + 38) & 0x10)) return failureArchive('PACKAGE_FIELD_INVALID', '/', { reason: 'directory-entry' }, manifestUri)
    if (name === 'space-model-package.v1.json' && uncompressed > 1024 * 1024) return failureArchive('PACKAGE_LIMIT_EXCEEDED', '/space-model-package.v1.json', { limit: 1024 * 1024 }, manifestUri)
    if (name === 'producer-validation.json' && uncompressed > 1024 * 1024) return failureArchive('PACKAGE_LIMIT_EXCEEDED', '/producer-validation.json', { limit: 1024 * 1024 }, manifestUri)
    if ((u32(data, at + 38) >>> 16 & 0xffff) >= 0xa000) return failureArchive('PACKAGE_FIELD_INVALID', '/', { reason: 'symlink-entry' }, manifestUri)
    result.push({ path: name, flags, method, compressed, uncompressed, crc, localOffset, externalAttrs: u32(data, at + 38) })
    at += 46 + nameLength + extraLength + commentLength
  }
  const ranges = result.map((entry) => { const local = entry.localOffset; if (local + 30 > offset || u32(data, local) !== LOCAL) return null; const nameLength = u16(data, local + 26); const extraLength = u16(data, local + 28); const payloadEnd = local + 30 + nameLength + extraLength + entry.compressed; const descriptor = entry.flags & 0x8 && u32(data, payloadEnd) === 0x08074b50 ? 16 : 0; return [local, payloadEnd + descriptor] as const }); const ordered = ranges.filter((range): range is readonly [number, number] => Boolean(range)).sort((a, b) => a[0] - b[0]); if (ranges.some((range) => !range || range[1] > offset) || ordered.some((range, index) => index > 0 && range[0] < ordered[index - 1]![1])) return failureArchive('PACKAGE_JSON_INVALID', '/', { reason: 'local-header-range' }, manifestUri); for (const entry of result) if (!verifyLocal(data, entry)) return failureArchive('PACKAGE_JSON_INVALID', '/', { reason: 'local-central-mismatch' }, manifestUri)
  if (at !== eocd) return failureArchive('PACKAGE_JSON_INVALID', '/', { reason: 'central-directory-end' }, manifestUri)
  const total = result.reduce((sum, entry) => sum + entry.uncompressed, 0); if (total > limits.maxTotalBytes) return failureArchive('PACKAGE_LIMIT_EXCEEDED', '/', { kind: 'total', limit: limits.maxTotalBytes }, manifestUri)
  return { ok: true, value: result }
}

function verifyLocal(data: Uint8Array, record: CentralRecord): boolean {
  const at = record.localOffset
  if (at + 30 > data.byteLength || u32(data, at) !== LOCAL) return false
  const flags = u16(data, at + 6); const method = u16(data, at + 8); const compressed = u32(data, at + 18); const uncompressed = u32(data, at + 22); const nameLength = u16(data, at + 26); const extraLength = u16(data, at + 28); const localName = decodePath(data.subarray(at + 30, at + 30 + nameLength), flags)
  const payloadEnd = at + 30 + nameLength + extraLength + compressed; if (flags & 0x8 || u32(data, at + 14) !== record.crc) return false
  return flags === record.flags && method === record.method && compressed === record.compressed && uncompressed === record.uncompressed && localName === record.path && payloadEnd <= data.byteLength
}

function payloadOffset(data: Uint8Array, record: CentralRecord): number | null {
  const at = record.localOffset
  if (!verifyLocal(data, record)) return null
  return at + 30 + u16(data, at + 26) + u16(data, at + 28)
}

function extractEntry(
  data: Uint8Array,
  record: CentralRecord,
  budget: BoundedZipOutputBudget,
  retainBytes: boolean,
): Uint8Array {
  const offset = payloadOffset(data, record)
  if (offset === null) throw new BoundedZipEntryError('integrity', 'local-central-mismatch')
  return extractBoundedZipEntry(data, {
    method: record.method as 0 | 8,
    compressedSize: record.compressed,
    declaredSize: record.uncompressed,
    expectedCrc: record.crc,
    payloadOffset: offset,
  }, budget, retainBytes)
}

function referencedEntry(canonicalUri: string, manifestUri: string, entries: Map<string, PackageArchiveEntry>): PackageArchiveEntry | null {
  const path = canonicalEntryPath(canonicalUri, manifestUri)
  if (!path) return null
  return entries.get(path) ?? null
}
function archiveEntryPath(originalUri: string): string | null {
  const raw = originalUri.replace(/^\//, ''); const parts = raw.split('/'); const decoded: string[] = []
  try { for (const part of parts) { const value = decodeURIComponent(part); if (value === '..' || (value === '.' && part !== '.') || /[\\/\0]/u.test(value)) return null; if (value !== '.') decoded.push(value) } } catch { return null }
  let path = decoded.join('/'); while (path.startsWith('./')) path = path.slice(2)
  if (!safePath(path)) return null
  return path
}
function canonicalEntryPath(canonicalUri: string, manifestUri: string): string | null {
  try {
    const resource = new URL(canonicalUri); const manifest = new URL(manifestUri); const prefix = manifest.pathname.slice(0, manifest.pathname.lastIndexOf('/') + 1)
    if (resource.origin !== manifest.origin || resource.search || resource.hash) return null
    const relative = resource.pathname.startsWith(prefix)
      ? resource.pathname.slice(prefix.length)
      : resource.pathname.slice(1)
    return archiveEntryPath(relative)
  } catch { return null }
}

export function parsePackageZipV1(data: Uint8Array, manifestUri: string, customLimits: Partial<PackageZipLimits> = {}): PackageParseResult<PackageArchive> {
  if (data.byteLength > DEFAULT_PACKAGE_ZIP_LIMITS.maxArchiveBytes) return failureArchive('PACKAGE_LIMIT_EXCEEDED', '/', { kind: 'archive', limit: DEFAULT_PACKAGE_ZIP_LIMITS.maxArchiveBytes }, manifestUri)
  const limits = { ...DEFAULT_PACKAGE_ZIP_LIMITS, ...customLimits }
  if (Object.entries(customLimits).some(([key, value]) => typeof value !== 'number' || !Number.isFinite(value) || (key !== 'maxCompressionRatio' && !Number.isInteger(value)) || value <= 0 || value > DEFAULT_PACKAGE_ZIP_LIMITS[key as keyof PackageZipLimits])) return failureArchive('PACKAGE_LIMIT_EXCEEDED', '/', { kind: 'custom-limits' }, manifestUri)
  if (data.byteLength > limits.maxArchiveBytes) return failureArchive('PACKAGE_LIMIT_EXCEEDED', '/', { kind: 'archive', limit: limits.maxArchiveBytes }, manifestUri)
  const parsedRecords = records(data, limits, manifestUri); if (!parsedRecords.ok) return parsedRecords
  const manifestRecord = parsedRecords.value.find((entry) => entry.path === 'space-model-package.v1.json')
  if (!manifestRecord) return failureArchive('PACKAGE_RESOURCE_NOT_FOUND', '/space-model-package.v1.json', {}, manifestUri)
  const outputBudget: BoundedZipOutputBudget = {
    maxEntryBytes: limits.maxEntryBytes,
    maxTotalBytes: limits.maxTotalBytes,
    maxCompressionRatio: limits.maxCompressionRatio,
    totalOutputBytes: 0,
  }
  let manifestBytes: Uint8Array
  try {
    manifestBytes = extractEntry(data, manifestRecord, outputBudget, true)
  } catch (error) {
    const bounded = error instanceof BoundedZipEntryError ? error : null
    return failureArchive(
      bounded?.kind === 'limit' ? 'PACKAGE_LIMIT_EXCEEDED' : 'PACKAGE_JSON_INVALID',
      '/space-model-package.v1.json',
      { reason: bounded?.reason ?? 'entry-integrity' },
      manifestUri,
    )
  }
  const manifest = parsePackageManifestV1(manifestBytes, manifestUri); if (!manifest.ok) return manifest
  const topologyPath = canonicalEntryPath(manifest.value.topology.canonicalUri, manifestUri); if (!topologyPath) return failureArchive('PACKAGE_URI_INVALID', '/topology/uri', { reason: 'topology-entry-path' }, manifestUri)
  const topologyRecord = parsedRecords.value.find((record) => record.path === topologyPath); if (!topologyRecord) return failureArchive('PACKAGE_RESOURCE_NOT_FOUND', '/topology', { kind: 'topology' }, manifestUri); if (topologyRecord.uncompressed > 8 * 1024 * 1024) return failureArchive('PACKAGE_LIMIT_EXCEEDED', '/topology', { limit: 8 * 1024 * 1024 }, manifestUri)
  if (manifest.value.assets.some((asset) => !canonicalEntryPath(asset.canonicalUri, manifestUri))) return failureArchive('PACKAGE_URI_INVALID', '/assets/uri', { reason: 'asset-entry-path' }, manifestUri)
  const allowed = new Set(['space-model-package.v1.json', 'producer-validation.json', ...manifest.value.assets.map((asset) => canonicalEntryPath(asset.canonicalUri, manifestUri)).filter((path): path is string => Boolean(path)), topologyPath])
  if (parsedRecords.value.some((record) => !allowed.has(record.path))) return failureArchive('PACKAGE_FIELD_INVALID', '/', { reason: 'unknown-entry' }, manifestUri)
  const wanted = new Set([manifestRecord.path, ...manifest.value.assets.map((asset) => canonicalEntryPath(asset.canonicalUri, manifestUri)).filter((path): path is string => Boolean(path)), topologyPath].filter((path): path is string => Boolean(path)))
  const entries = new Map<string, PackageArchiveEntry>()
  entries.set(manifestRecord.path, { path: manifestRecord.path, bytes: manifestBytes, compressedSize: manifestRecord.compressed, uncompressedSize: manifestRecord.uncompressed, method: manifestRecord.method as 0 | 8 })
  for (const record of parsedRecords.value) {
    if (record === manifestRecord) continue
    const retainBytes = wanted.has(record.path)
    try {
      const bytes = extractEntry(data, record, outputBudget, retainBytes)
      if (retainBytes) entries.set(record.path, { path: record.path, bytes, compressedSize: record.compressed, uncompressedSize: record.uncompressed, method: record.method as 0 | 8 })
    } catch (error) {
      const bounded = error instanceof BoundedZipEntryError ? error : null
      return failureArchive(
        bounded?.kind === 'limit' ? 'PACKAGE_LIMIT_EXCEEDED' : 'PACKAGE_JSON_INVALID',
        `/${record.path}`,
        { reason: bounded?.reason ?? 'entry-integrity' },
        manifestUri,
      )
    }
  }
  const assets: PackageArchiveEntry[] = []
  for (const asset of manifest.value.assets) { const entry = referencedEntry(asset.canonicalUri, manifestUri, entries); if (!entry) return failureArchive('PACKAGE_RESOURCE_NOT_FOUND', '/assets', { kind: 'asset' }, manifestUri); assets.push(entry) }
  const topology = referencedEntry(manifest.value.topology.canonicalUri, manifestUri, entries); if (!topology) return failureArchive('PACKAGE_RESOURCE_NOT_FOUND', '/topology', { kind: 'topology' }, manifestUri)
  return { ok: true, value: { manifest: { path: manifestRecord.path, bytes: manifestBytes, compressedSize: manifestRecord.compressed, uncompressedSize: manifestRecord.uncompressed, method: manifestRecord.method as 0 | 8 }, assets, topology, manifestDocument: manifest.value } }
}

export { crc32 }
