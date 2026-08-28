import { Inflate } from 'fflate'

const DEFLATE_INPUT_CHUNK_BYTES = 64
const STORED_OUTPUT_CHUNK_BYTES = 64 * 1024
const INITIAL_OUTPUT_BYTES = 64 * 1024

const CRC_TABLE = new Uint32Array(256)
for (let index = 0; index < CRC_TABLE.length; index += 1) {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
  }
  CRC_TABLE[index] = value >>> 0
}

export interface BoundedZipEntryDescriptor {
  readonly method: 0 | 8
  readonly compressedSize: number
  readonly declaredSize: number
  readonly expectedCrc: number
  readonly payloadOffset: number
}

export interface BoundedZipOutputBudget {
  readonly maxEntryBytes: number
  readonly maxTotalBytes: number
  readonly maxCompressionRatio: number
  totalOutputBytes: number
}

export class BoundedZipEntryError extends Error {
  readonly kind: 'limit' | 'integrity'
  readonly reason: string

  constructor(kind: 'limit' | 'integrity', reason: string) {
    super(reason)
    this.name = 'BoundedZipEntryError'
    this.kind = kind
    this.reason = reason
  }
}

function updateCrc32(crc: number, bytes: Uint8Array): number {
  let next = crc
  for (const value of bytes) {
    next = (next >>> 8) ^ CRC_TABLE[(next ^ value) & 0xff]!
  }
  return next >>> 0
}

export function crc32Bytes(bytes: Uint8Array): number {
  return (updateCrc32(0xffffffff, bytes) ^ 0xffffffff) >>> 0
}

/**
 * Inflates one already central/local-validated ZIP entry without allocating an
 * output buffer from its declared uncompressed size. Raw DEFLATE input is fed
 * in 64-byte slices: fflate can therefore only finish the current bounded
 * DEFLATE/stored block before this callback rejects an output budget breach.
 * Throwing here synchronously aborts Inflate.push and no further input is fed.
 */
export function extractBoundedZipEntry(
  archive: Uint8Array,
  entry: BoundedZipEntryDescriptor,
  budget: BoundedZipOutputBudget,
  retainBytes: boolean,
): Uint8Array {
  const payloadEnd = entry.payloadOffset + entry.compressedSize
  if (entry.payloadOffset < 0 || payloadEnd > archive.byteLength) {
    throw new BoundedZipEntryError('integrity', 'compressed-payload-range')
  }

  let outputBytes = 0
  let crc = 0xffffffff
  let finished = entry.method === 0
  let output = retainBytes
    ? new Uint8Array(Math.min(entry.declaredSize, INITIAL_OUTPUT_BYTES))
    : null

  const ensureOutputCapacity = (required: number): void => {
    if (output === null || required <= output.byteLength) return
    const doubled = Math.max(INITIAL_OUTPUT_BYTES, output.byteLength * 2)
    const capacity = Math.min(entry.declaredSize, Math.max(required, doubled))
    const replacement = new Uint8Array(capacity)
    replacement.set(output.subarray(0, outputBytes))
    output = replacement
  }

  const accept = (chunk: Uint8Array): void => {
    if (chunk.byteLength === 0) return
    const nextEntryBytes = outputBytes + chunk.byteLength
    const nextTotalBytes = budget.totalOutputBytes + chunk.byteLength
    if (nextEntryBytes > budget.maxEntryBytes) {
      throw new BoundedZipEntryError('limit', 'actual-entry-size')
    }
    if (nextTotalBytes > budget.maxTotalBytes) {
      throw new BoundedZipEntryError('limit', 'actual-total-size')
    }
    if (
      entry.compressedSize === 0
        ? nextEntryBytes > 0
        : nextEntryBytes > entry.compressedSize * budget.maxCompressionRatio
    ) {
      throw new BoundedZipEntryError('limit', 'actual-compression-ratio')
    }
    if (nextEntryBytes > entry.declaredSize) {
      throw new BoundedZipEntryError('limit', 'actual-size-exceeds-declaration')
    }

    ensureOutputCapacity(nextEntryBytes)
    output?.set(chunk, outputBytes)
    crc = updateCrc32(crc, chunk)
    outputBytes = nextEntryBytes
    budget.totalOutputBytes = nextTotalBytes
  }

  try {
    if (entry.method === 0) {
      for (let offset = entry.payloadOffset; offset < payloadEnd; offset += STORED_OUTPUT_CHUNK_BYTES) {
        accept(archive.subarray(offset, Math.min(offset + STORED_OUTPUT_CHUNK_BYTES, payloadEnd)))
      }
    } else {
      const inflate = new Inflate((chunk, final) => {
        accept(chunk)
        if (final) finished = true
      })
      for (let offset = entry.payloadOffset; offset < payloadEnd; offset += DEFLATE_INPUT_CHUNK_BYTES) {
        const end = Math.min(offset + DEFLATE_INPUT_CHUNK_BYTES, payloadEnd)
        inflate.push(archive.subarray(offset, end), end === payloadEnd)
      }
    }
  } catch (error) {
    if (error instanceof BoundedZipEntryError) throw error
    throw new BoundedZipEntryError('integrity', 'deflate-decode')
  }

  const actualCrc = (crc ^ 0xffffffff) >>> 0
  if (!finished || outputBytes !== entry.declaredSize) {
    throw new BoundedZipEntryError('integrity', 'actual-size-mismatch')
  }
  if (actualCrc !== entry.expectedCrc) {
    throw new BoundedZipEntryError('integrity', 'actual-crc-mismatch')
  }
  return output ?? new Uint8Array(0)
}
