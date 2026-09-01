import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { strToU8, unzipSync, zipSync } from 'fflate'
import {
  DEFAULT_PACKAGE_ZIP_V2_LIMITS,
  PACKAGE_V2_TOPOLOGY_UNAVAILABLE,
  canonicalizePackageManifestV2Revision,
  computePackageManifestV2Revision,
  parseMetadata33Glb,
  parsePackageManifestV1,
  parsePackageManifestV2,
  parsePackageZipV1,
  parsePackageZipV2,
  sha256Hex,
  validatePackageArchiveV2,
} from '../../adapters/package'

type Test = { readonly name: string; readonly run: () => void | Promise<void> }
type Floor = { readonly floorName: string; readonly building: string | null; readonly level: number | null; readonly floorType: string }
type FixtureMutation =
  | { readonly kind: 'xor-byte'; readonly offset: number; readonly value: number }
  | { readonly kind: 'append-hex'; readonly value: string }
  | { readonly kind: 'truncate-tail'; readonly byteCount: number }

interface FixtureIndex {
  readonly schema: string
  readonly schemaVersion: number
  readonly authoritativeSuccessPackage: {
    readonly file: string
    readonly sha256: string
    readonly byteLength: number
    readonly entries: readonly {
      readonly name: string
      readonly sha256: string
      readonly byteLength: number
    }[]
  }
  readonly failureVectors: readonly {
    readonly id: string
    readonly mutation: FixtureMutation
    readonly sha256: string
    readonly byteLength: number
    readonly expectedDiagnostic: {
      readonly code: string
      readonly phase: string
    }
  }[]
}

interface BuildingSourceFixtureIndex {
  readonly schema: string
  readonly schemaVersion: number
  readonly authority: {
    readonly sha256: string
    readonly profile: string
    readonly profileVersion: string
    readonly derivationVersion: number
  }
  readonly source: {
    readonly sha256: string
    readonly floors: readonly {
      readonly floorName: string
      readonly floorType: string
      readonly level: number | null
      readonly elevation: number
    }[]
  }
  readonly packageVectors: readonly {
    readonly schemaVersion: number
    readonly file: string
    readonly sha256: string
    readonly byteLength: number
    readonly entries: readonly { readonly name: string; readonly sha256: string; readonly byteLength: number }[]
  }[]
}

const URI = 'https://space-model-package.invalid/demo/space-model-package.v2.json'
const FLOOR: Floor = { floorName: 'A_1F', building: 'A', level: 1, floorType: 'FLOOR' }
const CAPABILITIES = {
  scene: { status: 'AVAILABLE' },
  metadata: { status: 'AVAILABLE' },
  space: { status: 'AVAILABLE', completion: 'CONFIRMED' },
  topology: { status: 'ABSENT' },
} as const
const METADATA = {
  schema: 'space-model-metadata',
  version: '3.3-semantic',
  carrier: 'GLB_SCENE_NODE_EXTRAS',
} as const
const MIRRORED_FIXTURE_URL = new URL('./fixtures/standard-model-package-v2-success.zip', import.meta.url)
const MIRRORED_INDEX_URL = new URL('./fixtures/standard-model-package-v2.sha256.json', import.meta.url)
const MIRRORED_FIXTURE = new Uint8Array(readFileSync(fileURLToPath(MIRRORED_FIXTURE_URL))).slice()
const MIRRORED_INDEX_BYTES = new Uint8Array(readFileSync(fileURLToPath(MIRRORED_INDEX_URL))).slice()
const MIRRORED_INDEX = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(
  MIRRORED_INDEX_BYTES,
)) as FixtureIndex
const AUTHORITATIVE_INDEX_SHA256 = 'c559d47222f6d7d61160d74676885e61ea0c0a462f0f67d6c7e5cdd2cc78a91c'
const AUTHORITATIVE_REVISION = '96fee045700e5bbe18c4b196ae96821a84508860460c3cd2e59455594bc61b22'
const PLATFORM_FAILURE_CODES = Object.freeze({
  'zip-first-payload-xor': 'PACKAGE_JSON_INVALID',
  'zip-append-zero': 'PACKAGE_LIMIT_EXCEEDED',
  'zip-truncate-tail': 'PACKAGE_JSON_INVALID',
} as const)
const BUILDING_SOURCE_FIXTURE_DIR = new URL('./fixtures/building-source-profile-v1.1/', import.meta.url)
const BUILDING_SOURCE_INDEX_BYTES = new Uint8Array(readFileSync(fileURLToPath(
  new URL('sha256.json', BUILDING_SOURCE_FIXTURE_DIR),
))).slice()
const BUILDING_SOURCE_INDEX = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(
  BUILDING_SOURCE_INDEX_BYTES,
)) as BuildingSourceFixtureIndex
const BUILDING_SOURCE_V2 = new Uint8Array(readFileSync(fileURLToPath(
  new URL('A-standard-model-package-v2.zip', BUILDING_SOURCE_FIXTURE_DIR),
))).slice()
const BUILDING_SOURCE_FLOORS = Object.freeze([
  { floorName: 'A_5F', building: 'A', level: 5, floorType: 'FLOOR' },
  { floorName: 'A_T', building: 'A', level: null, floorType: 'TOWER' },
  { floorName: 'A_6F', building: 'A', level: 6, floorType: 'FLOOR' },
  { floorName: 'A_RF', building: 'A', level: null, floorType: 'ROOF' },
] as const)

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

function equal(actual: unknown, expected: unknown, message: string): void {
  if (!Object.is(actual, expected)) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`)
  }
}

function parseGlbJsonDocument(bytes: Uint8Array): {
  readonly scenes?: readonly { readonly extras?: Record<string, unknown> }[]
} {
  assert(bytes.byteLength >= 20, 'authority GLB header')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  equal(view.getUint32(0, true), 0x46546c67, 'authority GLB magic')
  equal(view.getUint32(16, true), 0x4e4f534a, 'authority GLB first chunk type')
  const jsonLength = view.getUint32(12, true)
  assert(20 + jsonLength <= bytes.byteLength, 'authority GLB JSON bounds')
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(
    bytes.subarray(20, 20 + jsonLength),
  ).trimEnd()) as { readonly scenes?: readonly { readonly extras?: Record<string, unknown> }[] }
}

function mutateAuthoritativeFixture(mutation: FixtureMutation): Uint8Array {
  if (mutation.kind === 'xor-byte') {
    assert(
      Number.isInteger(mutation.offset) && mutation.offset >= 0 && mutation.offset < MIRRORED_FIXTURE.length,
      'failure vector xor offset',
    )
    assert(Number.isInteger(mutation.value) && mutation.value >= 0 && mutation.value <= 0xff, 'failure vector xor value')
    const result = MIRRORED_FIXTURE.slice()
    result[mutation.offset] ^= mutation.value
    return result
  }
  if (mutation.kind === 'append-hex') {
    assert(/^(?:[0-9a-f]{2})+$/iu.test(mutation.value), 'failure vector append hex')
    const pairs = mutation.value.match(/[0-9a-f]{2}/giu) ?? []
    const suffix = Uint8Array.from(pairs, (pair) => Number.parseInt(pair, 16))
    const result = new Uint8Array(MIRRORED_FIXTURE.length + suffix.length)
    result.set(MIRRORED_FIXTURE)
    result.set(suffix, MIRRORED_FIXTURE.length)
    return result
  }
  assert(
    Number.isInteger(mutation.byteCount) &&
      mutation.byteCount > 0 &&
      mutation.byteCount <= MIRRORED_FIXTURE.length,
    'failure vector truncate byte count',
  )
  return MIRRORED_FIXTURE.slice(0, MIRRORED_FIXTURE.length - mutation.byteCount)
}

function fail(
  result: { readonly ok: boolean; readonly diagnostic?: { readonly code: string; readonly phase?: string } },
  code: string,
  message: string,
): void {
  equal(result.ok, false, message)
  equal(result.diagnostic?.code, code, message)
}

function jsonChunk(document: unknown): Uint8Array {
  const bytes = new TextEncoder().encode(JSON.stringify(document))
  const padded = new Uint8Array((bytes.byteLength + 3) & ~3)
  padded.fill(0x20)
  padded.set(bytes)
  return padded
}

function glb(document: unknown, binLength = 12): Uint8Array {
  const json = jsonChunk(document)
  const length = 12 + 8 + json.byteLength + 8 + binLength
  const result = new Uint8Array(length)
  const view = new DataView(result.buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, length, true)
  view.setUint32(12, json.byteLength, true)
  view.setUint32(16, 0x4e4f534a, true)
  result.set(json, 20)
  view.setUint32(20 + json.byteLength, binLength, true)
  view.setUint32(24 + json.byteLength, 0x004e4942, true)
  return result
}

function validGlb(
  floor: Floor = FLOOR,
  options: { readonly embedded?: boolean; readonly sid?: string; readonly findId?: string; readonly nodeFloor?: Floor } = {},
): Uint8Array {
  return glb({
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{
      nodes: [0],
      extras: {
        ...floor,
        name: `${floor.floorName} scene`,
        ...(options.embedded ? { sspTopology: { schemaVersion: 1, graphs: [] } } : {}),
      },
    }],
    nodes: [{
      mesh: 0,
      extras: {
        name: 'hydrant',
        sid: options.sid ?? `FACILITY_${floor.floorName}_HYDRANT_01`,
        findId: options.findId ?? `${floor.floorName}_mesh_0`,
        renderType: 'FACILITY',
        renderTypeConfidence: 'high',
        ...(options.nodeFloor ?? floor),
        fireType: 'HYDRANT',
      },
    }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 1, type: 'VEC3' }],
    bufferViews: [{ buffer: 0, byteLength: 12 }],
    buffers: [{ byteLength: 12 }],
  })
}

function normalizeStoredZip(source: Uint8Array): Uint8Array {
  const result = source.slice()
  const u16 = (at: number) => result[at]! | result[at + 1]! << 8
  const u32 = (at: number) => (
    result[at]! |
    result[at + 1]! << 8 |
    result[at + 2]! << 16 |
    result[at + 3]! << 24
  ) >>> 0
  for (let at = 0; at + 4 < result.length;) {
    const signature = u32(at)
    if (signature === 0x04034b50) {
      const nameLength = u16(at + 26)
      const extraLength = u16(at + 28)
      const name = new TextDecoder().decode(result.subarray(at + 30, at + 30 + nameLength))
      let central = 0
      for (let scan = at + 30 + nameLength + extraLength; scan + 46 < result.length; scan += 1) {
        if (
          u32(scan) === 0x02014b50 &&
          new TextDecoder().decode(result.subarray(scan + 46, scan + 46 + u16(scan + 28))) === name
        ) {
          central = scan
          break
        }
      }
      if (central) {
        result[at + 6] &= 0xf7
        result[at + 14] = result[central + 16]!
        result[at + 15] = result[central + 17]!
        result[at + 16] = result[central + 18]!
        result[at + 17] = result[central + 19]!
        for (let index = 0; index < 8; index += 1) result[at + 18 + index] = result[central + 20 + index]!
      }
      at += 30 + nameLength + extraLength + u32(at + 18)
    } else if (signature === 0x02014b50) {
      result[at + 8] &= 0xf7
      at += 46 + u16(at + 28) + u16(at + 30) + u16(at + 32)
    } else if (signature === 0x06054b50) {
      break
    } else {
      at += 1
    }
  }
  return result
}

function storedZip(entries: Record<string, Uint8Array>): Uint8Array {
  const zippable: Record<string, [Uint8Array, { level: 0 }]> = {}
  for (const [path, bytes] of Object.entries(entries)) zippable[path] = [bytes, { level: 0 }]
  return normalizeStoredZip(zipSync(zippable))
}

function centralOffsets(zip: Uint8Array): number[] {
  const offsets: number[] = []
  for (let index = 0; index + 4 <= zip.length; index += 1) {
    const signature = (
      zip[index]! |
      zip[index + 1]! << 8 |
      zip[index + 2]! << 16 |
      zip[index + 3]! << 24
    ) >>> 0
    if (signature === 0x02014b50) offsets.push(index)
  }
  return offsets
}

function localOffsetAt(zip: Uint8Array, central: number): number {
  return (
    zip[central + 42]! |
    zip[central + 43]! << 8 |
    zip[central + 44]! << 16 |
    zip[central + 45]! << 24
  ) >>> 0
}

interface AssetInput {
  readonly assetId: string
  readonly uri: string
  readonly floor: Floor
  readonly bytes: Uint8Array
}

async function manifestFor(assets: readonly AssetInput[], revisionOverride?: string) {
  const raw = {
    schema: 'space-model-package',
    schemaVersion: 2,
    profile: 'TOPOLOGY_ABSENT_TRANSITION',
    packageId: 'project-a/building-a',
    revision: '0'.repeat(64),
    metadata: METADATA,
    capabilities: CAPABILITIES,
    assets: await Promise.all(assets.map(async (asset) => ({
      assetId: asset.assetId,
      uri: asset.uri,
      digest: { algorithm: 'SHA-256', value: await sha256Hex(asset.bytes) },
      floor: asset.floor,
    }))),
  }
  const parsed = parsePackageManifestV2(strToU8(JSON.stringify(raw)), URI)
  assert(parsed.ok, `manifest fixture should parse ${JSON.stringify(parsed)}`)
  raw.revision = revisionOverride ?? await computePackageManifestV2Revision(parsed.value)
  return raw
}

async function validPackage(options: {
  readonly assets?: readonly AssetInput[]
  readonly audit?: Uint8Array
  readonly revisionOverride?: string
  readonly extraEntries?: Readonly<Record<string, Uint8Array>>
} = {}) {
  const assets = options.assets ?? [{
    assetId: 'project-a/building-a/floor-a-1f',
    uri: './A_1F.glb',
    floor: FLOOR,
    bytes: validGlb(),
  }]
  const manifest = await manifestFor(assets, options.revisionOverride)
  const entries: Record<string, Uint8Array> = {
    'space-model-package.v2.json': strToU8(JSON.stringify(manifest)),
    ...Object.fromEntries(assets.map((asset) => [asset.uri.replace(/^\.\//, '').replace(/^\//, ''), asset.bytes])),
    ...(options.audit === undefined ? {} : { 'producer-validation.json': options.audit }),
    ...(options.extraEntries ?? {}),
  }
  return { zip: storedZip(entries), manifest, assets }
}

export type PackageV2FixtureFloor = Floor
export const PACKAGE_V2_FIXTURE_FLOOR = FLOOR
export const createPackageV2GlbFixture = validGlb
export const createPackageV2Fixture = validPackage
export const createStoredPackageZipV2Fixture = storedZip

function manifestVector(revision: string, overrides: Record<string, unknown> = {}) {
  return {
    schema: 'space-model-package',
    schemaVersion: 2,
    profile: 'TOPOLOGY_ABSENT_TRANSITION',
    packageId: 'project-a/building-a',
    revision,
    metadata: METADATA,
    capabilities: CAPABILITIES,
    assets: [{
      assetId: 'project-a/building-a/floor-a-1f',
      uri: './A_1F.glb',
      digest: { algorithm: 'SHA-256', value: 'a'.repeat(64) },
      floor: FLOOR,
    }],
    ...overrides,
  }
}

export async function runPackageV2Suite(): Promise<{
  readonly passed: number
  readonly names: readonly string[]
  readonly durationMs: number
}> {
  const tests: Test[] = [
    {
      name: 'authority building-source v2 mirror authenticates every entry and exact topology-absent Metadata',
      run: async () => {
        equal(await sha256Hex(BUILDING_SOURCE_INDEX_BYTES), '085a3a08f54fb7f02ee9ef6e16242e47d7741bb5821fdc95869df10ef6cc4485', 'authority index SHA-256')
        equal(BUILDING_SOURCE_INDEX.schema, 'space-model-studio/ai-building-source-profile-v1.1-fixture-sha256-index', 'authority index schema')
        equal(BUILDING_SOURCE_INDEX.schemaVersion, 1, 'authority index schema version')
        equal(BUILDING_SOURCE_INDEX.authority.sha256, 'c41dedc540037cfadbae828e82da4f170a97732e7a96d2ff14744ef75e4446ae', 'authority document SHA-256')
        equal(BUILDING_SOURCE_INDEX.authority.profile, 'space-model-studio/ai-building-source-glb', 'authority profile')
        equal(BUILDING_SOURCE_INDEX.authority.profileVersion, '1.1', 'authority profile version')
        equal(BUILDING_SOURCE_INDEX.authority.derivationVersion, 2, 'authority derivation version')
        equal(BUILDING_SOURCE_INDEX.source.sha256, '86244b9a40f75e11397cf8ebc65dc0509ffb0337eece3c2a8ba2e1d32a04b864', 'authority Building.glb SHA-256')
        equal(JSON.stringify(BUILDING_SOURCE_INDEX.source.floors), JSON.stringify([
          { floorName: 'A_5F', floorType: 'FLOOR', level: 5, elevation: 14.45 },
          { floorName: 'A_T', floorType: 'TOWER', level: null, elevation: 18.05 },
          { floorName: 'A_6F', floorType: 'FLOOR', level: 6, elevation: 20.25 },
          { floorName: 'A_RF', floorType: 'ROOF', level: null, elevation: 55.1 },
        ]), 'authority source floor vector')

        const vector = BUILDING_SOURCE_INDEX.packageVectors.find((candidate) => candidate.schemaVersion === 2)
        assert(vector !== undefined, 'authority v2 package vector')
        equal(vector.file, 'A-standard-model-package-v2.zip', 'authority v2 filename')
        equal(await sha256Hex(BUILDING_SOURCE_V2), vector.sha256, 'authority v2 ZIP SHA-256')
        equal(BUILDING_SOURCE_V2.byteLength, vector.byteLength, 'authority v2 ZIP length')
        const files = unzipSync(BUILDING_SOURCE_V2)
        equal(JSON.stringify(Object.keys(files).sort()), JSON.stringify(vector.entries.map((entry) => entry.name).sort()), 'authority v2 entry set')
        for (const entry of vector.entries) {
          const bytes = files[entry.name]
          assert(bytes !== undefined, `authority v2 entry ${entry.name}`)
          equal(bytes.byteLength, entry.byteLength, `${entry.name} length`)
          equal(await sha256Hex(bytes), entry.sha256, `${entry.name} SHA-256`)
        }
        equal(Object.keys(files).some((path) => path.toLowerCase().includes('topology')), false, 'authority v2 has no topology entry')
        for (const floor of BUILDING_SOURCE_FLOORS) {
          const document = parseGlbJsonDocument(files[`${floor.floorName}.glb`]!)
          const scenes = document.scenes ?? []
          assert(scenes.length > 0, `${floor.floorName} v2 scenes`)
          for (const scene of scenes) {
            equal(Object.prototype.hasOwnProperty.call(scene.extras ?? {}, 'sspTopology'), false, `${floor.floorName} v2 embedded topology key`)
          }
        }

        const archive = parsePackageZipV2(BUILDING_SOURCE_V2.slice(), URI)
        assert(archive.ok, `authority v2 parses ${JSON.stringify(archive)}`)
        const expectedRevision = 'b89bdf4c02f7c99182483a3f5119a4ed10141c11889108108bc47cf260f7c8d4'
        equal(archive.value.manifestDocument.revision, expectedRevision, 'authority v2 manifest revision')
        equal(JSON.stringify(archive.value.manifestDocument.assets.map((asset) => asset.floor)), JSON.stringify(BUILDING_SOURCE_FLOORS), 'authority v2 manifest floor order')
        equal('topology' in archive.value.manifestDocument, false, 'authority v2 manifest has no topology declaration')
        const computedRevision = await computePackageManifestV2Revision(archive.value.manifestDocument)
        equal(computedRevision, expectedRevision, 'authority v2 canonical revision')
        equal(computedRevision, archive.value.manifestDocument.revision, 'authority v2 computed and manifest revisions agree')
        const validated = await validatePackageArchiveV2(archive.value)
        assert(validated.ok, `authority v2 validates ${JSON.stringify(validated)}`)
        equal(JSON.stringify(validated.value.metadata.map((projection) => ({
          floorName: projection.scene.floorName,
          building: projection.scene.building,
          level: projection.scene.level,
          floorType: projection.scene.floorType,
        }))), JSON.stringify(BUILDING_SOURCE_FLOORS), 'authority v2 Metadata floor order')
        equal(validated.value.topologyCapability.code, 'TOPOLOGY_UNAVAILABLE', 'authority v2 topology code')
        equal(validated.value.topologyCapability.reasonCode, 'PACKAGE_DECLARED_ABSENT', 'authority v2 topology reason')
      },
    },
    {
      name: 'mirrored Studio v2 fixture authenticates the full index entries and canonical revision',
      run: async () => {
        equal(
          MIRRORED_INDEX.schema,
          'space-model-studio/standard-model-package-v2-fixture-sha256-index',
          'fixture index schema',
        )
        equal(MIRRORED_INDEX.schemaVersion, 1, 'fixture index schema version')
        equal(await sha256Hex(MIRRORED_INDEX_BYTES), AUTHORITATIVE_INDEX_SHA256, 'fixture index SHA-256')
        equal(
          MIRRORED_INDEX.authoritativeSuccessPackage.file,
          'standard-model-package-v2-success.zip',
          'fixture filename',
        )
        equal(
          await sha256Hex(MIRRORED_FIXTURE),
          MIRRORED_INDEX.authoritativeSuccessPackage.sha256,
          'fixture ZIP SHA-256',
        )
        equal(
          MIRRORED_FIXTURE.byteLength,
          MIRRORED_INDEX.authoritativeSuccessPackage.byteLength,
          'fixture ZIP byte length',
        )

        const files = unzipSync(MIRRORED_FIXTURE)
        equal(
          JSON.stringify(Object.keys(files).sort()),
          JSON.stringify(MIRRORED_INDEX.authoritativeSuccessPackage.entries.map((entry) => entry.name).sort()),
          'fixture entry set',
        )
        for (const entry of MIRRORED_INDEX.authoritativeSuccessPackage.entries) {
          const bytes = files[entry.name]
          assert(bytes !== undefined, `fixture entry ${entry.name}`)
          equal(bytes.byteLength, entry.byteLength, `${entry.name} byte length`)
          equal(await sha256Hex(bytes), entry.sha256, `${entry.name} SHA-256`)
        }

        const archive = parsePackageZipV2(MIRRORED_FIXTURE.slice(), URI)
        assert(archive.ok, `mirrored fixture should parse ${JSON.stringify(archive)}`)
        equal(archive.value.manifestDocument.revision, AUTHORITATIVE_REVISION, 'manifest revision')
        equal(
          await computePackageManifestV2Revision(archive.value.manifestDocument),
          AUTHORITATIVE_REVISION,
          'canonical revision',
        )
        const validated = await validatePackageArchiveV2(archive.value)
        assert(validated.ok, `mirrored fixture should validate ${JSON.stringify(validated)}`)
        equal(validated.value.metadata.length, 2, 'mirrored Metadata asset count')
        equal(validated.value.topologyCapability.code, 'TOPOLOGY_UNAVAILABLE', 'mirrored capability code')
        fail(
          parsePackageZipV1(
            MIRRORED_FIXTURE.slice(),
            'https://space-model-package.invalid/demo/space-model-package.v1.json',
          ),
          'PACKAGE_RESOURCE_NOT_FOUND',
          'mirrored v2 fixture requires the explicit v2 entry',
        )
      },
    },
    {
      name: 'mirrored Studio v2 failure vectors preserve full hashes and fail closed in the Platform parser',
      run: async () => {
        equal(MIRRORED_INDEX.failureVectors.length, 3, 'failure vector count')
        for (const vector of MIRRORED_INDEX.failureVectors) {
          const mutated = mutateAuthoritativeFixture(vector.mutation)
          equal(mutated.byteLength, vector.byteLength, `${vector.id} byte length`)
          equal(await sha256Hex(mutated), vector.sha256, `${vector.id} SHA-256`)
          equal(vector.expectedDiagnostic.code, 'PACKAGE_FIELD_INVALID', `${vector.id} producer code`)
          equal(vector.expectedDiagnostic.phase, 'reopen', `${vector.id} producer phase`)

          const platformCode = (PLATFORM_FAILURE_CODES as Readonly<Record<string, string>>)[vector.id]
          assert(platformCode !== undefined, `${vector.id} Platform diagnostic mapping`)
          const parsed = parsePackageZipV2(mutated, URI)
          assert(!parsed.ok, `${vector.id} must fail the Platform parser`)
          equal(parsed.diagnostic.code, platformCode, `${vector.id} Platform code`)
          equal(parsed.diagnostic.phase, 'ARCHIVE', `${vector.id} Platform phase`)
        }
      },
    },
    {
      name: 'manifest v2 accepts only the frozen closed identity and capability declaration',
      run: () => {
        const parsed = parsePackageManifestV2(strToU8(JSON.stringify(manifestVector('0'.repeat(64)))), URI)
        assert(parsed.ok, 'frozen manifest should parse')
        equal(parsed.value.profile, 'TOPOLOGY_ABSENT_TRANSITION', 'profile')
        equal(parsed.value.capabilities.space.completion, 'CONFIRMED', 'space completion')
        equal(PACKAGE_V2_TOPOLOGY_UNAVAILABLE.code, 'TOPOLOGY_UNAVAILABLE', 'unavailable code')
        equal(PACKAGE_V2_TOPOLOGY_UNAVAILABLE.reasonCode, 'PACKAGE_DECLARED_ABSENT', 'absent reason')
        fail(parsePackageManifestV2(strToU8(JSON.stringify(manifestVector('0'.repeat(64), { extra: true }))), URI), 'PACKAGE_FIELD_INVALID', 'unknown root')
        fail(parsePackageManifestV2(strToU8(JSON.stringify(manifestVector('0'.repeat(64), { profile: 'OTHER' }))), URI), 'PACKAGE_PROFILE_UNSUPPORTED', 'unknown profile')
        const missingTopology = manifestVector('0'.repeat(64), { capabilities: { ...CAPABILITIES, topology: undefined } })
        fail(parsePackageManifestV2(strToU8(JSON.stringify(missingTopology)), URI), 'PACKAGE_CAPABILITY_DECLARATION_INVALID', 'missing topology')
        const unknownCapability = manifestVector('0'.repeat(64), { capabilities: { ...CAPABILITIES, routing: { status: 'AVAILABLE' } } })
        fail(parsePackageManifestV2(strToU8(JSON.stringify(unknownCapability)), URI), 'PACKAGE_CAPABILITY_DECLARATION_INVALID', 'unknown capability')
      },
    },
    {
      name: 'v2 special floor identity accepts null for TOWER and ROOF while existing integer values remain valid',
      run: async () => {
        const tower: Floor = { floorName: 'A_T', building: 'A', level: null, floorType: 'TOWER' }
        const roof: Floor = { floorName: 'A_RF', building: 'A', level: null, floorType: 'ROOF' }
        for (const floor of [tower, roof, { ...tower, level: 25 }, { ...roof, level: 26 }]) {
          const source = manifestVector('0'.repeat(64), {
            assets: [{ ...manifestVector('0'.repeat(64)).assets[0], floor }],
          })
          const manifest = parsePackageManifestV2(strToU8(JSON.stringify(source)), URI)
          assert(manifest.ok, `${floor.floorName}/${String(floor.level)} manifest`)
          equal(manifest.value.assets[0]!.floor.floorName, floor.floorName, 'manifest exact floorName')
          equal(manifest.value.assets[0]!.floor.floorType, floor.floorType, 'manifest exact floorType')
          equal(manifest.value.assets[0]!.floor.level, floor.level, 'manifest exact level')
          const metadata = parseMetadata33Glb(validGlb(floor), floor, URI, 'a')
          assert(metadata.ok, `${floor.floorName}/${String(floor.level)} Metadata`)
          equal(metadata.value.scene.level, floor.level, 'Metadata exact level')
          equal(metadata.value.nodes[0]!.level, floor.level, 'node exact level')
        }

        const fixture = await validPackage({
          assets: [
            { assetId: 'project-a/building-a/tower', uri: './A_T.glb', floor: tower, bytes: validGlb(tower) },
            { assetId: 'project-a/building-a/roof', uri: './A_RF.glb', floor: roof, bytes: validGlb(roof) },
          ],
        })
        const archive = parsePackageZipV2(fixture.zip, URI)
        assert(archive.ok, 'null special floor package parses')
        equal(
          await computePackageManifestV2Revision(archive.value.manifestDocument),
          fixture.manifest.revision,
          'null special floor revision recomputes exactly',
        )
        const validated = await validatePackageArchiveV2(archive.value)
        assert(validated.ok, `null special floor package validates ${JSON.stringify(validated)}`)
        equal(validated.value.metadata[0]!.scene.level, null, 'tower validated level')
        equal(validated.value.metadata[1]!.scene.level, null, 'roof validated level')

        for (const floorType of ['FLOOR', 'BASEMENT', 'FACILITY']) {
          const invalid = { floorName: `A_${floorType}`, building: 'A', level: null, floorType }
          const source = manifestVector('0'.repeat(64), {
            assets: [{ ...manifestVector('0'.repeat(64)).assets[0], floor: invalid }],
          })
          fail(parsePackageManifestV2(strToU8(JSON.stringify(source)), URI), 'PACKAGE_FIELD_INVALID', `${floorType} null level`)
          fail(parseMetadata33Glb(validGlb(invalid), invalid, URI, 'a'), 'PACKAGE_METADATA_INVALID', `${floorType} Metadata null level`)
        }
        for (const special of [tower, roof]) {
          const invalid = { ...special, building: null }
          const source = manifestVector('0'.repeat(64), {
            assets: [{ ...manifestVector('0'.repeat(64)).assets[0], floor: invalid }],
          })
          fail(parsePackageManifestV2(strToU8(JSON.stringify(source)), URI), 'PACKAGE_FIELD_INVALID', `${special.floorType} null building`)
          fail(parseMetadata33Glb(validGlb(invalid), invalid, URI, 'a'), 'PACKAGE_METADATA_INVALID', `${special.floorType} Metadata null building`)
        }
        const missingLevel = { floorName: 'A_T', building: 'A', floorType: 'TOWER' }
        const missingSource = manifestVector('0'.repeat(64), {
          assets: [{ ...manifestVector('0'.repeat(64)).assets[0], floor: missingLevel }],
        })
        fail(parsePackageManifestV2(strToU8(JSON.stringify(missingSource)), URI), 'PACKAGE_FIELD_INVALID', 'missing level field')
        fail(parseMetadata33Glb(validGlb(missingLevel as Floor), tower, URI, 'a'), 'PACKAGE_METADATA_INVALID', 'missing scene level')
        fail(parseMetadata33Glb(validGlb(tower, { nodeFloor: missingLevel as Floor }), tower, URI, 'a'), 'PACKAGE_METADATA_INVALID', 'missing node level')

        for (const floorType of ['LANDSCAPE_TERRAIN', 'LANDSCAPE_FACADE']) {
          const landscape: Floor = { floorName: `SITE_${floorType}`, building: null, level: null, floorType }
          const source = manifestVector('0'.repeat(64), {
            assets: [{ ...manifestVector('0'.repeat(64)).assets[0], floor: landscape }],
          })
          assert(parsePackageManifestV2(strToU8(JSON.stringify(source)), URI).ok, `${floorType} manifest`)
          assert(parseMetadata33Glb(validGlb(landscape), landscape, URI, 'a').ok, `${floorType} Metadata`)
          for (const invalid of [{ ...landscape, building: 'A' }, { ...landscape, level: 1 }]) {
            const invalidSource = manifestVector('0'.repeat(64), {
              assets: [{ ...manifestVector('0'.repeat(64)).assets[0], floor: invalid }],
            })
            fail(parsePackageManifestV2(strToU8(JSON.stringify(invalidSource)), URI), 'PACKAGE_FIELD_INVALID', `${floorType} invariant`)
            fail(parseMetadata33Glb(validGlb(invalid), invalid, URI, 'a'), 'PACKAGE_METADATA_INVALID', `${floorType} Metadata invariant`)
          }
        }

        for (const changed of [{ ...tower, floorName: 'A_RF' }, { ...tower, floorType: 'ROOF' }, { ...tower, level: 25 }]) {
          fail(parseMetadata33Glb(validGlb(changed), tower, URI, 'a'), 'PACKAGE_METADATA_INVALID', 'scene floor drift')
          fail(parseMetadata33Glb(validGlb(tower, { nodeFloor: changed }), tower, URI, 'a'), 'PACKAGE_METADATA_INVALID', 'node floor drift')
        }
      },
    },
    {
      name: 'manifest v2 URI and identity rules are same-origin and collision closed',
      run: () => {
        const make = (uri: string) => manifestVector('0'.repeat(64), { assets: [{ ...manifestVector('0'.repeat(64)).assets[0], uri }] })
        fail(parsePackageManifestV2(strToU8(JSON.stringify(make('../A.glb'))), URI), 'PACKAGE_URI_INVALID', 'parent URI')
        fail(parsePackageManifestV2(strToU8(JSON.stringify(make('//evil.invalid/A.glb'))), URI), 'PACKAGE_URI_INVALID', 'protocol relative')
        fail(parsePackageManifestV2(strToU8(JSON.stringify(make('./%41.glb'))), URI), 'PACKAGE_URI_INVALID', 'encoded unreserved')
        const credentials = parsePackageManifestV2(
          strToU8(JSON.stringify(make('./A.glb'))),
          'https://u:p@space-model-package.invalid/demo/space-model-package.v2.json?token=secret#private',
        )
        fail(credentials, 'PACKAGE_URI_INVALID', 'manifest credentials')
        if (!credentials.ok) {
          equal(credentials.diagnostic.manifestUri, 'https://space-model-package.invalid/demo/space-model-package.v2.json', 'diagnostic URI redaction')
        }
        const duplicate = manifestVector('0'.repeat(64), { assets: [manifestVector('0'.repeat(64)).assets[0], { ...manifestVector('0'.repeat(64)).assets[0] }] })
        fail(parsePackageManifestV2(strToU8(JSON.stringify(duplicate)), URI), 'PACKAGE_DUPLICATE_ID', 'duplicate asset identity')
      },
    },
    {
      name: 'revision uses the frozen canonical facts vector and ignores JSON key order',
      run: async () => {
        const expected = '58c94d3c3fbcdc3486affb76fff5f284fe15a0281a73d31327424c5c40bf6f73'
        const source = manifestVector(expected)
        const parsed = parsePackageManifestV2(strToU8(JSON.stringify(source)), URI)
        assert(parsed.ok, 'revision vector parses')
        equal(await computePackageManifestV2Revision(parsed.value), expected, 'canonical revision vector')
        equal(canonicalizePackageManifestV2Revision(parsed.value)[0], '{', 'canonical JSON')
        const reordered = { assets: source.assets, capabilities: source.capabilities, metadata: source.metadata, revision: source.revision, packageId: source.packageId, profile: source.profile, schemaVersion: source.schemaVersion, schema: source.schema }
        const reorderedParsed = parsePackageManifestV2(strToU8(JSON.stringify(reordered)), URI)
        assert(reorderedParsed.ok, 'reordered manifest parses')
        equal(await computePackageManifestV2Revision(reorderedParsed.value), expected, 'key order independent')
      },
    },
    {
      name: 'valid store-only package validates revision digest Metadata and unavailable projection',
      run: async () => {
        const fixture = await validPackage({ audit: strToU8('non-normative arbitrary bytes') })
        const changedAudit = await validPackage({ audit: new Uint8Array([0xff, 0x00]) })
        equal(fixture.manifest.revision, changedAudit.manifest.revision, 'audit is outside revision facts')
        const archive = parsePackageZipV2(fixture.zip, URI)
        assert(archive.ok, `v2 ZIP should parse ${JSON.stringify(archive)}`)
        const validated = await validatePackageArchiveV2(archive.value)
        assert(validated.ok, `v2 package should validate ${JSON.stringify(validated)}`)
        equal(validated.value.metadata[0]!.nodes[0]!.fireType, 'HYDRANT', 'Metadata projection')
        equal(validated.value.topologyCapability.reasonCode, 'PACKAGE_DECLARED_ABSENT', 'normal absent capability')
      },
    },
    {
      name: 'root-relative asset URI maps to archive root without basename discovery',
      run: async () => {
        const asset = { assetId: 'a', uri: '/A_1F.glb', floor: FLOOR, bytes: validGlb() }
        const fixture = await validPackage({ assets: [asset] })
        const parsed = parsePackageZipV2(fixture.zip, URI)
        assert(parsed.ok, 'root-relative URI should parse')
        equal(parsed.value.manifestDocument.assets[0]!.canonicalUri, 'https://space-model-package.invalid/A_1F.glb', 'canonical URI')
      },
    },
    {
      name: 'v2 is an explicit entry and never takes v1 failure or conflicting manifests',
      run: async () => {
        const fixture = await validPackage()
        fail(parsePackageZipV1(fixture.zip, 'https://space-model-package.invalid/demo/space-model-package.v1.json'), 'PACKAGE_RESOURCE_NOT_FOUND', 'v1 cannot consume v2')
        const v1Shape = { ...fixture.manifest, schemaVersion: 1, topology: {} }
        const v1Only = storedZip({ 'space-model-package.v1.json': strToU8(JSON.stringify(v1Shape)), 'A_1F.glb': fixture.assets[0]!.bytes })
        fail(parsePackageZipV2(v1Only, URI), 'PACKAGE_RESOURCE_NOT_FOUND', 'v2 cannot consume v1')
        const both = await validPackage({ extraEntries: { 'space-model-package.v1.json': strToU8('{}') } })
        fail(parsePackageZipV2(both.zip, URI), 'PACKAGE_FIELD_INVALID', 'conflicting manifest identity')
        fail(parsePackageManifestV1(strToU8(JSON.stringify(fixture.manifest)), 'https://space-model-package.invalid/demo/space-model-package.v1.json'), 'PACKAGE_FIELD_INVALID', 'v1 schema remains closed')
      },
    },
    {
      name: 'closed archive rejects topology and all undeclared entries while audit content stays non-normative',
      run: async () => {
        const topology = await validPackage({ extraEntries: { 'topology.v1.json': strToU8('{}') } })
        fail(parsePackageZipV2(topology.zip, URI), 'PACKAGE_TOPOLOGY_RESOURCE_FORBIDDEN', 'topology entry')
        const unknown = await validPackage({ extraEntries: { 'model-index.json': strToU8('{}') } })
        fail(parsePackageZipV2(unknown.zip, URI), 'PACKAGE_FIELD_INVALID', 'unknown entry')
        const arbitraryAudit = await validPackage({ audit: new Uint8Array([0xff, 0x00, 0xfe]) })
        assert(parsePackageZipV2(arbitraryAudit.zip, URI).ok, 'audit bytes are not parsed')
      },
    },
    {
      name: 'embedded scene extras topology is rejected only by the v2 policy',
      run: async () => {
        const bytes = validGlb(FLOOR, { embedded: true })
        assert(parseMetadata33Glb(bytes, FLOOR).ok, 'existing Metadata 3.3 validation remains unchanged')
        const fixture = await validPackage({ assets: [{ assetId: 'a', uri: './A_1F.glb', floor: FLOOR, bytes }] })
        const archive = parsePackageZipV2(fixture.zip, URI)
        assert(archive.ok, 'embedded fixture reaches v2 Metadata gate')
        fail(await validatePackageArchiveV2(archive.value), 'PACKAGE_EMBEDDED_TOPOLOGY_FORBIDDEN', 'embedded topology')
      },
    },
    {
      name: 'revision and digest gates run before Metadata',
      run: async () => {
        const wrongRevision = await validPackage({ revisionOverride: 'f'.repeat(64) })
        const wrongRevisionArchive = parsePackageZipV2(wrongRevision.zip, URI)
        assert(wrongRevisionArchive.ok, 'wrong revision is structurally valid')
        const revisionResult = await validatePackageArchiveV2(wrongRevisionArchive.value)
        fail(revisionResult, 'PACKAGE_REVISION_MISMATCH', 'revision first')
        equal(revisionResult.ok ? '' : revisionResult.diagnostic.phase, 'HASH', 'revision phase')

        const digestFixture = await validPackage()
        const digestArchive = parsePackageZipV2(digestFixture.zip, URI)
        assert(digestArchive.ok, 'digest fixture parses')
        digestArchive.value.assets[0]!.bytes[0] ^= 1
        const digestResult = await validatePackageArchiveV2(digestArchive.value)
        fail(digestResult, 'PACKAGE_DIGEST_MISMATCH', 'digest before Metadata')
        equal(digestResult.ok ? '' : digestResult.diagnostic.phase, 'HASH', 'digest phase')
      },
    },
    {
      name: 'cross-asset SID and findId identity remains fail closed',
      run: async () => {
        const floorB: Floor = { ...FLOOR, building: 'B' }
        const fixture = await validPackage({ assets: [
          { assetId: 'a', uri: './A.glb', floor: FLOOR, bytes: validGlb() },
          { assetId: 'b', uri: './B.glb', floor: floorB, bytes: validGlb(floorB) },
        ] })
        const archive = parsePackageZipV2(fixture.zip, URI)
        assert(archive.ok, 'duplicate cross-asset fixture parses')
        fail(await validatePackageArchiveV2(archive.value), 'PACKAGE_DUPLICATE_ID', 'duplicate semantic identity')
      },
    },
    {
      name: 'ZIP store-only flags CRC local-central overlap and path collisions fail closed',
      run: async () => {
        const fixture = await validPackage()
        const method = fixture.zip.slice()
        const firstCentral = centralOffsets(method)[0]!
        method[firstCentral + 10] = 8
        fail(parsePackageZipV2(method, URI), 'PACKAGE_FIELD_INVALID', 'deflate method')

        const encrypted = fixture.zip.slice()
        encrypted[firstCentral + 8] |= 1
        fail(parsePackageZipV2(encrypted, URI), 'PACKAGE_FIELD_INVALID', 'encryption')

        const descriptor = fixture.zip.slice()
        descriptor[firstCentral + 8] |= 8
        fail(parsePackageZipV2(descriptor, URI), 'PACKAGE_FIELD_INVALID', 'descriptor')

        const localCrc = fixture.zip.slice()
        const local = localOffsetAt(localCrc, firstCentral)
        localCrc[local + 14] ^= 1
        fail(parsePackageZipV2(localCrc, URI), 'PACKAGE_JSON_INVALID', 'local central mismatch')

        const overlap = fixture.zip.slice()
        const offsets = centralOffsets(overlap)
        const secondCentral = offsets[1]!
        for (let index = 0; index < 4; index += 1) {
          overlap[secondCentral + 42 + index] = overlap[firstCentral + 42 + index]!
        }
        fail(parsePackageZipV2(overlap, URI), 'PACKAGE_JSON_INVALID', 'local entry overlap')

        const crc = fixture.zip.slice()
        crc[firstCentral + 16] ^= 1
        fail(parsePackageZipV2(crc, URI), 'PACKAGE_JSON_INVALID', 'CRC mismatch')

        const unsafe = storedZip({ 'space-model-package.v2.json': strToU8('{}'), '%2e%2e/x': strToU8('x') })
        fail(parsePackageZipV2(unsafe, URI), 'PACKAGE_FIELD_INVALID', 'encoded traversal')
        const collision = storedZip({ 'space-model-package.v2.json': strToU8('{}'), 'A.glb': strToU8('a'), 'a.glb': strToU8('b') })
        fail(parsePackageZipV2(collision, URI), 'PACKAGE_FIELD_INVALID', 'case collision')
      },
    },
    {
      name: 'ZIP64 and multidisk sentinels fail closed',
      run: async () => {
        const fixture = await validPackage()
        const zip64 = fixture.zip.slice()
        const eocd = zip64.byteLength - 22
        zip64[eocd + 10] = 0xff
        zip64[eocd + 11] = 0xff
        fail(parsePackageZipV2(zip64, URI), 'PACKAGE_FIELD_INVALID', 'ZIP64')
        const multidisk = fixture.zip.slice()
        multidisk[eocd + 4] = 1
        fail(parsePackageZipV2(multidisk, URI), 'PACKAGE_FIELD_INVALID', 'multidisk')
      },
    },
    {
      name: 'frozen resource limits are exact and custom envelopes can only tighten',
      run: async () => {
        equal(DEFAULT_PACKAGE_ZIP_V2_LIMITS.maxArchiveBytes, 65 * 1024 * 1024, 'archive limit')
        equal(DEFAULT_PACKAGE_ZIP_V2_LIMITS.maxEntries, 130, 'entry limit')
        equal(DEFAULT_PACKAGE_ZIP_V2_LIMITS.maxAssetEntries, 128, 'asset count')
        equal(DEFAULT_PACKAGE_ZIP_V2_LIMITS.maxAssetBytes, 32 * 1024 * 1024, 'single GLB')
        equal(DEFAULT_PACKAGE_ZIP_V2_LIMITS.maxManifestBytes, 1024 * 1024, 'manifest limit')
        equal(DEFAULT_PACKAGE_ZIP_V2_LIMITS.maxAuditBytes, 1024 * 1024, 'audit limit')
        equal(DEFAULT_PACKAGE_ZIP_V2_LIMITS.maxTotalBytes, 64 * 1024 * 1024, 'total entries')
        const fixture = await validPackage({ audit: strToU8('xx') })
        fail(parsePackageZipV2(fixture.zip, URI, { maxAuditBytes: 1 }), 'PACKAGE_LIMIT_EXCEEDED', 'audit budget')
        fail(parsePackageZipV2(fixture.zip, URI, { maxArchiveBytes: Number.NaN }), 'PACKAGE_LIMIT_EXCEEDED', 'NaN custom limit')
        fail(parsePackageZipV2(fixture.zip, URI, { maxArchiveBytes: DEFAULT_PACKAGE_ZIP_V2_LIMITS.maxArchiveBytes + 1 }), 'PACKAGE_LIMIT_EXCEEDED', 'cannot widen')
        fail(parsePackageZipV2(fixture.zip, URI, { maxTotalBytes: 1 }), 'PACKAGE_LIMIT_EXCEEDED', 'total budget')
        fail(parsePackageZipV2(fixture.zip, URI, { maxAssetBytes: 1 }), 'PACKAGE_LIMIT_EXCEEDED', 'single GLB budget')
      },
    },
    {
      name: 'manifest count depth string and UTF-8 budgets fail closed',
      run: () => {
        const assets = Array.from({ length: 129 }, (_, index) => ({
          ...manifestVector('0'.repeat(64)).assets[0],
          assetId: `a${index}`,
          uri: `./A${index}.glb`,
          floor: { ...FLOOR, floorName: `A_${index}F`, level: index },
        }))
        fail(parsePackageManifestV2(strToU8(JSON.stringify(manifestVector('0'.repeat(64), { assets }))), URI), 'PACKAGE_LIMIT_EXCEEDED', 'asset count')
        fail(parsePackageManifestV2(new Uint8Array(1024 * 1024 + 1), URI), 'PACKAGE_LIMIT_EXCEEDED', 'manifest bytes')
        fail(parsePackageManifestV2(strToU8(JSON.stringify(manifestVector('0'.repeat(64), { packageId: 'x'.repeat(161) }))), URI), 'PACKAGE_LIMIT_EXCEEDED', 'string budget')
        const lone = JSON.stringify(manifestVector('0'.repeat(64))).replace('project-a/building-a', '\\ud800')
        fail(parsePackageManifestV2(strToU8(lone), URI), 'PACKAGE_FIELD_INVALID', 'JCS invalid Unicode')
      },
    },
  ]

  const started = performance.now()
  const names: string[] = []
  for (const test of tests) {
    await test.run()
    names.push(test.name)
  }
  return { passed: names.length, names, durationMs: performance.now() - started }
}
