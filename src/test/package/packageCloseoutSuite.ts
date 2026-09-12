import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { strToU8, unzipSync, zipSync } from 'fflate'
import {
  parseMetadata33Glb,
  parsePackageManifestV1,
  parsePackageZipV1,
  prebindPackageTopologyV1,
  sanitizeManifestUri,
  sha256Hex,
  validatePackageArchive,
} from '../../adapters/package'

type Test = { name: string; run: () => void | Promise<void> }

interface MutableManifest {
  revision: string
  assets: Array<{
    assetId: string
    uri: string
    digest: { algorithm: 'SHA-256'; value: string }
  }>
  topology: {
    uri: string
    digest: { algorithm: 'SHA-256'; value: string }
    revision: string
  }
  [key: string]: unknown
}

interface MutableSidecarAsset {
  assetId: string
  uri: string
  digest?: { algorithm: 'SHA-256'; value: string }
  revision?: string
}

interface MutableSidecar {
  schema: string
  revision: string
  assets: MutableSidecarAsset[]
  nodes: Array<{ assetId: string; [key: string]: unknown }>
  edges: Array<{
    source: string
    target: string
    path?: { via?: Array<{ assetId: string; [key: string]: unknown }> }
    [key: string]: unknown
  }>
  [key: string]: unknown
}

const MANIFEST_URI = 'https://space.test/__space-model-package-v1/closeout/space-model-package.v1.json'
const FLOOR = { floorName: 'A_1F', building: 'A', level: 1, floorType: 'FLOOR' } as const
const fixtureUrl = new URL('./fixtures/standard-model-package-v1-success.zip', import.meta.url)
const GOLDEN = new Uint8Array(readFileSync(fileURLToPath(fixtureUrl))).slice()

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

function equal(actual: unknown, expected: unknown, message: string): void {
  if (!Object.is(actual, expected)) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`)
  }
}

function fail(
  result: { ok: boolean; diagnostic?: { code: string; phase?: string; path?: string; details?: Record<string, unknown> } },
  code: string,
  message: string,
): asserts result is { ok: false; diagnostic: { code: string; phase?: string; path?: string; details?: Record<string, unknown> } } {
  equal(result.ok, false, message)
  equal(result.diagnostic?.code, code, message)
}

function u16(bytes: Uint8Array, at: number): number {
  return bytes[at]! | bytes[at + 1]! << 8
}

function u32(bytes: Uint8Array, at: number): number {
  return (
    bytes[at]! |
    bytes[at + 1]! << 8 |
    bytes[at + 2]! << 16 |
    bytes[at + 3]! << 24
  ) >>> 0
}

function writeU32(bytes: Uint8Array, at: number, value: number): void {
  bytes[at] = value & 0xff
  bytes[at + 1] = value >>> 8 & 0xff
  bytes[at + 2] = value >>> 16 & 0xff
  bytes[at + 3] = value >>> 24 & 0xff
}

function normalizeZip(source: Uint8Array): Uint8Array {
  const result = source.slice()
  for (let at = 0; at + 4 < result.length;) {
    const signature = u32(result, at)
    if (signature === 0x04034b50) {
      const nameLength = u16(result, at + 26)
      const extraLength = u16(result, at + 28)
      const name = new TextDecoder().decode(result.subarray(at + 30, at + 30 + nameLength))
      let central = -1
      for (let scan = at + 30 + nameLength + extraLength; scan + 46 < result.length; scan += 1) {
        if (
          u32(result, scan) === 0x02014b50 &&
          new TextDecoder().decode(
            result.subarray(scan + 46, scan + 46 + u16(result, scan + 28)),
          ) === name
        ) {
          central = scan
          break
        }
      }
      if (central >= 0) {
        result[at + 6] &= 0xf7
        for (let offset = 0; offset < 12; offset += 1) {
          result[at + 14 + offset] = result[central + 16 + offset]!
        }
      }
      at += 30 + nameLength + extraLength + u32(result, at + 18)
    } else if (signature === 0x02014b50) {
      result[at + 8] &= 0xf7
      at += 46 + u16(result, at + 28) + u16(result, at + 30) + u16(result, at + 32)
    } else if (signature === 0x06054b50) {
      break
    } else {
      at += 1
    }
  }
  return result
}

function centralRecord(zip: Uint8Array, path: string): number {
  for (let at = 0; at + 46 <= zip.byteLength; at += 1) {
    if (u32(zip, at) !== 0x02014b50) continue
    const nameLength = u16(zip, at + 28)
    const name = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength))
    if (name === path) return at
  }
  throw new Error(`missing central record ${path}`)
}

function payloadOffset(zip: Uint8Array, central: number): number {
  const local = u32(zip, central + 42)
  return local + 30 + u16(zip, local + 26) + u16(zip, local + 28)
}

function jsonChunk(document: unknown): Uint8Array {
  const encoded = new TextEncoder().encode(JSON.stringify(document))
  const result = new Uint8Array((encoded.byteLength + 3) & ~3)
  result.fill(0x20)
  result.set(encoded)
  return result
}

function glb(document: Record<string, unknown>, binLength = 12): Uint8Array {
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

function metadataDocument(options: {
  renderType?: string
  sid?: string
  conditional?: Record<string, unknown>
  bufferView?: Record<string, unknown>
  images?: unknown[]
  extraNodes?: unknown[]
} = {}): Record<string, unknown> {
  const renderType = options.renderType ?? 'WALL'
  const sid = options.sid ?? 'WALL_A_1F_01'
  return {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0], extras: { ...FLOOR, name: 'A floor 1' } }],
    nodes: [{
      mesh: 0,
      extras: {
        name: 'entity',
        sid,
        findId: 'A_1F_mesh_0',
        renderType,
        renderTypeConfidence: 'high',
        ...FLOOR,
        ...options.conditional,
      },
    }, ...(options.extraNodes ?? [])],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 1, type: 'VEC3' }],
    bufferViews: [{ buffer: 0, byteLength: 12, ...options.bufferView }],
    buffers: [{ byteLength: 12 }],
    ...(options.images === undefined ? {} : { images: options.images }),
  }
}

function manifestSource(assetUri: string, topologyUri = './topology.v1.json'): Record<string, unknown> {
  return {
    schema: 'space-model-package',
    schemaVersion: 1,
    packageId: 'closeout',
    revision: 'r1',
    metadata: {
      schema: 'space-model-metadata',
      version: '3.3-semantic',
      carrier: 'GLB_SCENE_NODE_EXTRAS',
    },
    assets: [{
      assetId: 'asset-a',
      uri: assetUri,
      digest: { algorithm: 'SHA-256', value: 'a'.repeat(64) },
      floor: FLOOR,
    }],
    topology: {
      uri: topologyUri,
      digest: { algorithm: 'SHA-256', value: 'b'.repeat(64) },
      schema: 'space-ai-platform/topology-sidecar',
      schemaVersion: 1,
      revision: 'r1',
    },
  }
}

async function rewriteGoldenTopology(
  mutate: (manifest: MutableManifest, sidecar: MutableSidecar) => Uint8Array | void,
): Promise<Uint8Array> {
  const files = unzipSync(GOLDEN)
  const manifest = JSON.parse(
    new TextDecoder().decode(files['space-model-package.v1.json']!),
  ) as MutableManifest
  const sidecar = JSON.parse(
    new TextDecoder().decode(files['topology.v1.json']!),
  ) as MutableSidecar
  const replacement = mutate(manifest, sidecar)
  files['topology.v1.json'] = replacement === undefined ? strToU8(JSON.stringify(sidecar)) : new Uint8Array(replacement)
  manifest.topology.digest.value = await sha256Hex(files['topology.v1.json']!)
  files['space-model-package.v1.json'] = strToU8(JSON.stringify(manifest))
  return normalizeZip(zipSync(files))
}

async function bindGoldenMutation(
  mutate: (manifest: MutableManifest, sidecar: MutableSidecar) => Uint8Array | void,
) {
  const parsed = parsePackageZipV1(await rewriteGoldenTopology(mutate), MANIFEST_URI)
  assert(parsed.ok, `mutated package archive should parse: ${JSON.stringify(parsed)}`)
  const metadata = await validatePackageArchive(parsed.value)
  assert(metadata.ok, `mutated package resources should validate: ${JSON.stringify(metadata)}`)
  return prebindPackageTopologyV1(parsed.value, metadata.value)
}

const tests: Test[] = [
  {
    name: 'bounded inflate rejects forged small declarations and validates actual CRC',
    run: async () => {
      const files = unzipSync(GOLDEN)
      const manifest = JSON.parse(
        new TextDecoder().decode(files['space-model-package.v1.json']!),
      ) as MutableManifest
      const bomb = new Uint8Array(2 * 1024 * 1024)
      bomb.fill(0x20)
      files['topology.v1.json'] = bomb
      manifest.topology.digest.value = await sha256Hex(bomb)
      files['space-model-package.v1.json'] = strToU8(JSON.stringify(manifest))
      const forged = normalizeZip(zipSync(files))
      const topologyCentral = centralRecord(forged, 'topology.v1.json')
      assert(u16(forged, topologyCentral + 10) === 8, 'bomb entry must use deflate')
      const topologyLocal = u32(forged, topologyCentral + 42)
      writeU32(forged, topologyCentral + 24, 1)
      writeU32(forged, topologyLocal + 22, 1)
      const bombResult = parsePackageZipV1(forged, MANIFEST_URI)
      fail(bombResult, 'PACKAGE_LIMIT_EXCEEDED', 'forged output declaration')
      equal(
        bombResult.diagnostic.details?.reason,
        'actual-size-exceeds-declaration',
        'forged declaration reason',
      )

      const crcFiles = unzipSync(GOLDEN)
      const crcManifest = JSON.parse(
        new TextDecoder().decode(crcFiles['space-model-package.v1.json']!),
      ) as MutableManifest
      const topology = crcFiles['topology.v1.json']!.slice()
      crcManifest.topology.digest.value = await sha256Hex(topology)
      crcFiles['space-model-package.v1.json'] = strToU8(JSON.stringify(crcManifest))
      const stored = normalizeZip(zipSync({
        ...crcFiles,
        'topology.v1.json': [topology, { level: 0 }],
      }))
      const storedCentral = centralRecord(stored, 'topology.v1.json')
      assert(u16(stored, storedCentral + 10) === 0, 'CRC probe must be stored')
      stored[payloadOffset(stored, storedCentral)]! ^= 1
      const crcResult = parsePackageZipV1(stored, MANIFEST_URI)
      fail(crcResult, 'PACKAGE_JSON_INVALID', 'actual CRC mismatch')
      equal(crcResult.diagnostic.details?.reason, 'actual-crc-mismatch', 'actual CRC reason')
    },
  },
  {
    name: 'root-relative URIs pass while origin, escape, encoded alias, query, and fragment fail',
    run: () => {
      const root = parsePackageManifestV1(
        strToU8(JSON.stringify(manifestSource('/A.glb', '/topology.v1.json'))),
        MANIFEST_URI,
      )
      assert(root.ok, 'root-relative manifest resources')
      equal(root.value.assets[0]!.canonicalUri, 'https://space.test/A.glb', 'root asset URI')
      equal(root.value.topology.canonicalUri, 'https://space.test/topology.v1.json', 'root topology URI')
      for (const [label, uri] of [
        ['cross-origin', 'https://evil.test/A.glb'],
        ['escape', '../A.glb'],
        ['encoded-alias', './%41.glb'],
        ['query', './A.glb?token=secret'],
        ['fragment', './A.glb#node'],
      ] as const) {
        fail(
          parsePackageManifestV1(strToU8(JSON.stringify(manifestSource(uri))), MANIFEST_URI),
          'PACKAGE_URI_INVALID',
          label,
        )
      }
    },
  },
  {
    name: 'root-relative manifest assets and topology resolve to ZIP archive root entries',
    run: () => {
      const files = unzipSync(GOLDEN)
      const manifest = JSON.parse(
        new TextDecoder().decode(files['space-model-package.v1.json']!),
      ) as MutableManifest
      for (const asset of manifest.assets) asset.uri = `/${asset.uri.replace(/^\.\//u, '')}`
      manifest.topology.uri = '/topology.v1.json'
      files['space-model-package.v1.json'] = strToU8(JSON.stringify(manifest))
      const result = parsePackageZipV1(normalizeZip(zipSync(files)), MANIFEST_URI)
      assert(result.ok, `root-relative archive package: ${JSON.stringify(result)}`)
      equal(result.value.assets[0]!.path, 'A_B1.glb', 'first root asset path')
      equal(result.value.assets[1]!.path, 'A_1F.glb', 'second root asset path')
      equal(result.value.topology.path, 'topology.v1.json', 'root topology path')
    },
  },
  {
    name: 'malformed diagnostic authorities and credentials are always redacted',
    run: () => {
      equal(sanitizeManifestUri('https://user:secret@[invalid/path?token=x'), '[redacted]', 'malformed authority')
      equal(sanitizeManifestUri('https://user:secret@'), '[redacted]', 'malformed userinfo')
      const sanitized = sanitizeManifestUri('https://user:secret@space.test/path?token=x#fragment')
      equal(sanitized, 'https://space.test/path', 'valid URI strips credentials/query/fragment')
      assert(!String(sanitized).includes('secret'), 'credential must not survive sanitization')
      const invalidManifest = parsePackageManifestV1(
        strToU8(JSON.stringify(manifestSource('./A.glb'))),
        'https://user:secret@[invalid/space-model-package.v1.json',
      )
      fail(invalidManifest, 'PACKAGE_URI_INVALID', 'malformed manifest URI')
      equal(invalidManifest.diagnostic.manifestUri, '[redacted]', 'malformed diagnostic URI')
    },
  },
  {
    name: 'Metadata 3.3 SID ordinals, direction, and subtype match Studio semantics',
    run: () => {
      const door = (sid: string) => parseMetadata33Glb(glb(metadataDocument({ renderType: 'DOOR', sid, conditional: { direction: 'NE' } })), FLOOR)
      assert(door('DOOR_A_1F_NE_01').ok, '01 ordinal')
      assert(door('DOOR_A_1F_NE_10').ok, '10 ordinal')
      assert(door('DOOR_A_1F_NE_100').ok, 'three digits without leading zero')
      for (const sid of ['DOOR_A_1F_NE_1', 'DOOR_A_1F_NE_001', 'DOOR_A_1F_NE_00', 'DOOR_A_1F_BAD_01']) {
        fail(door(sid), 'PACKAGE_METADATA_INVALID', sid)
      }
      assert(parseMetadata33Glb(glb(metadataDocument({
        renderType: 'SPACE',
        sid: 'SPACE_A_1F_OFFICE_01',
        conditional: { spaceType: 'OFFICE' },
      })), FLOOR).ok, 'valid SPACE subtype')
      for (const sid of ['SPACE_A_1F_NE_OFFICE_01', 'SPACE_A_1F_UNKNOWN_01']) {
        fail(parseMetadata33Glb(glb(metadataDocument({
          renderType: 'SPACE',
          sid,
          conditional: { spaceType: sid.includes('UNKNOWN') ? 'UNKNOWN' : 'OFFICE' },
        })), FLOOR), 'PACKAGE_METADATA_INVALID', sid)
      }
      fail(parseMetadata33Glb(glb(metadataDocument({
        renderType: 'FACILITY',
        sid: 'FACILITY_A_1F_UNKNOWN_01',
        conditional: { fireType: 'UNKNOWN' },
      })), FLOOR), 'PACKAGE_METADATA_INVALID', 'invalid FACILITY subtype')
      fail(parseMetadata33Glb(glb(metadataDocument({ sid: 'WALL_A_1F_N_01' })), FLOOR), 'PACKAGE_METADATA_INVALID', 'WALL direction')
    },
  },
  {
    name: 'Metadata 3.3 enforces byteStride and self-contained image source/MIME boundaries',
    run: () => {
      assert(parseMetadata33Glb(glb(metadataDocument({ bufferView: { byteStride: 12 } })), FLOOR).ok, 'valid byteStride')
      for (const byteStride of [10, 256]) {
        fail(
          parseMetadata33Glb(glb(metadataDocument({ bufferView: { byteStride } })), FLOOR),
          'PACKAGE_METADATA_INVALID',
          `byteStride ${String(byteStride)}`,
        )
      }
      assert(parseMetadata33Glb(glb(metadataDocument({
        images: [{ uri: 'data:image/png;base64,AA==' }],
      })), FLOOR).ok, 'data image')
      assert(parseMetadata33Glb(glb(metadataDocument({
        images: [{ bufferView: 0, mimeType: 'image/png' }],
      })), FLOOR).ok, 'bufferView image')
      for (const images of [
        [{ uri: 'https://evil.test/a.png' }],
        [{ uri: 'data:text/plain;base64,AA==' }],
        [{ bufferView: 0 }],
        [{ uri: 'data:image/png;base64,AA==', mimeType: 'image/png' }],
        [{ uri: 'data:image/png;base64,AA==', bufferView: 0, mimeType: 'image/png' }],
      ]) {
        fail(
          parseMetadata33Glb(glb(metadataDocument({ images })), FLOOR),
          'PACKAGE_METADATA_INVALID',
          `image ${JSON.stringify(images)}`,
        )
      }
    },
  },
  {
    name: 'every Metadata 3.3 node semantic field is forbidden on unreachable non-mesh nodes',
    run: () => {
      const semanticValues: Record<string, unknown> = {
        name: 'semantic name',
        sid: 'WALL_A_1F_02',
        findId: 'A_1F_mesh_1',
        renderType: 'WALL',
        renderTypeConfidence: 'high',
        floorName: 'A_1F',
        building: 'A',
        level: 1,
        floorType: 'FLOOR',
        spaceType: 'OFFICE',
        fireType: 'HYDRANT',
        direction: 'N',
      }
      for (const [field, value] of Object.entries(semanticValues)) {
        const result = parseMetadata33Glb(glb(metadataDocument({
          extraNodes: [{ extras: { [field]: value } }],
        })), FLOOR)
        fail(result, 'PACKAGE_METADATA_INVALID', `non-mesh ${field}`)
        equal(result.diagnostic.details?.reason, 'non-mesh-semantic-fields', `non-mesh ${field} reason`)
      }
    },
  },
  {
    name: 'strict full sidecar fixtures cover parse, schema, revision, asset sets, URI, and digest',
    run: async () => {
      const malformed = await bindGoldenMutation(() => strToU8('{'))
      assert(!malformed.ok && malformed.kind === 'sidecar', 'malformed sidecar kind')
      equal(malformed.diagnostic.code, 'SIDECAR_JSON_INVALID', 'malformed sidecar code')

      const schema = await bindGoldenMutation((_manifest, sidecar) => { sidecar.schema = 'unknown/schema' })
      assert(!schema.ok && schema.kind === 'sidecar', 'schema sidecar kind')
      equal(schema.diagnostic.code, 'SIDECAR_SCHEMA_UNSUPPORTED', 'schema sidecar code')

      const revision = await bindGoldenMutation((_manifest, sidecar) => { sidecar.revision = 'wrong-revision' })
      assert(!revision.ok && revision.kind === 'package', 'revision package kind')
      equal(revision.diagnostic.code, 'PACKAGE_REVISION_MISMATCH', 'revision mismatch code')

      const missing = await bindGoldenMutation((_manifest, sidecar) => {
        const removed = sidecar.assets.shift()!
        sidecar.nodes = sidecar.nodes.filter((node) => node.assetId !== removed.assetId)
        const retainedNodes = new Set(sidecar.nodes.map((node) => String(node.id)))
        sidecar.edges = sidecar.edges.filter((edge) => retainedNodes.has(edge.source) && retainedNodes.has(edge.target))
      })
      assert(!missing.ok && missing.kind === 'package', 'missing asset package kind')
      equal(missing.diagnostic.code, 'PACKAGE_TOPOLOGY_PROJECTION_MISMATCH', 'missing asset code')

      const extra = await bindGoldenMutation((_manifest, sidecar) => {
        sidecar.assets.push({
          assetId: 'extra-asset',
          uri: './extra.glb',
          digest: { algorithm: 'SHA-256', value: '0'.repeat(64) },
        })
      })
      assert(!extra.ok && extra.kind === 'package', 'extra asset package kind')
      equal(extra.diagnostic.code, 'PACKAGE_TOPOLOGY_PROJECTION_MISMATCH', 'extra asset code')

      const duplicate = await bindGoldenMutation((_manifest, sidecar) => {
        sidecar.assets.push({ ...sidecar.assets[0]! })
      })
      assert(!duplicate.ok && duplicate.kind === 'sidecar', 'duplicate asset sidecar kind')
      equal(duplicate.diagnostic.code, 'SIDECAR_DUPLICATE_ID', 'duplicate asset code')

      for (const [label, mutate] of [
        ['URI', (_manifest: MutableManifest, sidecar: MutableSidecar) => { sidecar.assets[0]!.uri = './wrong.glb' }],
        ['digest', (_manifest: MutableManifest, sidecar: MutableSidecar) => { sidecar.assets[0]!.digest!.value = '0'.repeat(64) }],
      ] as const) {
        const mismatch = await bindGoldenMutation(mutate)
        assert(!mismatch.ok && mismatch.kind === 'package', `${label} mismatch package kind`)
        equal(mismatch.diagnostic.code, 'PACKAGE_TOPOLOGY_PROJECTION_MISMATCH', `${label} mismatch code`)
      }
    },
  },
  {
    name: 'independent topology-byte tamper reports PACKAGE_DIGEST_MISMATCH HASH topology path',
    run: async () => {
      const files = unzipSync(GOLDEN)
      files['topology.v1.json'] = files['topology.v1.json']!.slice()
      files['topology.v1.json']![files['topology.v1.json']!.byteLength - 2] ^= 1
      const parsed = parsePackageZipV1(normalizeZip(zipSync(files)), MANIFEST_URI)
      assert(parsed.ok, 'tampered topology ZIP integrity is internally valid')
      const result = await validatePackageArchive(parsed.value)
      fail(result, 'PACKAGE_DIGEST_MISMATCH', 'topology digest mismatch')
      equal(result.diagnostic.phase, 'HASH', 'topology digest phase')
      equal(result.diagnostic.path, '/topology/digest', 'topology digest path')
    },
  },
]

export async function runPackageCloseoutSuite(): Promise<{
  passed: number
  names: readonly string[]
  durationMs: number
}> {
  const started = performance.now()
  const names: string[] = []
  for (const test of tests) {
    await test.run()
    names.push(test.name)
  }
  return { passed: names.length, names: Object.freeze(names), durationMs: performance.now() - started }
}
