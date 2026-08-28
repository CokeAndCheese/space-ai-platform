export type PackagePhase = 'ARCHIVE' | 'PARSE' | 'VALIDATE' | 'HASH' | 'METADATA' | 'BIND' | 'LIFECYCLE'

export type PackageDiagnosticCode =
  | 'PACKAGE_JSON_INVALID'
  | 'PACKAGE_SCHEMA_UNSUPPORTED'
  | 'PACKAGE_FIELD_INVALID'
  | 'PACKAGE_DUPLICATE_ID'
  | 'PACKAGE_URI_INVALID'
  | 'PACKAGE_RESOURCE_NOT_FOUND'
  | 'PACKAGE_DIGEST_MISMATCH'
  | 'PACKAGE_REVISION_MISMATCH'
  | 'PACKAGE_METADATA_UNSUPPORTED'
  | 'PACKAGE_METADATA_INVALID'
  | 'PACKAGE_TOPOLOGY_PROJECTION_MISMATCH'
  | 'PACKAGE_LIMIT_EXCEEDED'
  | 'PACKAGE_REQUEST_STALE'

export interface PackageDiagnostic {
  readonly code: PackageDiagnosticCode
  readonly phase: PackagePhase
  readonly path: string
  readonly manifestUri?: string
  readonly assetId?: string
  readonly details: Readonly<Record<string, string | number | boolean | null>>
}

export interface Digest {
  readonly algorithm: 'SHA-256'
  readonly value: string
}

export interface PackageFloor {
  readonly floorName: string
  readonly building: string | null
  readonly level: number | null
  readonly floorType: string
}

export interface PackageAsset {
  readonly assetId: string
  readonly uri: string
  readonly canonicalUri: string
  readonly digest: Digest
  readonly floor: PackageFloor
}

export interface PackageTopology {
  readonly uri: string
  readonly canonicalUri: string
  readonly digest: Digest
  readonly schema: 'space-ai-platform/topology-sidecar'
  readonly schemaVersion: 1
  readonly revision: string
}

export interface PackageManifestDocument {
  readonly schema: 'space-model-package'
  readonly schemaVersion: 1
  readonly packageId: string
  readonly revision: string
  readonly metadata: {
    readonly schema: 'space-model-metadata'
    readonly version: '3.3-semantic'
    readonly carrier: 'GLB_SCENE_NODE_EXTRAS'
  }
  readonly assets: readonly PackageAsset[]
  readonly topology: PackageTopology
  readonly manifestUri: string
}

export interface PackageParseSuccess<T> { readonly ok: true; readonly value: T }
export interface PackageParseFailure { readonly ok: false; readonly diagnostic: PackageDiagnostic }
export type PackageParseResult<T> = PackageParseSuccess<T> | PackageParseFailure

export interface PackageArchiveEntry {
  readonly path: string
  readonly bytes: Uint8Array
  readonly compressedSize: number
  readonly uncompressedSize: number
  readonly method: 0 | 8
}

export interface PackageArchive {
  readonly manifest: PackageArchiveEntry
  readonly assets: readonly PackageArchiveEntry[]
  readonly topology: PackageArchiveEntry
  readonly manifestDocument: PackageManifestDocument
}

export interface Metadata33Projection {
  readonly scene: PackageFloor & { readonly name: string }
  readonly nodes: readonly {
    readonly index: number
    readonly name: string
    readonly sid: string
    readonly findId: string
    readonly renderType: string
    readonly renderTypeConfidence: 'high' | 'low'
    readonly floorName: string
    readonly building: string | null
    readonly level: number | null
    readonly floorType: string
    readonly spaceType?: string
    readonly fireType?: string
  }[]
  readonly buffer: Uint8Array
}
