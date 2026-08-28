import { failure } from './diagnostics'
import { verifyPackageManifestV2Revision } from './manifestV2'
import { parseMetadata33Glb } from './metadata33'
import { assertPackageIdentityUniqueness, sha256Hex } from './validationShared'
import type {
  Metadata33Projection,
  PackageArchiveV2,
  PackageParseResult,
  PackageTopologyUnavailableV2,
  ValidatedPackageArchiveV2,
} from './types'

export const PACKAGE_V2_TOPOLOGY_UNAVAILABLE: PackageTopologyUnavailableV2 = Object.freeze({
  capability: 'topology',
  status: 'UNAVAILABLE',
  code: 'TOPOLOGY_UNAVAILABLE',
  reasonCode: 'PACKAGE_DECLARED_ABSENT',
  packageSchemaVersion: 2,
})

export async function verifyPackageV2ResourceDigests(
  archive: PackageArchiveV2,
): Promise<PackageParseResult<PackageArchiveV2>> {
  for (let index = 0; index < archive.assets.length; index += 1) {
    const asset = archive.manifestDocument.assets[index]!
    const actual = await sha256Hex(archive.assets[index]!.bytes)
    if (actual !== asset.digest.value) {
      return failure(
        'PACKAGE_DIGEST_MISMATCH',
        'HASH',
        `/assets/${index}/digest`,
        { expected: asset.digest.value, actual },
        { manifestUri: archive.manifestDocument.manifestUri, assetId: asset.assetId },
      )
    }
  }
  return { ok: true, value: archive }
}

export async function validatePackageArchiveV2(
  archive: PackageArchiveV2,
): Promise<PackageParseResult<ValidatedPackageArchiveV2>> {
  const revision = await verifyPackageManifestV2Revision(archive.manifestDocument)
  if (!revision.ok) return revision
  const verified = await verifyPackageV2ResourceDigests(archive)
  if (!verified.ok) return verified
  const metadata: Metadata33Projection[] = []
  for (let index = 0; index < archive.assets.length; index += 1) {
    const asset = archive.manifestDocument.assets[index]!
    const parsed = parseMetadata33Glb(
      archive.assets[index]!.bytes,
      asset.floor,
      archive.manifestDocument.manifestUri,
      asset.assetId,
      { forbidEmbeddedTopology: true },
    )
    if (!parsed.ok) return parsed
    metadata.push(parsed.value)
  }
  const identities = assertPackageIdentityUniqueness(metadata)
  if (!identities.ok) return identities
  return {
    ok: true,
    value: Object.freeze({
      archive,
      metadata: Object.freeze(metadata),
      topologyCapability: PACKAGE_V2_TOPOLOGY_UNAVAILABLE,
    }),
  }
}
