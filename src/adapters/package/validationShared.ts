import { failure } from './diagnostics'
import type { Metadata33Projection, PackageParseResult } from './types'

export function assertPackageIdentityUniqueness(
  projections: readonly Metadata33Projection[],
): PackageParseResult<true> {
  const sids = new Set<string>()
  const findIds = new Set<string>()
  for (const projection of projections) {
    for (const node of projection.nodes) {
      if (sids.has(node.sid)) {
        return failure('PACKAGE_DUPLICATE_ID', 'BIND', '/assets/nodes', { reason: 'duplicate-sid' })
      }
      if (findIds.has(node.findId)) {
        return failure('PACKAGE_DUPLICATE_ID', 'BIND', '/assets/nodes', { reason: 'duplicate-findId' })
      }
      sids.add(node.sid)
      findIds.add(node.findId)
    }
  }
  return { ok: true, value: true }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource)
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}
