import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import { strToU8, unzipSync, zipSync } from 'fflate'
import {
  compileTopologySidecarV1,
  type TopologySidecarCompileContext,
  type TopologySidecarCompileResult,
  type TopologySidecarDiagnostic,
} from '@/adapters/topology'
import { sha256Hex } from '@/adapters/package'
import type { ModelRecord } from '@/composables/useModelLibrary'
import { createTopologyTool } from '@/ssp/topology/topologyTool'
import type { TopologyGraphInput, TopologyGraphSnapshot } from '@/ssp/topology/types'
import {
  createTopologySceneLifecycle,
  type TopologyCachePort,
  type TopologyFetchResponse,
  type TopologyFloorInfo,
  type TopologySceneSessionSnapshot,
} from '@/topology/sceneLifecycle'
import {
  createPackageV2GlbFixture,
  type PackageV2FixtureFloor,
} from './packageV2Suite'

type Test = { name: string; run: () => void | Promise<void> }

interface FixtureIndex {
  authoritativeSuccessPackage: {
    sha256: string
    byteLength: number
    routeAssertion: {
      sourceNodeId: string
      targetNodeId: string
      edgeId: string
      mode: string
    }
  }
}

interface MutableManifestAsset {
  assetId: string
  uri: string
  digest: { algorithm: 'SHA-256'; value: string }
  floor: { floorName: string; building: string | null; level: number | null; floorType: string }
}

interface MutableManifest {
  packageId: string
  revision: string
  assets: MutableManifestAsset[]
  topology: {
    uri: string
    digest: { algorithm: 'SHA-256'; value: string }
    revision: string
    schema?: string
    schemaVersion?: number
  }
}

interface MutableSidecarAsset {
  assetId: string
  uri: string
  digest: { algorithm: 'SHA-256'; value: string }
  revision?: string
}

interface MutableSidecar {
  revision: string
  assets: MutableSidecarAsset[]
  nodes: Array<{ assetId: string; [key: string]: unknown }>
  edges: Array<{
    path?: { via?: Array<{ assetId: string; [key: string]: unknown }> }
    [key: string]: unknown
  }>
  [key: string]: unknown
}

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(reason: unknown): void
}

interface LoadCall {
  readonly url: string
  readonly key: string
  readonly bytes: ArrayBuffer | null
  readonly cacheHit: boolean
  readonly callNumber: number
}

type FloorInfoIdentityOverride = Partial<Pick<
  TopologyFloorInfo,
  'floorName' | 'building' | 'level' | 'floorType'
>>

const fixtureUrl = new URL('./fixtures/standard-model-package-v1-success.zip', import.meta.url)
const indexUrl = new URL('./fixtures/standard-model-package-v1.sha256.json', import.meta.url)
const GOLDEN = new Uint8Array(readFileSync(fileURLToPath(fixtureUrl))).slice()
const INDEX = JSON.parse(readFileSync(fileURLToPath(indexUrl), 'utf8')) as FixtureIndex
const GOLDEN_FILES = unzipSync(GOLDEN)
const GOLDEN_MANIFEST = JSON.parse(
  new TextDecoder().decode(GOLDEN_FILES['space-model-package.v1.json']!),
) as MutableManifest
const BUILDING_SOURCE_V1 = new Uint8Array(readFileSync(fileURLToPath(new URL(
  './fixtures/building-source-profile-v1.1/A-standard-model-package-v1.zip',
  import.meta.url,
)))).slice()
const BUILDING_SOURCE_V1_FILES = unzipSync(BUILDING_SOURCE_V1)
const BUILDING_SOURCE_V1_MANIFEST = JSON.parse(new TextDecoder().decode(
  BUILDING_SOURCE_V1_FILES['space-model-package.v1.json']!,
)) as MutableManifest
const APP_ORIGIN = 'https://space.test'
const CLEANUP_ORDER = ['routes', 'graphs', 'legacy', 'models'] as const

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

function equal(actual: unknown, expected: unknown, message: string): void {
  if (!Object.is(actual, expected)) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`)
  }
}

function deepEqual(actual: unknown, expected: unknown, message: string): void {
  const actualJson = JSON.stringify(actual)
  const expectedJson = JSON.stringify(expected)
  if (actualJson !== expectedJson) {
    throw new Error(`${message}: expected ${expectedJson}, got ${actualJson}`)
  }
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

async function until(predicate: () => boolean, message: string): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) return
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  throw new Error(message)
}

function normalizeZip(source: Uint8Array): Uint8Array {
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
          new TextDecoder().decode(
            result.subarray(scan + 46, scan + 46 + u16(scan + 28)),
          ) === name
        ) {
          central = scan
          break
        }
      }
      if (central > 0) {
        result[at + 6] &= 0xf7
        result[at + 14] = result[central + 16]!
        result[at + 15] = result[central + 17]!
        result[at + 16] = result[central + 18]!
        result[at + 17] = result[central + 19]!
        for (let offset = 0; offset < 8; offset += 1) {
          result[at + 18 + offset] = result[central + 20 + offset]!
        }
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

async function rewriteGolden(
  mutate: (
    manifest: MutableManifest,
    sidecar: MutableSidecar,
    files: Record<string, Uint8Array>,
  ) => void,
  options: { rewriteTopology?: boolean } = { rewriteTopology: true },
): Promise<Uint8Array> {
  const files = unzipSync(GOLDEN)
  const manifest = JSON.parse(
    new TextDecoder().decode(files['space-model-package.v1.json']!),
  ) as MutableManifest
  const sidecar = JSON.parse(
    new TextDecoder().decode(files['topology.v1.json']!),
  ) as MutableSidecar
  mutate(manifest, sidecar, files)
  if (options.rewriteTopology !== false) {
    files['topology.v1.json'] = strToU8(JSON.stringify(sidecar))
    manifest.topology.digest.value = await sha256Hex(files['topology.v1.json']!)
  }
  files['space-model-package.v1.json'] = strToU8(JSON.stringify(manifest))
  return normalizeZip(zipSync(files))
}

function jsonGlb(document: Record<string, unknown>): Uint8Array {
  const encoded = new TextEncoder().encode(JSON.stringify(document))
  const paddedLength = (encoded.byteLength + 3) & ~3
  const bytes = new Uint8Array(20 + paddedLength)
  bytes.fill(0x20, 20)
  bytes.set(encoded, 20)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, bytes.byteLength, true)
  view.setUint32(12, paddedLength, true)
  view.setUint32(16, 0x4e4f534a, true)
  return bytes
}

function response(options: {
  url: string
  status?: number
  bytes?: ArrayBuffer
  text?: string
}): TopologyFetchResponse {
  const status = options.status ?? 200
  return {
    ok: status >= 200 && status < 300,
    status,
    redirected: false,
    url: options.url,
    arrayBuffer: async () => options.bytes ?? new ArrayBuffer(0),
    text: async () => options.text ?? '',
  }
}

function compileFailure(): TopologySidecarCompileResult {
  const value: TopologySidecarDiagnostic = {
    code: 'SIDECAR_FIELD_INVALID',
    phase: 'COMPILE',
    message: 'injected package compile failure',
    path: '/nodes',
    sidecarUri: `${APP_ORIGIN}/topology.v1.json`,
    assetId: null,
    entityId: null,
    details: {},
  }
  return { ok: false, diagnostics: [value] }
}

function transportUrl(sessionId: string, index: number): string {
  const digest = GOLDEN_MANIFEST.assets[index]!.digest.value
  return `${APP_ORIGIN}/__space-model-package-v1/${sessionId}/.transport/` +
    `${sessionId}-${String(index).padStart(3, '0')}-${digest.slice(0, 16)}.glb`
}

function createHarness(options: {
  sessionIds?: readonly string[]
  floorIdentitiesBySession?: ReadonlyMap<string, readonly MutableManifestAsset['floor'][]>
  loadGates?: ReadonlyMap<string, Deferred<void>>
  ignoreUnloadGenerationForSessions?: ReadonlySet<string>
  loadFailureCall?: number
  floorNameMismatchCall?: number
  floorInfoOverridesByCall?: ReadonlyMap<number, FloorInfoIdentityOverride>
  preciseUnloadFailure?: boolean
  compileFailure?: boolean
  createGraphFailure?: boolean
} = {}) {
  const scene = new THREE.Scene()
  const topology = createTopologyTool()
  const states: TopologySceneSessionSnapshot[] = []
  const loadCalls: LoadCall[] = []
  const cleanupEvents: string[] = []
  const compileContexts: TopologySidecarCompileContext[] = []
  const compileRootCounts: number[] = []
  const createGraphRootCounts: number[] = []
  const fetchResources = new Map<string, { bytes?: ArrayBuffer; text?: string }>()
  const modelRecords = new Map<string, TopologyFloorInfo>()
  const preciseUnloadCalls: string[] = []
  const cache: TopologyCachePort = {
    enabled: false,
    files: Object.create(null) as Record<string, unknown>,
    add(key, value) {
      if (this.enabled) this.files[key] = value
    },
  }
  const sessionIds = [...(options.sessionIds ?? ['package_session_0001'])]
  let sessionIndex = 0
  let modelEpoch = 0
  let inFlightLoads = 0
  let peakInFlightLoads = 0

  const lifecycle = createTopologySceneLifecycle({
    origin: APP_ORIGIN,
    fetch: async (url) => {
      const absolute = new URL(url, APP_ORIGIN).href
      const resource = fetchResources.get(absolute)
      if (resource === undefined) return response({ url: absolute, status: 404 })
      return response({ url: absolute, ...resource })
    },
    digestSha256: async (bytes) => sha256Hex(new Uint8Array(bytes)),
    cache,
    resolveLoaderUrl: (url) => url,
    loadFloor: async (url) => {
      const key = new URL(url, APP_ORIGIN).pathname.split('/').at(-1)!
      const cached = cache.files[url]
      const callNumber = loadCalls.length + 1
      loadCalls.push({
        url,
        key,
        bytes: cached instanceof ArrayBuffer ? cached : null,
        cacheHit: cached instanceof ArrayBuffer,
        callNumber,
      })
      const epoch = modelEpoch
      const parts = new URL(url, APP_ORIGIN).pathname.split('/')
      const packageSession = parts[1] === '__space-model-package-v1' ? parts[2] : undefined
      const transportMatch = /-(\d{3})-[0-9a-f]{16}\.glb$/u.exec(key)
      const assetIndex = transportMatch === null ? null : Number(transportMatch[1])
      inFlightLoads += 1
      peakInFlightLoads = Math.max(peakInFlightLoads, inFlightLoads)
      try {
        const gate = packageSession === undefined ? undefined : options.loadGates?.get(packageSession)
        if (gate !== undefined) await gate.promise
        await Promise.resolve()
        if (
          epoch !== modelEpoch &&
          !options.ignoreUnloadGenerationForSessions?.has(packageSession ?? '')
        ) {
          throw new Error('load invalidated by modelTool generation')
        }
        if (options.loadFailureCall === callNumber) throw new Error('injected load failure')
        const floor = packageSession === undefined || assetIndex === null
          ? undefined
          : options.floorIdentitiesBySession?.get(packageSession)?.[assetIndex] ??
            GOLDEN_MANIFEST.assets[assetIndex]!.floor
        const expectedFloorName = floor?.floorName ?? key.replace(/\.glb$/iu, '')
        const floorName = options.floorNameMismatchCall === callNumber
          ? `${expectedFloorName}-mismatch`
          : expectedFloorName
        const identityOverride = options.floorInfoOverridesByCall?.get(callNumber)
        const hasIdentityOverride = (key: keyof FloorInfoIdentityOverride): boolean =>
          identityOverride !== undefined && Object.prototype.hasOwnProperty.call(identityOverride, key)
        const root = new THREE.Group()
        root.name = floorName
        scene.add(root)
        const info: TopologyFloorInfo = {
          floorName: hasIdentityOverride('floorName') ? identityOverride!.floorName! : floorName,
          building: hasIdentityOverride('building') ? identityOverride!.building : floor?.building,
          level: hasIdentityOverride('level') ? identityOverride!.level : floor?.level,
          floorType: hasIdentityOverride('floorType') ? identityOverride!.floorType : floor?.floorType,
          url,
          root,
        }
        modelRecords.set(key, info)
        return info
      } finally {
        inFlightLoads -= 1
      }
    },
    unloadFloor: (transportKey) => {
      preciseUnloadCalls.push(transportKey)
      modelEpoch += 1
      if (options.preciseUnloadFailure === true) throw new Error('injected precise unload failure')
      const info = modelRecords.get(`${transportKey}.glb`)
      if (info === undefined) return
      scene.remove(info.root)
      modelRecords.delete(`${transportKey}.glb`)
    },
    getScene: () => scene,
    compileSidecar: (text, context) => {
      compileContexts.push(context)
      compileRootCounts.push(modelRecords.size)
      return options.compileFailure === true
        ? compileFailure()
        : compileTopologySidecarV1(text, context)
    },
    createGraph: (input: TopologyGraphInput): TopologyGraphSnapshot => {
      createGraphRootCounts.push(modelRecords.size)
      const snapshot = topology.createGraph(input)
      if (options.createGraphFailure === true) throw new Error('injected createGraph failure')
      return snapshot
    },
    getGraph: (id) => topology.getGraph(id),
    removeGraph: (id) => topology.removeGraph(id),
    removeAllRoutes: () => {
      cleanupEvents.push('routes')
      return topology.removeAllRoutes()
    },
    removeAllGraphs: () => {
      cleanupEvents.push('graphs')
      return topology.removeAllGraphs()
    },
    removeAllLegacyTopologies: () => {
      cleanupEvents.push('legacy')
      return 0
    },
    unloadAllModels: () => {
      cleanupEvents.push('models')
      modelEpoch += 1
      for (const info of modelRecords.values()) scene.remove(info.root)
      modelRecords.clear()
    },
    assetConcurrency: 3,
    createPackageSessionId: () => sessionIds[sessionIndex++] ?? `package_session_${sessionIndex}`,
  }, (state) => states.push(state))

  return {
    lifecycle,
    topology,
    scene,
    cache,
    states,
    loadCalls,
    cleanupEvents,
    compileContexts,
    compileRootCounts,
    createGraphRootCounts,
    fetchResources,
    modelRecords,
    preciseUnloadCalls,
    get peakInFlightLoads() { return peakInFlightLoads },
  }
}

async function createNullSpecialV1Package(): Promise<{
  readonly zip: Uint8Array
  readonly manifest: MutableManifest
  readonly floors: readonly PackageV2FixtureFloor[]
}> {
  const floors = Object.freeze([
    Object.freeze({ floorName: 'A_T', building: 'A', level: null, floorType: 'TOWER' }),
    Object.freeze({ floorName: 'A_RF', building: 'A', level: null, floorType: 'ROOF' }),
  ] satisfies PackageV2FixtureFloor[])
  const models = floors.map((floor) => createPackageV2GlbFixture(floor))
  const assetFacts = await Promise.all(models.map(async (bytes, index) => ({
    assetId: index === 0 ? 'scene/a/tower' : 'scene/a/roof',
    uri: index === 0 ? './A_T.glb' : './A_RF.glb',
    digest: { algorithm: 'SHA-256' as const, value: await sha256Hex(bytes) },
    floor: floors[index]!,
  })))
  const sidecar = strToU8(JSON.stringify({
    schema: 'space-ai-platform/topology-sidecar',
    schemaVersion: 1,
    revision: 'special-null-r1',
    graphId: 'scene/a/special-null-levels',
    coordinateSpace: 'ASSET_LOCAL',
    unit: 'meter',
    upAxis: 'Y',
    assets: assetFacts.map(({ assetId, uri, digest }) => ({ assetId, uri, digest })),
    layers: [{ id: 'layer/tower' }, { id: 'layer/roof' }],
    nodes: [
      { id: 'tower-start', layerId: 'layer/tower', assetId: 'scene/a/tower', position: { x: 0, y: 0, z: 0 } },
      { id: 'tower-goal', layerId: 'layer/tower', assetId: 'scene/a/tower', position: { x: 1, y: 0, z: 0 } },
      { id: 'roof-marker', layerId: 'layer/roof', assetId: 'scene/a/roof', position: { x: 0, y: 0, z: 0 } },
    ],
    edges: [{ id: 'tower-edge', source: 'tower-start', target: 'tower-goal', relation: 'LINK', direction: 'BIDIRECTIONAL' }],
    connectors: [],
    blockers: [],
  }))
  const manifest: MutableManifest & Record<string, unknown> = {
    schema: 'space-model-package',
    schemaVersion: 1,
    packageId: 'scene/a/special-null-levels',
    revision: 'special-null-r1',
    metadata: { schema: 'space-model-metadata', version: '3.3-semantic', carrier: 'GLB_SCENE_NODE_EXTRAS' },
    assets: assetFacts,
    topology: {
      uri: './topology.v1.json',
      digest: { algorithm: 'SHA-256', value: await sha256Hex(sidecar) },
      revision: 'special-null-r1',
      schema: 'space-ai-platform/topology-sidecar',
      schemaVersion: 1,
    },
  }
  return {
    zip: normalizeZip(zipSync({
      'space-model-package.v1.json': strToU8(JSON.stringify(manifest)),
      'A_T.glb': models[0]!,
      'A_RF.glb': models[1]!,
      'topology.v1.json': sidecar,
    })),
    manifest,
    floors,
  }
}

async function installLegacyFixture(harness: ReturnType<typeof createHarness>): Promise<ModelRecord> {
  const record: ModelRecord = {
    kind: 'file',
    subcategory: 'legacy',
    filename: 'legacy.glb',
    url: '/models/legacy/legacy.glb',
    displayName: 'Legacy',
    sizeBytes: 64,
    sizeMB: 0.01,
    mtime: 1,
  }
  const bytes = jsonGlb({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [] }] })
  const digest = await sha256Hex(bytes)
  const sidecar = JSON.stringify({
    schema: 'space-ai-platform/topology-sidecar',
    schemaVersion: 1,
    revision: 'legacy-revision',
    graphId: 'legacy-graph',
    coordinateSpace: 'ASSET_LOCAL',
    unit: 'meter',
    upAxis: 'Y',
    assets: [{
      assetId: 'legacy-asset',
      uri: record.url,
      digest: { algorithm: 'SHA-256', value: digest },
    }],
    layers: [{ id: 'legacy-layer' }],
    nodes: [
      { id: 'legacy-start', layerId: 'legacy-layer', assetId: 'legacy-asset', position: { x: 0, y: 0, z: 0 } },
      { id: 'legacy-goal', layerId: 'legacy-layer', assetId: 'legacy-asset', position: { x: 1, y: 0, z: 0 } },
    ],
    edges: [{
      id: 'legacy-edge',
      source: 'legacy-start',
      target: 'legacy-goal',
      relation: 'LINK',
      direction: 'BIDIRECTIONAL',
    }],
    connectors: [],
    blockers: [],
  })
  harness.fetchResources.set(`${APP_ORIGIN}${record.url}`, { bytes: bytes.slice().buffer as ArrayBuffer })
  harness.fetchResources.set(`${APP_ORIGIN}/models/legacy/legacy.topology.v1.json`, { text: sidecar })
  return record
}

function assertStrictCleanup(harness: ReturnType<typeof createHarness>, message: string): void {
  deepEqual(harness.cleanupEvents.slice(-4), CLEANUP_ORDER, `${message} cleanup order`)
  equal(harness.topology.listGraphs().length, 0, `${message} graphs`)
  equal(harness.modelRecords.size, 0, `${message} model records`)
  equal(harness.scene.children.length, 0, `${message} scene roots`)
  equal(harness.lifecycle.snapshot.packageSession, null, `${message} package mapping`)
}

const tests: Test[] = [
  {
    name: 'authority four-floor v1 ZIP publishes exact nullable identities proofs and graph then cleans up',
    run: async () => {
      const sessionId = 'building_source_v1_session'
      const harness = createHarness({
        sessionIds: [sessionId],
        floorIdentitiesBySession: new Map([[
          sessionId,
          BUILDING_SOURCE_V1_MANIFEST.assets.map((asset) => asset.floor),
        ]]),
      })
      const result = await harness.lifecycle.selectPackage(BUILDING_SOURCE_V1.slice())
      equal(result.kind, 'loaded', 'authority v1 selection')
      equal(harness.lifecycle.snapshot.status, 'ready', 'authority v1 graph state')
      equal(
        harness.lifecycle.snapshot.graphId,
        '00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002/topology',
        'authority v1 graph identity',
      )
      equal(harness.topology.listGraphs().length, 1, 'authority v1 graph count')

      const packageSession = harness.lifecycle.snapshot.packageSession
      assert(packageSession !== null && !('schemaVersion' in packageSession), 'authority v1 package session')
      equal(BUILDING_SOURCE_V1_MANIFEST.revision, '482a129ffeef87de842d86ecb62e9e2d2f693ebcc0ae194543ab6e82c7f142bb', 'authority v1 fixture revision')
      equal(packageSession.revision, '482a129ffeef87de842d86ecb62e9e2d2f693ebcc0ae194543ab6e82c7f142bb', 'authority v1 session revision')
      equal(packageSession.assets.length, 4, 'authority v1 session asset count')
      deepEqual(packageSession.assets.map((asset) => ({
        floorName: asset.floorName,
        building: asset.building,
        level: asset.level,
        floorType: asset.floorType,
      })), BUILDING_SOURCE_V1_MANIFEST.assets.map((asset) => asset.floor), 'authority v1 floor identity order')
      for (const asset of packageSession.assets) {
        equal(harness.lifecycle.getPackageAssetById(asset.assetId), asset, `${asset.floorName} asset lookup`)
        equal(harness.lifecycle.getPackageAssetsByFloorName(asset.floorName)[0], asset, `${asset.floorName} floor lookup`)
      }

      const context = harness.compileContexts[0]!
      equal(context.assetProofs.length, 4, 'authority v1 proof count')
      for (const [index, proof] of context.assetProofs.entries()) {
        const manifestAsset = BUILDING_SOURCE_V1_MANIFEST.assets[index]!
        const sessionAsset = packageSession.assets[index]!
        equal(proof.provenance, 'SAME_RESPONSE_BYTES', `authority v1 proof ${index} provenance`)
        equal(proof.digest?.value, manifestAsset.digest.value, `authority v1 proof ${index} digest`)
        equal(proof.canonicalUri, sessionAsset.canonicalUri, `authority v1 proof ${index} canonical URI`)
        equal(proof.selectionGeneration, result.generation, `authority v1 proof ${index} generation`)
        equal(proof.root, sessionAsset.root, `authority v1 proof ${index} root`)
      }

      harness.lifecycle.invalidateAndCleanup()
      assertStrictCleanup(harness, 'authority v1 cleanup')
    },
  },
  {
    name: 'null TOWER and ROOF identities publish exact v1 session proofs and a ready graph',
    run: async () => {
      const fixture = await createNullSpecialV1Package()
      const sessionId = 'special_null_v1_session'
      const harness = createHarness({
        sessionIds: [sessionId],
        floorIdentitiesBySession: new Map([[sessionId, fixture.floors]]),
      })
      const result = await harness.lifecycle.selectPackage(fixture.zip)
      equal(result.kind, 'loaded', 'special null v1 result')
      equal(harness.lifecycle.snapshot.status, 'ready', 'special null v1 graph state')
      equal(harness.lifecycle.snapshot.graphId, 'scene/a/special-null-levels', 'special null graph identity')

      const packageSession = harness.lifecycle.snapshot.packageSession
      assert(packageSession !== null && !('schemaVersion' in packageSession), 'v1 package session')
      equal(packageSession.assets.length, 2, 'special null asset count')
      for (const [index, asset] of packageSession.assets.entries()) {
        const expected = fixture.manifest.assets[index]!
        equal(asset.floorName, expected.floor.floorName, `asset ${index} floorName`)
        equal(asset.floorType, expected.floor.floorType, `asset ${index} floorType`)
        equal(asset.level, null, `asset ${index} null level`)
        equal(asset.building, 'A', `asset ${index} building`)
        equal(harness.lifecycle.getPackageAssetById(asset.assetId), asset, `asset ${index} identity lookup`)
        equal(harness.lifecycle.getPackageAssetsByFloorName(asset.floorName)[0], asset, `asset ${index} floor lookup`)
      }

      const context = harness.compileContexts[0]!
      equal(context.assetProofs.length, 2, 'special null proof count')
      for (const [index, proof] of context.assetProofs.entries()) {
        equal(proof.provenance, 'SAME_RESPONSE_BYTES', `proof ${index} provenance`)
        equal(proof.digest?.value, fixture.manifest.assets[index]!.digest.value, `proof ${index} digest`)
        equal(proof.canonicalUri, packageSession.assets[index]!.canonicalUri, `proof ${index} canonical URI`)
        equal(proof.selectionGeneration, result.generation, `proof ${index} generation`)
      }
      const route = harness.topology.findPath({
        graphId: harness.lifecycle.snapshot.graphId!,
        startNodeId: 'tower-start',
        goalNodeId: 'tower-goal',
      })
      assert(route.ok, 'special null v1 graph remains routable')
      deepEqual(route.route.steps.map((step) => step.edgeId), ['tower-edge'], 'special null route edge')
      harness.lifecycle.invalidateAndCleanup()
      assertStrictCleanup(harness, 'special null v1 cleanup')
    },
  },
  {
    name: 'Studio golden ZIP loads two exact assets, commits atomically, and routes the golden edge',
    run: async () => {
      equal(await sha256Hex(GOLDEN), INDEX.authoritativeSuccessPackage.sha256, 'golden ZIP SHA-256')
      equal(GOLDEN.byteLength, INDEX.authoritativeSuccessPackage.byteLength, 'golden ZIP byte length')
      const sessionId = 'golden_session_01'
      const harness = createHarness({ sessionIds: [sessionId] })
      const firstTransport = transportUrl(sessionId, 0)
      const previousCacheValue = { owner: 'pre-existing-cache-entry' }
      harness.cache.files[firstTransport] = previousCacheValue
      const result = await harness.lifecycle.selectPackage(GOLDEN.slice())

      equal(result.kind, 'loaded', 'golden package result')
      equal(harness.lifecycle.snapshot.status, 'ready', 'golden package state')
      equal(harness.lifecycle.snapshot.packageDiagnostic, null, 'golden package diagnostic')
      equal(harness.loadCalls.length, 2, 'two package loads')
      assert(harness.peakInFlightLoads >= 2 && harness.peakInFlightLoads <= 3, 'load concurrency must be 2-3')
      deepEqual(harness.compileRootCounts, [2], 'compile after all roots load')
      deepEqual(harness.createGraphRootCounts, [2], 'createGraph after all roots load')
      equal(harness.cache.enabled, false, 'cache enabled state restored')
      equal(harness.cache.files[firstTransport], previousCacheValue, 'prior cache value restored')
      equal(Object.keys(harness.cache.files).length, 1, 'temporary cache keys released')

      for (const [index, call] of harness.loadCalls.entries()) {
        assert(call.cacheHit && call.bytes !== null, `asset ${index} must be synchronously cached`)
        equal(
          await sha256Hex(new Uint8Array(call.bytes)),
          GOLDEN_MANIFEST.assets[index]!.digest.value,
          `asset ${index} exact ZIP bytes`,
        )
        assert(call.url.includes('/.transport/'), 'loader must use private transport URL')
      }

      const packageSession = harness.lifecycle.snapshot.packageSession
      assert(packageSession !== null, 'public package session')
      equal(
        packageSession.manifestUri,
        `${APP_ORIGIN}/__space-model-package-v1/${sessionId}/space-model-package.v1.json`,
        'synthetic manifest identity',
      )
      equal(packageSession.assets.length, 2, 'public package assets')
      assert(!JSON.stringify(packageSession).includes('.transport'), 'transport URL must not leak to package session')
      for (const asset of packageSession.assets) {
        assert(asset.canonicalUri.endsWith(`/${asset.floorName}.glb`), 'public canonical asset URI')
        equal(harness.lifecycle.getPackageAssetById(asset.assetId), asset, 'assetId mapping')
        equal(harness.lifecycle.getPackageAssetsByFloorName(asset.floorName)[0], asset, 'floor mapping')
      }

      const context = harness.compileContexts[0]!
      equal(context.assetProofs.length, 2, 'proof count')
      for (const [index, proof] of context.assetProofs.entries()) {
        equal(proof.provenance, 'SAME_RESPONSE_BYTES', `proof ${index} provenance`)
        equal(proof.digest?.value, GOLDEN_MANIFEST.assets[index]!.digest.value, `proof ${index} digest`)
        equal(proof.canonicalUri, packageSession.assets[index]!.canonicalUri, `proof ${index} URI`)
        assert(!proof.canonicalUri.includes('.transport'), 'proof must use public URI')
      }

      const modelKeys = [...harness.modelRecords.keys()]
      assert(modelKeys.every((key) => !['A_B1.glb', 'A_1F.glb'].includes(key)), 'model keys are transport basenames')
      for (const [index, info] of [...harness.modelRecords.values()].entries()) {
        equal(info.floorName, GOLDEN_MANIFEST.assets[index]!.floor.floorName, 'metadata floorName retained')
        equal(info.url, packageSession.assets[index]!.canonicalUri, 'stored FloorInfo remapped to public URI')
      }

      const route = harness.topology.findPath({
        graphId: harness.lifecycle.snapshot.graphId!,
        startNodeId: INDEX.authoritativeSuccessPackage.routeAssertion.sourceNodeId,
        goalNodeId: INDEX.authoritativeSuccessPackage.routeAssertion.targetNodeId,
        allowedModes: [INDEX.authoritativeSuccessPackage.routeAssertion.mode],
      })
      assert(route.ok, `golden route must resolve: ${route.ok ? '' : route.message}`)
      deepEqual(
        route.route.steps.map((step) => step.edgeId),
        [INDEX.authoritativeSuccessPackage.routeAssertion.edgeId],
        'golden route edge',
      )
      harness.lifecycle.invalidateAndCleanup()
      assertStrictCleanup(harness, 'golden unmount')
    },
  },
  {
    name: 'digest-only and immutable package revision AssetProof branches both bind without transport leakage',
    run: async () => {
      const revisionPackage = await rewriteGolden((manifest, sidecar) => {
        for (const [index, asset] of sidecar.assets.entries()) {
          asset.revision = `${manifest.revision}/asset-${String(index + 1)}`
        }
      })
      const harness = createHarness({ sessionIds: ['immutable_revision_session'] })
      const result = await harness.lifecycle.selectPackage(revisionPackage)
      equal(result.kind, 'loaded', 'immutable revision package result')
      const context = harness.compileContexts[0]!
      equal(context.assetProofs.length, 2, 'immutable proof count')
      for (const [index, proof] of context.assetProofs.entries()) {
        equal(proof.provenance, 'IMMUTABLE_PACKAGE_REVISION', 'immutable provenance')
        equal(proof.revision, `${GOLDEN_MANIFEST.revision}/asset-${String(index + 1)}`, 'immutable revision')
        assert(proof.digest !== undefined, 'immutable proof retains verified digest')
        assert(!proof.canonicalUri.includes('.transport'), 'immutable proof hides transport URI')
      }
      harness.lifecycle.invalidateAndCleanup()
      assertStrictCleanup(harness, 'immutable revision cleanup')
    },
  },
  {
    name: 'digest mismatch and old Studio batch ZIP both stop before model loading',
    run: async () => {
      const digestPackage = await rewriteGolden((_manifest, _sidecar, files) => {
        files['A_B1.glb'] = files['A_B1.glb']!.slice()
        files['A_B1.glb']![64] ^= 1
      }, { rewriteTopology: false })
      const digestHarness = createHarness()
      const digestResult = await digestHarness.lifecycle.selectPackage(digestPackage)
      equal(digestResult.kind, 'model-error', 'digest failure result')
      equal(digestHarness.lifecycle.snapshot.packageDiagnostic?.code, 'PACKAGE_DIGEST_MISMATCH', 'digest code')
      equal(digestHarness.lifecycle.snapshot.packageDiagnostic?.phase, 'HASH', 'digest phase')
      equal(digestHarness.loadCalls.length, 0, 'digest failure zero load')
      assertStrictCleanup(digestHarness, 'digest failure')

      const oldBatch = normalizeZip(zipSync({
        'A_B1.glb': GOLDEN_FILES['A_B1.glb']!,
        'A_1F.glb': GOLDEN_FILES['A_1F.glb']!,
        'model-index.json': strToU8('{"standardModelPackage":false}'),
      }))
      const oldHarness = createHarness()
      const oldResult = await oldHarness.lifecycle.selectPackage(oldBatch)
      equal(oldResult.kind, 'model-error', 'old batch result')
      equal(oldHarness.lifecycle.snapshot.packageDiagnostic?.code, 'PACKAGE_RESOURCE_NOT_FOUND', 'old batch code')
      equal(oldHarness.loadCalls.length, 0, 'old batch zero load')
      assertStrictCleanup(oldHarness, 'old batch')
    },
  },
  {
    name: 'assetId, revision, canonical URI, and digest prebinding failures perform zero loads',
    run: async () => {
      const variants: Array<{
        name: string
        mutate(manifest: MutableManifest, sidecar: MutableSidecar): void
        code: string
      }> = [
        {
          name: 'assetId',
          code: 'PACKAGE_TOPOLOGY_PROJECTION_MISMATCH',
          mutate: (_manifest, sidecar) => {
            const oldId = sidecar.assets[0]!.assetId
            const newId = `${oldId.slice(0, -1)}9`
            sidecar.assets[0]!.assetId = newId
            for (const node of sidecar.nodes) if (node.assetId === oldId) node.assetId = newId
            for (const edge of sidecar.edges) {
              for (const via of edge.path?.via ?? []) if (via.assetId === oldId) via.assetId = newId
            }
          },
        },
        {
          name: 'revision',
          code: 'PACKAGE_REVISION_MISMATCH',
          mutate: (_manifest, sidecar) => { sidecar.revision = 'different-revision' },
        },
        {
          name: 'URI',
          code: 'PACKAGE_TOPOLOGY_PROJECTION_MISMATCH',
          mutate: (_manifest, sidecar) => { sidecar.assets[0]!.uri = './nested/A_B1.glb' },
        },
        {
          name: 'digest',
          code: 'PACKAGE_TOPOLOGY_PROJECTION_MISMATCH',
          mutate: (_manifest, sidecar) => { sidecar.assets[0]!.digest.value = '0'.repeat(64) },
        },
      ]
      for (const variant of variants) {
        const bytes = await rewriteGolden((manifest, sidecar) => variant.mutate(manifest, sidecar))
        const harness = createHarness()
        const result = await harness.lifecycle.selectPackage(bytes)
        equal(result.kind, 'model-error', `${variant.name} result`)
        equal(harness.lifecycle.snapshot.packageDiagnostic?.code, variant.code, `${variant.name} code`)
        equal(harness.lifecycle.snapshot.packageDiagnostic?.phase, 'BIND', `${variant.name} phase`)
        equal(harness.loadCalls.length, 0, `${variant.name} zero load`)
        assertStrictCleanup(harness, `${variant.name} prebind`)
      }
    },
  },
  {
    name: 'mid-load failure removes every partial package resource in strict order',
    run: async () => {
      const harness = createHarness({ loadFailureCall: 2 })
      const result = await harness.lifecycle.selectPackage(GOLDEN.slice())
      equal(result.kind, 'model-error', 'load failure result')
      equal(harness.lifecycle.snapshot.diagnostic?.code, 'SIDECAR_ASSET_NOT_LOADED', 'load diagnostic')
      equal(harness.loadCalls.length, 2, 'both concurrent loads started')
      assert(!JSON.stringify(harness.lifecycle.snapshot).includes('.transport'), 'load diagnostic has no transport URI')
      assertStrictCleanup(harness, 'mid-load failure')
      equal(Object.keys(harness.cache.files).length, 0, 'load failure cache cleanup')
      equal(harness.cache.enabled, false, 'load failure cache enabled restore')

      const mismatchHarness = createHarness({ floorNameMismatchCall: 2 })
      const mismatchResult = await mismatchHarness.lifecycle.selectPackage(GOLDEN.slice())
      equal(mismatchResult.kind, 'model-error', 'post-load identity failure result')
      equal(mismatchHarness.preciseUnloadCalls.length, 1, 'failed loaded asset precisely retired')
      assertStrictCleanup(mismatchHarness, 'post-load identity failure')
    },
  },
  {
    name: 'v1 loader floor identity drift fails binding before proof session or graph publication',
    run: async () => {
      const fixture = await createNullSpecialV1Package()
      const variants = [
        { field: 'level', override: { level: 0 } },
        { field: 'building', override: { building: 'B' } },
        { field: 'floorType', override: { floorType: 'FLOOR' } },
      ] as const
      for (const variant of variants) {
        const sessionId = `v1_identity_mismatch_${variant.field}`
        const harness = createHarness({
          sessionIds: [sessionId],
          floorIdentitiesBySession: new Map([[sessionId, fixture.floors]]),
          floorInfoOverridesByCall: new Map([[1, variant.override]]),
        })
        const result = await harness.lifecycle.selectPackage(fixture.zip.slice())
        equal(result.kind, 'model-error', `${variant.field} mismatch result`)
        equal(harness.lifecycle.snapshot.diagnostic?.code, 'SIDECAR_ASSET_BINDING_MISMATCH', `${variant.field} mismatch code`)
        equal(harness.lifecycle.snapshot.diagnostic?.phase, 'BIND', `${variant.field} mismatch phase`)
        equal(harness.lifecycle.snapshot.diagnostic?.details?.field, variant.field, `${variant.field} mismatch detail`)
        equal(harness.lifecycle.snapshot.packageSession, null, `${variant.field} session not published`)
        equal(harness.compileContexts.length, 0, `${variant.field} proof not compiled`)
        equal(harness.topology.listGraphs().length, 0, `${variant.field} graph not published`)
        equal(harness.lifecycle.getPackageAssetById(fixture.manifest.assets[0]!.assetId), null, `${variant.field} asset lookup empty`)
        assert(harness.preciseUnloadCalls.length >= 1, `${variant.field} mismatched transport retired`)
        assertStrictCleanup(harness, `${variant.field} identity mismatch`)
      }
    },
  },
  {
    name: 'compile failure after all loads rolls back models and never creates a graph',
    run: async () => {
      const harness = createHarness({ compileFailure: true })
      const result = await harness.lifecycle.selectPackage(GOLDEN.slice())
      equal(result.kind, 'model-error', 'compile failure result')
      deepEqual(harness.compileRootCounts, [2], 'compile sees complete package')
      equal(harness.createGraphRootCounts.length, 0, 'createGraph not called')
      assertStrictCleanup(harness, 'compile failure')
    },
  },
  {
    name: 'createGraph mutation followed by throw is compensated and fully rolled back',
    run: async () => {
      const harness = createHarness({ createGraphFailure: true })
      const result = await harness.lifecycle.selectPackage(GOLDEN.slice())
      equal(result.kind, 'model-error', 'createGraph failure result')
      deepEqual(harness.createGraphRootCounts, [2], 'createGraph after complete load')
      equal(harness.lifecycle.snapshot.diagnostic?.code, 'SIDECAR_GRAPH_COMMIT_FAILED', 'commit diagnostic')
      assertStrictCleanup(harness, 'createGraph failure')
    },
  },
  {
    name: 'late A resolution while B loads is retired only after B pending loads settle',
    run: async () => {
      const staleGate = deferred<void>()
      const freshGate = deferred<void>()
      const harness = createHarness({
        sessionIds: ['stale_session_a', 'fresh_session_b'],
        loadGates: new Map([
          ['stale_session_a', staleGate],
          ['fresh_session_b', freshGate],
        ]),
        // Simulate the defensive worst case in which an old loader violates
        // unloadAll's generation cancellation and attaches after supersession.
        ignoreUnloadGenerationForSessions: new Set(['stale_session_a']),
      })
      const stalePromise = harness.lifecycle.selectPackage(GOLDEN.slice())
      await until(() => harness.loadCalls.length === 2, 'stale package loads should start')
      const freshPromise = harness.lifecycle.selectPackage(GOLDEN.slice())
      await until(() => harness.loadCalls.length === 4, 'fresh package loads should be pending')
      let freshSettled = false
      void freshPromise.then(() => { freshSettled = true })
      staleGate.resolve()
      await until(() => harness.modelRecords.size === 2, 'stale roots should attach defensively')
      equal(harness.preciseUnloadCalls.length, 0, 'stale unload waits while B loadFloor is pending')
      equal(freshSettled, false, 'B remains pending during late A resolution')
      freshGate.resolve()
      const freshResult = await freshPromise
      const staleResult = await stalePromise
      equal(freshResult.kind, 'loaded', 'fresh package result')
      assert(harness.lifecycle.snapshot.packageSession?.manifestUri.includes('/fresh_session_b/'), 'fresh session published')
      equal(staleResult.kind, 'stale', 'old package result')
      equal(harness.preciseUnloadCalls.length, 2, 'both stale transport keys precisely unloaded')
      equal(harness.lifecycle.snapshot.status, 'ready', 'fresh state survives stale completion')
      equal(harness.modelRecords.size, 2, 'only fresh model records remain')
      equal(harness.scene.children.length, 2, 'only fresh roots remain')
      equal(harness.topology.listGraphs().length, 1, 'only fresh graph remains')
      assert(!JSON.stringify(harness.lifecycle.snapshot).includes('stale_session_a'), 'stale identity not published')
      harness.lifecycle.invalidateAndCleanup()
    },
  },
  {
    name: 'stale precise-unload failure prevents newer graph commit and fails closed',
    run: async () => {
      const staleGate = deferred<void>()
      const freshGate = deferred<void>()
      const harness = createHarness({
        sessionIds: ['failed_retire_a', 'blocked_session_b'],
        loadGates: new Map([
          ['failed_retire_a', staleGate],
          ['blocked_session_b', freshGate],
        ]),
        ignoreUnloadGenerationForSessions: new Set(['failed_retire_a']),
        preciseUnloadFailure: true,
      })
      const stalePromise = harness.lifecycle.selectPackage(GOLDEN.slice())
      await until(() => harness.loadCalls.length === 2, 'failed-retire A loads')
      const blockedPromise = harness.lifecycle.selectPackage(GOLDEN.slice())
      await until(() => harness.loadCalls.length === 4, 'blocked B loads')
      staleGate.resolve()
      await until(() => harness.modelRecords.size === 2, 'failed-retire A late roots')
      freshGate.resolve()
      const [staleResult, blockedResult] = await Promise.all([stalePromise, blockedPromise])
      equal(staleResult.kind, 'stale', 'failed-retire stale result')
      equal(blockedResult.kind, 'model-error', 'failed-retire current result')
      equal(harness.lifecycle.snapshot.status, 'error', 'failed-retire state')
      equal(harness.lifecycle.snapshot.diagnostic?.code, 'SIDECAR_GRAPH_COMMIT_FAILED', 'failed-retire code')
      assert(harness.preciseUnloadCalls.length >= 1, 'precise unload attempted')
      equal(harness.cleanupEvents.length, 12, 'only A start, B start, and current B failure clean globally')
      assertStrictCleanup(harness, 'failed precise retirement')
    },
  },
  {
    name: 'package and legacy selections alternate through one graph lifecycle and unmount cleanly',
    run: async () => {
      const harness = createHarness({ sessionIds: ['switch_package_a', 'switch_package_b'] })
      const legacy = await installLegacyFixture(harness)

      equal((await harness.lifecycle.selectPackage(GOLDEN.slice())).kind, 'loaded', 'initial package')
      equal(harness.topology.listGraphs().length, 1, 'one package graph')
      assert(harness.lifecycle.snapshot.packageSession !== null, 'package mapping present')

      equal((await harness.lifecycle.select(legacy.url, [legacy])).kind, 'loaded', 'legacy selection')
      equal(harness.lifecycle.snapshot.graphId, 'legacy-graph', 'legacy graph active')
      equal(harness.lifecycle.snapshot.packageSession, null, 'package mapping removed on legacy switch')
      equal(harness.topology.listGraphs().length, 1, 'one legacy graph')
      equal(harness.modelRecords.size, 1, 'one legacy model')

      equal((await harness.lifecycle.selectPackage(GOLDEN.slice())).kind, 'loaded', 'package reload')
      assert(harness.lifecycle.snapshot.packageSession?.manifestUri.includes('/switch_package_b/'), 'new package mapping')
      equal(harness.topology.listGraphs().length, 1, 'one reloaded package graph')
      equal(harness.modelRecords.size, 2, 'two reloaded package models')

      harness.lifecycle.invalidateAndCleanup()
      equal(harness.lifecycle.snapshot.status, 'idle', 'unmount state')
      assertStrictCleanup(harness, 'package/legacy unmount')
    },
  },
]

export async function runPackageLifecycleSuite(): Promise<{
  passed: number
  names: readonly string[]
  durationMs: number
}> {
  const start = performance.now()
  const names: string[] = []
  for (const test of tests) {
    await test.run()
    names.push(test.name)
  }
  return { passed: names.length, names: Object.freeze(names), durationMs: performance.now() - start }
}
