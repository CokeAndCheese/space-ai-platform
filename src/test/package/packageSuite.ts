import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { zipSync, strToU8, unzipSync } from 'fflate'
import { parseMetadata33Glb } from '../../adapters/package/metadata33'
import { parsePackageManifestV1 } from '../../adapters/package/manifestV1'
import { packageJsonDepth } from '../../adapters/package/manifestV1'
import { parsePackageZipV1, crc32 } from '../../adapters/package/zipV1'
import {
  assertPackageIdentityUniqueness,
  prebindPackageTopologyV1,
  sha256Hex,
  validatePackageArchive,
} from '../../adapters/package'

type Test = { name: string; run: () => void | Promise<void> }
type FloorFixture = { floorName: string; building: string | null; level: number | null; floorType: string }
const URI = 'https://space-model-package.invalid/demo/space-model-package.v1.json'
const FLOOR = { floorName: 'A_1F', building: 'A', level: 1, floorType: 'FLOOR' } as const
const BUILDING_SOURCE_FIXTURE_URI =
  'https://space-model-package.invalid/building-source/space-model-package.v1.json'
const BUILDING_SOURCE_FIXTURE_DIR = new URL('./fixtures/building-source-profile-v1.1/', import.meta.url)
const BUILDING_SOURCE_INDEX_BYTES = new Uint8Array(readFileSync(fileURLToPath(
  new URL('sha256.json', BUILDING_SOURCE_FIXTURE_DIR),
))).slice()
const BUILDING_SOURCE_V1 = new Uint8Array(readFileSync(fileURLToPath(
  new URL('A-standard-model-package-v1.zip', BUILDING_SOURCE_FIXTURE_DIR),
))).slice()
const BUILDING_SOURCE_FLOORS = Object.freeze([
  { floorName: 'A_5F', building: 'A', level: 5, floorType: 'FLOOR' },
  { floorName: 'A_T', building: 'A', level: null, floorType: 'TOWER' },
  { floorName: 'A_6F', building: 'A', level: 6, floorType: 'FLOOR' },
  { floorName: 'A_RF', building: 'A', level: null, floorType: 'ROOF' },
] as const)
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
  readonly rejectionVectors: readonly { readonly carrierToken: string; readonly expected: string }[]
}
const BUILDING_SOURCE_INDEX = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(
  BUILDING_SOURCE_INDEX_BYTES,
)) as BuildingSourceFixtureIndex
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
function equal(actual: unknown, expected: unknown, message: string): void { if (!Object.is(actual, expected)) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`) }
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
function jsonChunk(document: unknown): Uint8Array {
  const bytes = new TextEncoder().encode(JSON.stringify(document)); const padded = new Uint8Array((bytes.byteLength + 3) & ~3); padded.fill(0x20); padded.set(bytes); return padded
}
function glb(document: unknown, binLength = 12): Uint8Array {
  const json = jsonChunk(document); const length = 12 + 8 + json.byteLength + 8 + binLength; const result = new Uint8Array(length); const view = new DataView(result.buffer); view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, length, true); view.setUint32(12, json.byteLength, true); view.setUint32(16, 0x4e4f534a, true); result.set(json, 20); view.setUint32(20 + json.byteLength, binLength, true); view.setUint32(24 + json.byteLength, 0x004e4942, true); return result
}
function normalizeZip(source: Uint8Array): Uint8Array {
  const result = source.slice(); const u16 = (at: number) => result[at]! | result[at + 1]! << 8; const u32 = (at: number) => (result[at]! | result[at + 1]! << 8 | result[at + 2]! << 16 | result[at + 3]! << 24) >>> 0
  for (let at = 0; at + 4 < result.length;) { const signature = u32(at); if (signature === 0x04034b50) { const nameLength = u16(at + 26); const extraLength = u16(at + 28); const name = new TextDecoder().decode(result.subarray(at + 30, at + 30 + nameLength)); let central = 0; for (let scan = at + 30 + nameLength + extraLength; scan + 46 < result.length; scan += 1) if (u32(scan) === 0x02014b50 && new TextDecoder().decode(result.subarray(scan + 46, scan + 46 + u16(scan + 28))) === name) { central = scan; break } if (central) { result[at + 6] &= 0xf7; result[at + 14] = result[central + 16]!; result[at + 15] = result[central + 17]!; result[at + 16] = result[central + 18]!; result[at + 17] = result[central + 19]!; for (let i = 0; i < 8; i += 1) result[at + 18 + i] = result[central + 20 + i]! } at += 30 + nameLength + extraLength + u32(at + 18) } else if (signature === 0x02014b50) { result[at + 8] &= 0xf7; at += 46 + u16(at + 28) + u16(at + 30) + u16(at + 32) } else if (signature === 0x06054b50) break; else at += 1 }
  return result
}
function centralOffsets(zip: Uint8Array): number[] { const out: number[] = []; for (let i = 0; i + 4 < zip.length; i += 1) if ((zip[i]! | zip[i + 1]! << 8 | zip[i + 2]! << 16 | zip[i + 3]! << 24) >>> 0 === 0x02014b50) out.push(i); return out }
function localOffsetAt(zip: Uint8Array, central: number): number { return (zip[central + 42]! | zip[central + 43]! << 8 | zip[central + 44]! << 16 | zip[central + 45]! << 24) >>> 0 }
function validGlb(floor: FloorFixture = FLOOR, options: { offset?: number; editor?: boolean; unusedMesh?: boolean; nonMeshSemantic?: boolean; nodeFloor?: FloorFixture } = {}): Uint8Array {
  const nodeExtras = { name: 'hydrant', sid: `FACILITY_${floor.floorName}_HYDRANT_01`, findId: `${floor.floorName}_mesh_0`, renderType: 'FACILITY', renderTypeConfidence: 'high', ...(options.nodeFloor ?? floor), fireType: 'HYDRANT', ...(options.editor ? { _editorEntityId: 'internal' } : {}) }
  const nodes: Record<string, unknown>[] = [{ name: 'hydrant', mesh: 0, extras: nodeExtras }]
  if (options.nonMeshSemantic) nodes.push({ name: 'orphan', extras: { sid: 'WALL_A_1F_01', renderType: 'WALL' } })
  const meshes = [{ primitives: [{ attributes: { POSITION: 0 } }] }]; if (options.unusedMesh) meshes.push({ primitives: [{ attributes: { POSITION: 0 } }] })
  const byteLength = (options.offset ?? 0) + 12
  return glb({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0], extras: { ...floor, name: 'A楼一层' } }], nodes, meshes, accessors: [{ bufferView: 0, componentType: 5126, count: 1, type: 'VEC3' }], bufferViews: [{ buffer: 0, byteOffset: options.offset ?? 0, byteLength: 12 }], buffers: [{ byteLength } ] }, (byteLength + 3) & ~3)
}
function deepGlb(depth: number): Uint8Array { const nodes: Record<string, unknown>[] = []; for (let i = 0; i < depth; i += 1) nodes.push(i === depth - 1 ? { name: 'mesh', mesh: 0, extras: { name: 'wall', sid: `WALL_A_1F_01`, findId: `A_1F_mesh_${i}`, renderType: 'WALL', renderTypeConfidence: 'high', ...FLOOR } } : { name: `group-${i}`, children: [i + 1] }); return glb({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0], extras: { ...FLOOR, name: 'A楼一层' } }], nodes, meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], accessors: [{ bufferView: 0, componentType: 5126, count: 1, type: 'VEC3' }], bufferViews: [{ buffer: 0, byteLength: 12 }], buffers: [{ byteLength: 12 }] }) }
async function validPackage(topologyPath = 'topology.v1.json', topologyInput?: Uint8Array): Promise<{ zip: Uint8Array; glb: Uint8Array; topology: Uint8Array }> {
  const model = validGlb(); const topology = topologyInput ?? strToU8('{"schema":"space-ai-platform/topology-sidecar"}')
  const manifest = { schema: 'space-model-package', schemaVersion: 1, packageId: 'demo', revision: 'r1', metadata: { schema: 'space-model-metadata', version: '3.3-semantic', carrier: 'GLB_SCENE_NODE_EXTRAS' }, assets: [{ assetId: 'a1', uri: './A_1F.glb', digest: { algorithm: 'SHA-256', value: await sha256Hex(model) }, floor: FLOOR }], topology: { uri: `./${topologyPath}`, digest: { algorithm: 'SHA-256', value: await sha256Hex(topology) }, schema: 'space-ai-platform/topology-sidecar', schemaVersion: 1, revision: 'r1' } }
  return { zip: normalizeZip(zipSync({ 'space-model-package.v1.json': strToU8(JSON.stringify(manifest)), 'A_1F.glb': model, [topologyPath]: [topology, { level: 0 }] })), glb: model, topology }
}
async function duplicateIdentityPackage(): Promise<Uint8Array> {
  const floorB = { ...FLOOR, building: 'B' }; const first = validGlb(); const second = validGlb(floorB); const topology = strToU8('{}'); const manifest = { schema: 'space-model-package', schemaVersion: 1, packageId: 'demo', revision: 'r1', metadata: { schema: 'space-model-metadata', version: '3.3-semantic', carrier: 'GLB_SCENE_NODE_EXTRAS' }, assets: [{ assetId: 'a1', uri: './A.glb', digest: { algorithm: 'SHA-256', value: await sha256Hex(first) }, floor: FLOOR }, { assetId: 'a2', uri: './B.glb', digest: { algorithm: 'SHA-256', value: await sha256Hex(second) }, floor: floorB }], topology: { uri: './topology.v1.json', digest: { algorithm: 'SHA-256', value: await sha256Hex(topology) }, schema: 'space-ai-platform/topology-sidecar', schemaVersion: 1, revision: 'r1' } }; return normalizeZip(zipSync({ 'space-model-package.v1.json': strToU8(JSON.stringify(manifest)), 'A.glb': first, 'B.glb': second, 'topology.v1.json': topology }))
}
function manifestVectorV1(floor: unknown): Record<string, unknown> {
  return { schema: 'space-model-package', schemaVersion: 1, packageId: 'p', revision: 'r', metadata: { schema: 'space-model-metadata', version: '3.3-semantic', carrier: 'GLB_SCENE_NODE_EXTRAS' }, assets: [{ assetId: 'a', uri: './asset.glb', digest: { algorithm: 'SHA-256', value: 'a'.repeat(64) }, floor }], topology: { uri: './topology.v1.json', digest: { algorithm: 'SHA-256', value: 'b'.repeat(64) }, schema: 'space-ai-platform/topology-sidecar', schemaVersion: 1, revision: 'r' } }
}
function fail(result: { ok: boolean; diagnostic?: { code: string; phase?: string; path?: string; details?: Record<string, unknown> } }, code: string, message: string): asserts result is { ok: false; diagnostic: { code: string; phase?: string; path?: string; details?: Record<string, unknown> } } { equal(result.ok, false, message); equal(result.diagnostic?.code, code, message) }

export async function runPackageSuite(): Promise<{ passed: number; names: readonly string[]; durationMs: number }> {
  const tests: Test[] = [
    { name: 'authority building-source v1 mirror authenticates every entry and strict sidecar binding', run: async () => {
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
      equal(JSON.stringify(BUILDING_SOURCE_INDEX.rejectionVectors), JSON.stringify([
        { carrierToken: 'TF', expected: 'BUILDING_SOURCE_FLOOR_CARRIER_INVALID' },
        { carrierToken: 'DING', expected: 'BUILDING_SOURCE_FLOOR_CARRIER_INVALID' },
        { carrierToken: 'T_LEVEL_18', expected: 'BUILDING_SOURCE_FLOOR_CARRIER_INVALID' },
        { carrierToken: 'RF_LEVEL_55', expected: 'BUILDING_SOURCE_FLOOR_CARRIER_INVALID' },
      ]), 'authority rejection vectors')

      const vector = BUILDING_SOURCE_INDEX.packageVectors.find((candidate) => candidate.schemaVersion === 1)
      assert(vector !== undefined, 'authority v1 package vector')
      equal(vector.file, 'A-standard-model-package-v1.zip', 'authority v1 filename')
      equal(await sha256Hex(BUILDING_SOURCE_V1), vector.sha256, 'authority v1 ZIP SHA-256')
      equal(BUILDING_SOURCE_V1.byteLength, vector.byteLength, 'authority v1 ZIP length')
      const files = unzipSync(BUILDING_SOURCE_V1)
      equal(JSON.stringify(Object.keys(files).sort()), JSON.stringify(vector.entries.map((entry) => entry.name).sort()), 'authority v1 entry set')
      for (const entry of vector.entries) {
        const bytes = files[entry.name]
        assert(bytes !== undefined, `authority v1 entry ${entry.name}`)
        equal(bytes.byteLength, entry.byteLength, `${entry.name} length`)
        equal(await sha256Hex(bytes), entry.sha256, `${entry.name} SHA-256`)
      }

      const archive = parsePackageZipV1(BUILDING_SOURCE_V1.slice(), BUILDING_SOURCE_FIXTURE_URI)
      assert(archive.ok, `authority v1 parses ${JSON.stringify(archive)}`)
      equal(archive.value.manifestDocument.revision, '482a129ffeef87de842d86ecb62e9e2d2f693ebcc0ae194543ab6e82c7f142bb', 'authority v1 manifest revision')
      equal(archive.value.manifestDocument.topology.revision, '482a129ffeef87de842d86ecb62e9e2d2f693ebcc0ae194543ab6e82c7f142bb', 'authority v1 topology declaration revision')
      equal(JSON.stringify(archive.value.manifestDocument.assets.map((asset) => asset.floor)), JSON.stringify(BUILDING_SOURCE_FLOORS), 'authority v1 manifest floor order')
      const validated = await validatePackageArchive(archive.value)
      assert(validated.ok, `authority v1 validates ${JSON.stringify(validated)}`)
      equal(JSON.stringify(validated.value.map((projection) => ({
        floorName: projection.scene.floorName,
        building: projection.scene.building,
        level: projection.scene.level,
        floorType: projection.scene.floorType,
      }))), JSON.stringify(BUILDING_SOURCE_FLOORS), 'authority v1 Metadata floor order')
      const binding = prebindPackageTopologyV1(archive.value, validated.value)
      assert(binding.ok, `authority v1 sidecar binds ${JSON.stringify(binding)}`)
      equal(binding.value.assets.length, BUILDING_SOURCE_FLOORS.length, 'authority v1 bound asset count')
      equal(binding.value.topologyDocument.revision, '482a129ffeef87de842d86ecb62e9e2d2f693ebcc0ae194543ab6e82c7f142bb', 'authority v1 sidecar revision')
      for (const [index, prepared] of binding.value.assets.entries()) {
        equal(prepared.sidecarAsset.assetId, prepared.manifestAsset.assetId, `authority v1 asset ${index} id`)
        equal(prepared.sidecarAsset.digest?.value, prepared.manifestAsset.digest.value, `authority v1 asset ${index} digest`)
        equal(prepared.metadata.scene.floorName, BUILDING_SOURCE_FLOORS[index]!.floorName, `authority v1 asset ${index} Metadata`)
      }

      const expectedOrders = new Map<string, number | null>([
        ['A_5F', 5],
        ['A_T', null],
        ['A_6F', 6],
        ['A_RF', null],
      ])
      for (const asset of archive.value.manifestDocument.assets) {
        const document = parseGlbJsonDocument(files[`${asset.floor.floorName}.glb`]!)
        const scenes = document.scenes ?? []
        assert(scenes.length > 0, `${asset.floor.floorName} embedded scenes`)
        let layerCount = 0
        for (const scene of scenes) {
          const extras = scene.extras ?? {}
          assert(Object.prototype.hasOwnProperty.call(extras, 'sspTopology'), `${asset.floor.floorName} embedded topology key`)
          const topology = extras.sspTopology as { readonly graphs?: readonly { readonly layers?: readonly Record<string, unknown>[] }[] }
          for (const graph of topology.graphs ?? []) {
            for (const layer of graph.layers ?? []) {
              layerCount += 1
              equal(layer.id, asset.floor.floorName, `${asset.floor.floorName} embedded layer id`)
              const expectedOrder = expectedOrders.get(asset.floor.floorName)
              assert(expectedOrder !== undefined || expectedOrders.has(asset.floor.floorName), `${asset.floor.floorName} order expectation`)
              equal(Object.prototype.hasOwnProperty.call(layer, 'order'), expectedOrder !== null, `${asset.floor.floorName} embedded order key presence`)
              if (expectedOrder !== null) equal(layer.order, expectedOrder, `${asset.floor.floorName} embedded integer order`)
            }
          }
        }
        assert(layerCount > 0, `${asset.floor.floorName} embedded topology layers`)
      }
      equal(binding.value.topologyDocument.layers.length, 4, 'authority v1 sidecar layer count')
      for (const layer of binding.value.topologyDocument.layers) {
        const expectedOrder = expectedOrders.get(layer.id)
        assert(expectedOrder !== undefined || expectedOrders.has(layer.id), `${layer.id} sidecar order expectation`)
        equal(Object.prototype.hasOwnProperty.call(layer, 'order'), expectedOrder !== null, `${layer.id} sidecar order key presence`)
        if (expectedOrder !== null) equal(layer.order, expectedOrder, `${layer.id} sidecar integer order`)
      }
    } },
    { name: 'manifest accepts canonical minimum', run: async () => { const p = await validPackage(); const m = parsePackageManifestV1(new TextEncoder().encode(JSON.stringify({ schema: 'space-model-package', schemaVersion: 1, packageId: 'p', revision: 'r', metadata: { schema: 'space-model-metadata', version: '3.3-semantic', carrier: 'GLB_SCENE_NODE_EXTRAS' }, assets: [{ assetId: 'a', uri: './a.glb', digest: { algorithm: 'SHA-256', value: 'a'.repeat(64) }, floor: FLOOR }], topology: { uri: './t.json', digest: { algorithm: 'SHA-256', value: 'b'.repeat(64) }, schema: 'space-ai-platform/topology-sidecar', schemaVersion: 1, revision: 'r' } })), URI); assert(m.ok, `manifest should parse ${JSON.stringify(m)}`); equal(m.value.assets[0]!.canonicalUri, 'https://space-model-package.invalid/demo/a.glb', 'canonical uri'); void p } },
    { name: 'v1 special floor identity accepts null for TOWER and ROOF while existing integer values remain valid', run: () => {
      const tower: FloorFixture = { floorName: 'A_T', building: 'A', level: null, floorType: 'TOWER' }
      const roof: FloorFixture = { floorName: 'A_RF', building: 'A', level: null, floorType: 'ROOF' }
      for (const floor of [tower, roof, { ...tower, level: 25 }, { ...roof, level: 26 }]) {
        const manifest = parsePackageManifestV1(strToU8(JSON.stringify(manifestVectorV1(floor))), URI)
        assert(manifest.ok, `${floor.floorName}/${String(floor.level)} manifest`)
        equal(manifest.value.assets[0]!.floor.floorName, floor.floorName, 'manifest exact floorName')
        equal(manifest.value.assets[0]!.floor.floorType, floor.floorType, 'manifest exact floorType')
        equal(manifest.value.assets[0]!.floor.level, floor.level, 'manifest exact level')
        const metadata = parseMetadata33Glb(validGlb(floor), floor, URI, 'a')
        assert(metadata.ok, `${floor.floorName}/${String(floor.level)} Metadata`)
        equal(metadata.value.scene.level, floor.level, 'Metadata exact level')
        equal(metadata.value.nodes[0]!.level, floor.level, 'node exact level')
      }

      for (const floorType of ['FLOOR', 'BASEMENT', 'FACILITY']) {
        const invalid = { floorName: `A_${floorType}`, building: 'A', level: null, floorType }
        const result = parsePackageManifestV1(strToU8(JSON.stringify(manifestVectorV1(invalid))), URI)
        fail(result, 'PACKAGE_FIELD_INVALID', `${floorType} null level`)
        equal(result.diagnostic.phase, 'VALIDATE', `${floorType} phase`)
        equal(result.diagnostic.path, '/assets/0', `${floorType} path`)
        const metadata = parseMetadata33Glb(validGlb(invalid), invalid, URI, 'a')
        fail(metadata, 'PACKAGE_METADATA_INVALID', `${floorType} Metadata null level`)
        equal(metadata.diagnostic.details?.reason, 'floor-identity', `${floorType} Metadata reason`)
      }
      for (const special of [tower, roof]) {
        const invalid = { ...special, building: null }
        fail(parsePackageManifestV1(strToU8(JSON.stringify(manifestVectorV1(invalid))), URI), 'PACKAGE_FIELD_INVALID', `${special.floorType} null building`)
        const metadata = parseMetadata33Glb(validGlb(invalid), invalid, URI, 'a')
        fail(metadata, 'PACKAGE_METADATA_INVALID', `${special.floorType} Metadata null building`)
        equal(metadata.diagnostic.details?.reason, 'floor-identity', `${special.floorType} building reason`)
      }
      const missingLevel = { floorName: 'A_T', building: 'A', floorType: 'TOWER' }
      fail(parsePackageManifestV1(strToU8(JSON.stringify(manifestVectorV1(missingLevel))), URI), 'PACKAGE_FIELD_INVALID', 'missing level field')
      const missingSceneLevel = parseMetadata33Glb(validGlb(missingLevel as FloorFixture), tower, URI, 'a')
      fail(missingSceneLevel, 'PACKAGE_METADATA_INVALID', 'missing scene level')
      equal(missingSceneLevel.diagnostic.path, '/scenes/0/extras', 'missing scene level path')
      equal(missingSceneLevel.diagnostic.details?.reason, 'scene-floor-fields', 'missing scene level reason')
      const missingNodeLevel = parseMetadata33Glb(validGlb(tower, { nodeFloor: missingLevel as FloorFixture }), tower, URI, 'a')
      fail(missingNodeLevel, 'PACKAGE_METADATA_INVALID', 'missing node level')
      equal(missingNodeLevel.diagnostic.path, '/nodes/0/extras', 'missing node level path')
      equal(missingNodeLevel.diagnostic.details?.reason, 'mesh-extras-missing', 'missing node level reason')

      for (const floorType of ['LANDSCAPE_TERRAIN', 'LANDSCAPE_FACADE']) {
        const landscape: FloorFixture = { floorName: `SITE_${floorType}`, building: null, level: null, floorType }
        assert(parsePackageManifestV1(strToU8(JSON.stringify(manifestVectorV1(landscape))), URI).ok, `${floorType} manifest`)
        assert(parseMetadata33Glb(validGlb(landscape), landscape, URI, 'a').ok, `${floorType} Metadata`)
        for (const invalid of [{ ...landscape, building: 'A' }, { ...landscape, level: 1 }]) {
          fail(parsePackageManifestV1(strToU8(JSON.stringify(manifestVectorV1(invalid))), URI), 'PACKAGE_FIELD_INVALID', `${floorType} invariant`)
          fail(parseMetadata33Glb(validGlb(invalid), invalid, URI, 'a'), 'PACKAGE_METADATA_INVALID', `${floorType} Metadata invariant`)
        }
      }

      for (const [key, changed] of [['floorName', { ...tower, floorName: 'A_RF' }], ['floorType', { ...tower, floorType: 'ROOF' }], ['level', { ...tower, level: 25 }]] as const) {
        const result = parseMetadata33Glb(validGlb(changed), tower, URI, 'a')
        fail(result, 'PACKAGE_METADATA_INVALID', `scene ${key} drift`)
        equal(result.diagnostic.path, `/scenes/0/extras/${key}`, `scene ${key} path`)
        equal(result.diagnostic.details?.reason, 'manifest-floor-mismatch', `scene ${key} reason`)
      }
      for (const changed of [{ ...tower, floorName: 'A_RF' }, { ...tower, floorType: 'ROOF' }, { ...tower, level: 25 }]) {
        const result = parseMetadata33Glb(validGlb(tower, { nodeFloor: changed }), tower, URI, 'a')
        fail(result, 'PACKAGE_METADATA_INVALID', 'node floor drift')
        equal(result.diagnostic.path, '/nodes/0/extras', 'node drift path')
        equal(result.diagnostic.details?.reason, 'mesh-extras-invalid', 'node drift reason')
      }
    } },
    { name: 'manifest rejects closed fields and duplicate identity', run: () => { const base = { schema: 'space-model-package', schemaVersion: 1, packageId: 'p', revision: 'r', metadata: { schema: 'space-model-metadata', version: '3.3-semantic', carrier: 'GLB_SCENE_NODE_EXTRAS' }, assets: [{ assetId: 'a', uri: './a.glb', digest: { algorithm: 'SHA-256', value: 'a'.repeat(64) }, floor: FLOOR }, { assetId: 'a', uri: './b.glb', digest: { algorithm: 'SHA-256', value: 'b'.repeat(64) }, floor: { ...FLOOR, floorName: 'B_1F', building: 'B' } }], topology: { uri: './t.json', digest: { algorithm: 'SHA-256', value: 'b'.repeat(64) }, schema: 'space-ai-platform/topology-sidecar', schemaVersion: 1, revision: 'r' } }; const x = parsePackageManifestV1(new TextEncoder().encode(JSON.stringify({ ...base, extra: 1 })), URI); fail(x, 'PACKAGE_FIELD_INVALID', 'unknown root field'); const y = parsePackageManifestV1(new TextEncoder().encode(JSON.stringify(base)), URI); fail(y, 'PACKAGE_DUPLICATE_ID', 'duplicate asset id') } },
    { name: 'manifest rejects URI escape and topology collision', run: () => { const make = (assetUri: string, topologyUri = './t.json') => ({ schema: 'space-model-package', schemaVersion: 1, packageId: 'p', revision: 'r', metadata: { schema: 'space-model-metadata', version: '3.3-semantic', carrier: 'GLB_SCENE_NODE_EXTRAS' }, assets: [{ assetId: 'a', uri: assetUri, digest: { algorithm: 'SHA-256', value: 'a'.repeat(64) }, floor: FLOOR }], topology: { uri: topologyUri, digest: { algorithm: 'SHA-256', value: 'b'.repeat(64) }, schema: 'space-ai-platform/topology-sidecar', schemaVersion: 1, revision: 'r' } }); fail(parsePackageManifestV1(new TextEncoder().encode(JSON.stringify(make('../a.glb'))), URI), 'PACKAGE_URI_INVALID', 'dot escape'); fail(parsePackageManifestV1(new TextEncoder().encode(JSON.stringify(make('./a.glb', './a.glb'))), URI), 'PACKAGE_DUPLICATE_ID', 'resource collision') } },
    { name: 'zip accepts valid package and validates metadata', run: async () => { const p = await validPackage(); const archive = parsePackageZipV1(p.zip, URI); assert(archive.ok, 'zip should parse'); const validated = await validatePackageArchive(archive.value); assert(validated.ok, `package should validate ${JSON.stringify(validated)}`); equal(validated.value[0]!.nodes[0]!.fireType, 'HYDRANT', 'projection') } },
    { name: 'zip rejects missing manifest and old batch', run: async () => { const p = await validPackage(); const old = zipSync({ 'A_1F.glb': p.glb, 'model-index.json': strToU8('{"standardModelPackage":false}') }); fail(parsePackageZipV1(old, URI), 'PACKAGE_RESOURCE_NOT_FOUND', 'old batch is not package') } },
    { name: 'zip rejects unsafe and duplicate paths', run: async () => { const p = await validPackage(); const unsafe = zipSync({ 'space-model-package.v1.json': strToU8('{}'), '../A.glb': p.glb }); fail(parsePackageZipV1(unsafe, URI), 'PACKAGE_FIELD_INVALID', 'zip slip'); const duplicate = zipSync({ 'space-model-package.v1.json': strToU8('{}'), 'A.glb': p.glb, 'a.glb': p.glb }); fail(parsePackageZipV1(duplicate, URI), 'PACKAGE_FIELD_INVALID', 'case collision') } },
    { name: 'metadata rejects external resources and missing identity', run: () => { const external = glb({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [], extras: { ...FLOOR, name: 'x' } }], nodes: [], buffers: [{ uri: 'https://evil.test/a.bin' }] }); fail(parseMetadata33Glb(external, FLOOR, URI, 'a'), 'PACKAGE_METADATA_INVALID', 'external buffer'); const missing = glb({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0], extras: { ...FLOOR, name: 'x' } }], nodes: [{ mesh: 0, extras: { ...FLOOR, name: 'x', sid: 'WALL_A_1F_N_01', renderType: 'WALL', findId: 'wrong' } }], meshes: [{}], buffers: [] }); fail(parseMetadata33Glb(missing, FLOOR, URI, 'a'), 'PACKAGE_METADATA_INVALID', 'findId exactness') } },
    { name: 'limits and digest fail closed', run: async () => { const p = await validPackage(); fail(parsePackageZipV1(p.zip, URI, { maxTotalBytes: 1 }), 'PACKAGE_LIMIT_EXCEEDED', 'zip limit'); const archive = parsePackageZipV1(p.zip, URI); assert(archive.ok, 'archive'); archive.value.assets[0]!.bytes[0] ^= 1; const check = await validatePackageArchive(archive.value); fail(check, 'PACKAGE_DIGEST_MISMATCH', 'digest mismatch') } },
    { name: 'manifest depth and field budgets are deterministic', run: () => { let nested: unknown = {}; for (let i = 0; i < 20; i += 1) nested = [nested]; const m = parsePackageManifestV1(new TextEncoder().encode(JSON.stringify(nested)), URI); fail(m, 'PACKAGE_LIMIT_EXCEEDED', 'depth limit'); const long = { schema: 'space-model-package', schemaVersion: 1, packageId: 'x'.repeat(161), revision: 'r', metadata: { schema: 'space-model-metadata', version: '3.3-semantic', carrier: 'GLB_SCENE_NODE_EXTRAS' }, assets: [], topology: {} }; fail(parsePackageManifestV1(new TextEncoder().encode(JSON.stringify(long)), URI), 'PACKAGE_LIMIT_EXCEEDED', 'string limit') } },
    { name: 'manifest rejects credentials and overlong URI', run: () => { const source = { schema: 'space-model-package', schemaVersion: 1, packageId: 'p', revision: 'r', metadata: { schema: 'space-model-metadata', version: '3.3-semantic', carrier: 'GLB_SCENE_NODE_EXTRAS' }, assets: [{ assetId: 'a', uri: './a.glb', digest: { algorithm: 'SHA-256', value: 'a'.repeat(64) }, floor: FLOOR }], topology: { uri: './t.json', digest: { algorithm: 'SHA-256', value: 'b'.repeat(64) }, schema: 'space-ai-platform/topology-sidecar', schemaVersion: 1, revision: 'r' } }; fail(parsePackageManifestV1(new TextEncoder().encode(JSON.stringify(source)), 'https://user:pass@space-model-package.invalid/demo/space-model-package.v1.json'), 'PACKAGE_URI_INVALID', 'manifest credentials'); const longUri = { ...source, assets: [{ ...source.assets[0], uri: `./${'a'.repeat(4096)}.glb` }] }; fail(parsePackageManifestV1(new TextEncoder().encode(JSON.stringify(longUri)), URI), 'PACKAGE_LIMIT_EXCEEDED', 'URI budget') } },
    { name: 'metadata rejects unreachable mesh and fixed space enum', run: () => { const extra = validGlb(); void extra; const unreachable = glb({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0], extras: { ...FLOOR, name: 'A楼一层' } }], nodes: [{ name: 'x' }, { mesh: 0, extras: { name: 'x', sid: 'WALL_A_1F_01', findId: 'A_1F_mesh_1', renderType: 'WALL', renderTypeConfidence: 'high', ...FLOOR } }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], accessors: [{ bufferView: 0, componentType: 5126, count: 1, type: 'VEC3' }], bufferViews: [{ buffer: 0, byteLength: 12 }], buffers: [{ byteLength: 12 }] }); fail(parseMetadata33Glb(unreachable, FLOOR, URI, 'a'), 'PACKAGE_METADATA_INVALID', 'unreachable mesh') } },
    { name: 'zip custom limits can only tighten and CRC is checked', run: async () => { const p = await validPackage(); fail(parsePackageZipV1(p.zip, URI, { maxEntries: 999 }), 'PACKAGE_LIMIT_EXCEEDED', 'limits cannot widen'); const badZip = p.zip.slice(); const central = badZip.findIndex((value, index) => index > 0 && value === 0x50 && badZip[index + 1] === 0x4b && badZip[index + 2] === 0x01 && badZip[index + 3] === 0x02); assert(central >= 0, 'central header'); badZip[central + 16] ^= 1; fail(parsePackageZipV1(badZip, URI), 'PACKAGE_JSON_INVALID', 'CRC mismatch') } },
    { name: 'iterative JSON depth uses container semantics', run: () => { let at: unknown = {}; for (let i = 1; i < 16; i += 1) at = [at]; equal(packageJsonDepth(at), 16, 'depth sixteen'); at = [at]; equal(packageJsonDepth(at), 17, 'depth seventeen') } },
    { name: 'Metadata 3.3 directional types require direction matching SID without affecting other types', run: () => { const make = (renderType: string, sid: string, direction?: string, conditional: Record<string, unknown> = {}) => glb({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0], extras: { ...FLOOR, name: 'A楼一层' } }], nodes: [{ mesh: 0, extras: { name: 'entity', sid, findId: 'A_1F_mesh_0', renderType, renderTypeConfidence: 'high', ...FLOOR, ...(direction === undefined ? {} : { direction }), ...conditional } }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], accessors: [{ bufferView: 0, componentType: 5126, count: 1, type: 'VEC3' }], bufferViews: [{ buffer: 0, byteLength: 12 }], buffers: [{ byteLength: 12 }] }); for (const [renderType, sid, direction] of [['DOOR', 'DOOR_A_1F_NE_01', 'NE'], ['WINDOW', 'WINDOW_A_1F_E_01', 'E'], ['ELEVATOR', 'ELEVATOR_A_1F_SW_01', 'SW'], ['STAIR', 'STAIR_A_1F_NW_01', 'NW']] as const) assert(parseMetadata33Glb(make(renderType, sid, direction), FLOOR).ok, `${renderType} matching direction`); fail(parseMetadata33Glb(make('DOOR', 'DOOR_A_1F_NE_01'), FLOOR), 'PACKAGE_METADATA_INVALID', 'missing direction'); fail(parseMetadata33Glb(make('DOOR', 'DOOR_A_1F_NE_01', 'UP'), FLOOR), 'PACKAGE_METADATA_INVALID', 'invalid direction'); fail(parseMetadata33Glb(make('DOOR', 'DOOR_A_1F_NE_01', 'N'), FLOOR), 'PACKAGE_METADATA_INVALID', 'direction and SID mismatch'); assert(parseMetadata33Glb(make('WALL', 'WALL_A_1F_01'), FLOOR).ok, 'WALL needs no direction'); assert(parseMetadata33Glb(make('SPACE', 'SPACE_A_1F_OFFICE_01', undefined, { spaceType: 'OFFICE' }), FLOOR).ok, 'SPACE needs no direction'); assert(parseMetadata33Glb(make('FACILITY', 'FACILITY_A_1F_HYDRANT_01', undefined, { fireType: 'HYDRANT' }), FLOOR).ok, 'FACILITY needs no direction'); assert(parseMetadata33Glb(make('CEILING', 'CEILING_A_1F_LOWER'), FLOOR).ok, 'CEILING needs no direction') } },
    { name: 'valid manifest sidecar may use a safe nested URI', run: async () => { const p = await validPackage('topology/A_1F.topology.v1.json'); const parsed = parsePackageZipV1(p.zip, URI); assert(parsed.ok, 'nested topology should parse') } },
    { name: 'valid URI length boundaries and root-relative archive mapping pass', run: async () => { const base = { schema: 'space-model-package', schemaVersion: 1, packageId: 'p', revision: 'r', metadata: { schema: 'space-model-metadata', version: '3.3-semantic', carrier: 'GLB_SCENE_NODE_EXTRAS' }, assets: [{ assetId: 'a', uri: './a.glb', digest: { algorithm: 'SHA-256', value: 'a'.repeat(64) }, floor: FLOOR }], topology: { uri: './topology.v1.json', digest: { algorithm: 'SHA-256', value: 'b'.repeat(64) }, schema: 'space-ai-platform/topology-sidecar', schemaVersion: 1, revision: 'r' } }; const withUri = (uri: string) => ({ ...base, assets: [{ ...base.assets[0], uri }] }); const p161 = parsePackageManifestV1(new TextEncoder().encode(JSON.stringify(withUri(`./${'a'.repeat(155)}.glb`))), URI); assert(p161.ok, '161 URI'); const p4096 = parsePackageManifestV1(new TextEncoder().encode(JSON.stringify(withUri(`./${'a'.repeat(4090)}.glb`))), URI); assert(p4096.ok, '4096 URI'); fail(parsePackageManifestV1(new TextEncoder().encode(JSON.stringify(withUri(`./${'a'.repeat(4091)}.glb`))), URI), 'PACKAGE_LIMIT_EXCEEDED', '4097 URI'); const valid = await validPackage(); const files = unzipSync(valid.zip); const changed = JSON.parse(new TextDecoder().decode(files['space-model-package.v1.json']!)) as { assets: [{ uri: string }] }; changed.assets[0].uri = '/A_1F.glb'; files['space-model-package.v1.json'] = strToU8(JSON.stringify(changed)); const parsed = parsePackageZipV1(normalizeZip(zipSync(files)), URI); assert(parsed.ok, 'root-relative asset maps to archive root'); equal(parsed.value.manifestDocument.assets[0]!.canonicalUri, 'https://space-model-package.invalid/A_1F.glb', 'root-relative canonical URI') } },
    { name: 'unknown entry is rejected after complete valid manifest', run: async () => { const p = await validPackage(); const files = unzipSync(p.zip); files['unexpected.bin'] = strToU8('x'); const parsed = parsePackageZipV1(normalizeZip(zipSync(files)), URI); fail(parsed, 'PACKAGE_FIELD_INVALID', 'unknown entry') } },
    { name: 'cross asset SID and findId uniqueness fail closed', run: async () => { const archive = parsePackageZipV1(await duplicateIdentityPackage(), URI); assert(archive.ok, 'duplicate archive parses'); const result = await validatePackageArchive(archive.value); fail(result, 'PACKAGE_DUPLICATE_ID', 'cross asset identity') } },
    { name: 'metadata P1 fixtures fail and deep hierarchy succeeds', run: () => { const unaligned = parseMetadata33Glb(validGlb(FLOOR, { offset: 2 }), FLOOR); fail(unaligned, 'PACKAGE_METADATA_INVALID', 'unaligned bufferView'); equal(unaligned.diagnostic?.details?.reason, 'buffer-view-bounds', 'unaligned reason'); fail(parseMetadata33Glb(validGlb(FLOOR, { unusedMesh: true }), FLOOR), 'PACKAGE_METADATA_INVALID', 'unused mesh'); fail(parseMetadata33Glb(validGlb(FLOOR, { nonMeshSemantic: true }), FLOOR), 'PACKAGE_METADATA_INVALID', 'non-mesh semantic'); fail(parseMetadata33Glb(validGlb(FLOOR, { editor: true }), FLOOR), 'PACKAGE_METADATA_INVALID', 'editor field'); fail(parseMetadata33Glb(validGlb(), { ...FLOOR, building: 'B' }), 'PACKAGE_METADATA_INVALID', 'scene floor mismatch'); const deep = parseMetadata33Glb(deepGlb(1001), FLOOR); assert(deep.ok, 'deep hierarchy iterative success') } },
    { name: 'cross asset SID and findId checks report independently', run: () => { const parsed = parseMetadata33Glb(validGlb(), FLOOR); assert(parsed.ok, 'projection'); const secondSid = { ...parsed.value, nodes: [{ ...parsed.value.nodes[0]!, sid: 'FACILITY_A_1F_HYDRANT_01' }] }; const secondFind = { ...parsed.value, nodes: [{ ...parsed.value.nodes[0]!, sid: 'FACILITY_A_1F_HYDRANT_02', findId: 'A_1F_mesh_0' }] }; const sid = assertPackageIdentityUniqueness([parsed.value, secondSid]); fail(sid, 'PACKAGE_DUPLICATE_ID', 'duplicate SID'); const find = assertPackageIdentityUniqueness([parsed.value, secondFind]); fail(find, 'PACKAGE_DUPLICATE_ID', 'duplicate findId') } },
    { name: 'ZIP path, flags, and local-central mutations fail closed', run: async () => { const p = await validPackage(); const badPath = zipSync({ 'space-model-package.v1.json': strToU8('{}'), '%2e%2e/x': strToU8('x') }); fail(parsePackageZipV1(badPath, URI), 'PACKAGE_FIELD_INVALID', 'encoded traversal'); const invalidUtf8 = zipSync({ 'space-model-package.v1.json': strToU8('{}') }); const invalidBytes = invalidUtf8.slice(); const invalidCentral = centralOffsets(invalidBytes)[0]!; invalidBytes[invalidCentral + 8] |= 0x80; invalidBytes[invalidCentral + 46] = 0xff; fail(parsePackageZipV1(invalidBytes, URI), 'PACKAGE_FIELD_INVALID', 'invalid UTF8 path'); const high = invalidUtf8.slice(); const highCentral = centralOffsets(high)[0]!; high[highCentral + 46] = 0xff; fail(parsePackageZipV1(high, URI), 'PACKAGE_FIELD_INVALID', 'non UTF8 high path'); const mut = p.zip.slice(); const first = centralOffsets(mut)[0]!; mut[first + 8] |= 0x08; fail(parsePackageZipV1(mut, URI), 'PACKAGE_FIELD_INVALID', 'bit3 flag'); const unknown = p.zip.slice(); const unknownCentral = centralOffsets(unknown)[0]!; unknown[unknownCentral + 8] |= 0x40; fail(parsePackageZipV1(unknown, URI), 'PACKAGE_FIELD_INVALID', 'unknown flag'); const crc = p.zip.slice(); const local = localOffsetAt(crc, first); crc[local + 14] ^= 1; fail(parsePackageZipV1(crc, URI), 'PACKAGE_JSON_INVALID', 'local crc'); const offset = p.zip.slice(); offset[first + 42] = 0xff; offset[first + 43] = 0xff; offset[first + 44] = 0xff; offset[first + 45] = 0x7f; fail(parsePackageZipV1(offset, URI), 'PACKAGE_JSON_INVALID', 'local offset'); const records = centralOffsets(p.zip); const overlap = p.zip.slice(); const second = records[1]!; for (let i = 0; i < 4; i += 1) overlap[second + 42 + i] = overlap[first + 42 + i]!; fail(parsePackageZipV1(overlap, URI), 'PACKAGE_JSON_INVALID', 'local range overlap'); const size = p.zip.slice(); size[first + 20] ^= 1; fail(parsePackageZipV1(size, URI), 'PACKAGE_JSON_INVALID', 'central compressed size'); const uncompressed = p.zip.slice(); uncompressed[first + 24] ^= 1; fail(parsePackageZipV1(uncompressed, URI), 'PACKAGE_JSON_INVALID', 'central uncompressed size'); const centralSize = p.zip.slice(); const eocd = centralSize.length - 22; centralSize[eocd + 12] ^= 1; fail(parsePackageZipV1(centralSize, URI), 'PACKAGE_LIMIT_EXCEEDED', 'central cursor size') } },
    { name: 'custom archive envelope rejects NaN Infinity and tiny max', run: async () => { const p = await validPackage(); fail(parsePackageZipV1(p.zip, URI, { maxArchiveBytes: Number.NaN }), 'PACKAGE_LIMIT_EXCEEDED', 'NaN envelope'); fail(parsePackageZipV1(p.zip, URI, { maxArchiveBytes: Number.POSITIVE_INFINITY }), 'PACKAGE_LIMIT_EXCEEDED', 'Infinity envelope'); fail(parsePackageZipV1(p.zip, URI, { maxArchiveBytes: p.zip.byteLength - 1 }), 'PACKAGE_LIMIT_EXCEEDED', 'archive envelope') } },
    { name: 'topology central budget applies to actual manifest entry', run: async () => { const topology = new Uint8Array(8 * 1024 * 1024 + 1); const p = await validPackage('topology/A_1F.topology.v1.sidecar', topology); fail(parsePackageZipV1(p.zip, URI), 'PACKAGE_LIMIT_EXCEEDED', 'topology 8MiB pre-unzip') } },
    { name: 'manifest parse depth 16 enters schema and 17 fails limit', run: () => { const document: Record<string, unknown> = { schema: 'space-model-package', schemaVersion: 1, packageId: 'p', revision: 'r', metadata: { schema: 'space-model-metadata', version: '3.3-semantic', carrier: 'GLB_SCENE_NODE_EXTRAS' }, assets: [], topology: {} }; let probe: unknown = {}; document.probe = probe; while (packageJsonDepth(document) < 16) { probe = [probe]; document.probe = probe }; const sixteen = parsePackageManifestV1(new TextEncoder().encode(JSON.stringify(document)), URI); fail(sixteen, 'PACKAGE_FIELD_INVALID', 'depth 16 schema'); probe = [probe]; document.probe = probe; fail(parsePackageManifestV1(new TextEncoder().encode(JSON.stringify(document)), URI), 'PACKAGE_LIMIT_EXCEEDED', 'depth 17 limit') } },
  ]
  const started = performance.now(); const names: string[] = []; for (const test of tests) { await test.run(); names.push(test.name) }
  return { passed: names.length, names, durationMs: performance.now() - started }
}

void crc32
