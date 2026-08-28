import {
  canonicalizeTopologyAssetUri,
  parseTopologySidecarV1,
  redactTopologySidecarUri,
} from '../topology/sidecarV1'
import type {
  TopologySidecarAssetV1,
  TopologySidecarDiagnostic,
  TopologySidecarV1,
} from '../topology/types'
import { packageDiagnostic } from './diagnostics'
import type {
  Metadata33Projection,
  PackageArchive,
  PackageArchiveEntry,
  PackageDiagnostic,
  PackageManifestDocument,
} from './types'

export interface PreparedPackageAssetV1 {
  readonly manifestAsset: PackageManifestDocument['assets'][number]
  readonly sidecarAsset: TopologySidecarAssetV1
  readonly entry: PackageArchiveEntry
  readonly metadata: Metadata33Projection
}

export interface PreparedPackageTopologyV1 {
  readonly manifest: PackageManifestDocument
  readonly assets: readonly PreparedPackageAssetV1[]
  readonly topologyText: string
  readonly topologyDocument: TopologySidecarV1
}

export type PackageTopologyBindingResult =
  | { readonly ok: true; readonly value: PreparedPackageTopologyV1 }
  | {
      readonly ok: false
      readonly kind: 'package'
      readonly diagnostic: PackageDiagnostic
    }
  | {
      readonly ok: false
      readonly kind: 'sidecar'
      readonly diagnostic: TopologySidecarDiagnostic
    }

function cloneEntry(entry: PackageArchiveEntry): PackageArchiveEntry {
  return Object.freeze({
    path: entry.path,
    bytes: entry.bytes.slice(),
    compressedSize: entry.compressedSize,
    uncompressedSize: entry.uncompressedSize,
    method: entry.method,
  })
}

/**
 * Takes ownership of the resource bytes used by validation and the cache lease.
 * The caller must keep the returned archive private until loading completes.
 */
export function clonePackageArchiveResources(archive: PackageArchive): PackageArchive {
  return Object.freeze({
    manifest: cloneEntry(archive.manifest),
    assets: Object.freeze(archive.assets.map(cloneEntry)),
    topology: cloneEntry(archive.topology),
    manifestDocument: archive.manifestDocument,
  })
}

function sidecarUtf8Failure(sidecarUri: string): Extract<
  PackageTopologyBindingResult,
  { readonly kind: 'sidecar' }
> {
  return {
    ok: false,
    kind: 'sidecar',
    diagnostic: Object.freeze({
      code: 'SIDECAR_JSON_INVALID',
      phase: 'PARSE',
      message: 'topology sidecar is not valid UTF-8 JSON',
      path: '',
      sidecarUri: redactTopologySidecarUri(sidecarUri),
      assetId: null,
      entityId: null,
      details: Object.freeze({}),
    }),
  }
}

function packageFailure(
  manifest: PackageManifestDocument,
  path: string,
  reason: string,
  assetId?: string,
): PackageTopologyBindingResult {
  return {
    ok: false,
    kind: 'package',
    diagnostic: packageDiagnostic(
      reason === 'sidecar-revision'
        ? 'PACKAGE_REVISION_MISMATCH'
        : 'PACKAGE_TOPOLOGY_PROJECTION_MISMATCH',
      'BIND',
      path,
      { reason },
      { manifestUri: manifest.manifestUri, assetId },
    ),
  }
}

/**
 * Decodes and validates the explicit Platform sidecar, then binds its complete
 * asset identity set to the already digest/Metadata-validated package manifest.
 * It does not load models, inspect embedded topology, or call SSP.
 */
export function prebindPackageTopologyV1(
  archive: PackageArchive,
  metadata: readonly Metadata33Projection[],
): PackageTopologyBindingResult {
  const manifest = archive.manifestDocument
  if (metadata.length !== manifest.assets.length || archive.assets.length !== manifest.assets.length) {
    return packageFailure(manifest, '/assets', 'validated-asset-count')
  }

  let topologyText: string
  try {
    topologyText = new TextDecoder('utf-8', { fatal: true }).decode(archive.topology.bytes)
  } catch {
    return sidecarUtf8Failure(manifest.topology.canonicalUri)
  }

  const parsed = parseTopologySidecarV1(topologyText, manifest.topology.canonicalUri)
  if (!parsed.ok) {
    return {
      ok: false,
      kind: 'sidecar',
      diagnostic: parsed.diagnostics[0] ?? sidecarUtf8Failure(manifest.topology.canonicalUri).diagnostic,
    }
  }
  if (parsed.document.revision !== manifest.revision) {
    return packageFailure(manifest, '/topology/revision', 'sidecar-revision')
  }
  if (parsed.document.assets.length !== manifest.assets.length) {
    return packageFailure(manifest, '/topology/assets', 'asset-set-size')
  }

  const manifestByAssetId = new Map(manifest.assets.map((asset) => [asset.assetId, asset]))
  const sidecarAssetIds = new Set<string>()
  const sidecarByAssetId = new Map<string, TopologySidecarAssetV1>()
  for (let index = 0; index < parsed.document.assets.length; index += 1) {
    const sidecarAsset = parsed.document.assets[index]!
    const manifestAsset = manifestByAssetId.get(sidecarAsset.assetId)
    if (manifestAsset === undefined || sidecarAssetIds.has(sidecarAsset.assetId)) {
      return packageFailure(
        manifest,
        `/topology/assets/${String(index)}/assetId`,
        'asset-id-set',
        sidecarAsset.assetId,
      )
    }
    sidecarAssetIds.add(sidecarAsset.assetId)
    sidecarByAssetId.set(sidecarAsset.assetId, sidecarAsset)

    const canonicalUri = canonicalizeTopologyAssetUri(
      sidecarAsset.uri,
      manifest.topology.canonicalUri,
    )
    if (canonicalUri !== manifestAsset.canonicalUri) {
      return packageFailure(
        manifest,
        `/topology/assets/${String(index)}/uri`,
        'asset-canonical-uri',
        sidecarAsset.assetId,
      )
    }
    if (
      sidecarAsset.digest === undefined ||
      sidecarAsset.digest.algorithm !== manifestAsset.digest.algorithm ||
      sidecarAsset.digest.value !== manifestAsset.digest.value
    ) {
      return packageFailure(
        manifest,
        `/topology/assets/${String(index)}/digest`,
        'asset-digest',
        sidecarAsset.assetId,
      )
    }
  }

  if (sidecarAssetIds.size !== manifestByAssetId.size) {
    return packageFailure(manifest, '/topology/assets', 'asset-id-set')
  }

  const assets = manifest.assets.map((manifestAsset, index) => Object.freeze({
    manifestAsset,
    sidecarAsset: sidecarByAssetId.get(manifestAsset.assetId)!,
    entry: archive.assets[index]!,
    metadata: metadata[index]!,
  }))
  return {
    ok: true,
    value: Object.freeze({
      manifest,
      assets: Object.freeze(assets),
      topologyText,
      topologyDocument: parsed.document,
    }),
  }
}
