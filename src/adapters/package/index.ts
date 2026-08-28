export * from './types'
export * from './diagnostics'
export * from './manifestV1'
export * from './zipV1'
export * from './metadata33'
export * from './topologyBinding'
export * from './manifestV2'
export * from './zipV2'
export * from './validateV2'
export * from './validationShared'

import { failure } from './diagnostics'
import { parseMetadata33Glb } from './metadata33'
import type { PackageArchive, PackageParseResult, Metadata33Projection } from './types'
import { assertPackageIdentityUniqueness, sha256Hex } from './validationShared'
import { crc32 } from './zipV1'

export async function verifyPackageResourceDigests(archive: PackageArchive): Promise<PackageParseResult<PackageArchive>> {
  for (let index = 0; index < archive.assets.length; index += 1) {
    const asset = archive.manifestDocument.assets[index]
    const actual = await sha256Hex(archive.assets[index]!.bytes)
    if (actual !== asset.digest.value) return failure('PACKAGE_DIGEST_MISMATCH', 'HASH', `/assets/${index}/digest`, { expected: asset.digest.value, actual }, { manifestUri: archive.manifestDocument.manifestUri, assetId: asset.assetId })
  }
  const topologyActual = await sha256Hex(archive.topology.bytes)
  if (topologyActual !== archive.manifestDocument.topology.digest.value) return failure('PACKAGE_DIGEST_MISMATCH', 'HASH', '/topology/digest', { expected: archive.manifestDocument.topology.digest.value, actual: topologyActual }, { manifestUri: archive.manifestDocument.manifestUri })
  return { ok: true, value: archive }
}

export async function validatePackageArchive(archive: PackageArchive): Promise<PackageParseResult<readonly Metadata33Projection[]>> {
  const verified = await verifyPackageResourceDigests(archive); if (!verified.ok) return verified
  const projections: Metadata33Projection[] = []
  for (let index = 0; index < archive.assets.length; index += 1) {
    const asset = archive.manifestDocument.assets[index]!; const parsed = parseMetadata33Glb(archive.assets[index]!.bytes, asset.floor, archive.manifestDocument.manifestUri, asset.assetId)
    if (!parsed.ok) return parsed
    projections.push(parsed.value)
  }
  const identities = assertPackageIdentityUniqueness(projections); if (!identities.ok) return identities
  return { ok: true, value: Object.freeze(projections) }
}

export { crc32 }
