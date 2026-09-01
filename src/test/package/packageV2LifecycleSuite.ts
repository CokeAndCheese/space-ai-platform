import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import { unzipSync } from 'fflate'
import {
  compileTopologySidecarV1,
  type TopologySidecarCompileContext,
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
  PACKAGE_V2_FIXTURE_FLOOR,
  createPackageV2Fixture,
  createPackageV2GlbFixture,
  createStoredPackageZipV2Fixture,
  type PackageV2FixtureFloor,
} from './packageV2Suite'
import { currentTopologyUnavailableResult } from '@/templates/topologyCapabilityGate'

type Test = { readonly name: string; readonly run: () => void | Promise<void> }

interface Deferred<T> {
  readonly promise: Promise<T>
  resolve(value: T): void
  reject(reason: unknown): void
}

interface LoadCall {
  readonly url: string
  readonly bytes: ArrayBuffer | null
  readonly sessionId: string | null
  readonly assetIndex: number | null
}

type FloorInfoIdentityOverride = Partial<Pick<
  TopologyFloorInfo,
  'floorName' | 'building' | 'level' | 'floorType'
>>

const APP_ORIGIN = 'https://space.test'
const CLEANUP_ORDER = ['routes', 'graphs', 'legacy', 'models'] as const
const GOLDEN_V1 = new Uint8Array(readFileSync(fileURLToPath(new URL(
  './fixtures/standard-model-package-v1-success.zip',
  import.meta.url,
)))).slice()
const GOLDEN_V1_FILES = unzipSync(GOLDEN_V1)
const GOLDEN_V1_MANIFEST = JSON.parse(new TextDecoder().decode(
  GOLDEN_V1_FILES['space-model-package.v1.json']!,
)) as {
  readonly assets: readonly {
    readonly floor: PackageV2FixtureFloor
  }[]
}
const GOLDEN_V2 = new Uint8Array(readFileSync(fileURLToPath(new URL(
  './fixtures/standard-model-package-v2-success.zip',
  import.meta.url,
)))).slice()
const GOLDEN_V2_FILES = unzipSync(GOLDEN_V2)
const GOLDEN_V2_MANIFEST = JSON.parse(new TextDecoder().decode(
  GOLDEN_V2_FILES['space-model-package.v2.json']!,
)) as {
  readonly revision: string
  readonly assets: readonly {
    readonly assetId: string
    readonly uri: string
    readonly digest: { readonly value: string }
    readonly floor: PackageV2FixtureFloor
  }[]
}
const BUILDING_SOURCE_V2 = new Uint8Array(readFileSync(fileURLToPath(new URL(
  './fixtures/building-source-profile-v1.1/A-standard-model-package-v2.zip',
  import.meta.url,
)))).slice()
const BUILDING_SOURCE_V2_FILES = unzipSync(BUILDING_SOURCE_V2)
const BUILDING_SOURCE_V2_MANIFEST = JSON.parse(new TextDecoder().decode(
  BUILDING_SOURCE_V2_FILES['space-model-package.v2.json']!,
)) as {
  readonly revision: string
  readonly assets: readonly {
    readonly assetId: string
    readonly uri: string
    readonly digest: { readonly value: string }
    readonly floor: {
      readonly floorName: string
      readonly building: string | null
      readonly level: number | null
      readonly floorType: string
    }
  }[]
}

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

function response(options: {
  readonly url: string
  readonly status?: number
  readonly bytes?: ArrayBuffer
  readonly text?: string
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

function transportUrl(sessionId: string, index: number, digest: string, schemaVersion: 1 | 2): string {
  return `${APP_ORIGIN}/__space-model-package-v${schemaVersion}/${sessionId}/.transport/` +
    `${sessionId}-${String(index).padStart(3, '0')}-${digest.slice(0, 16)}.glb`
}

function createHarness(options: {
  readonly sessionIds: readonly string[]
  readonly floorIdentitiesBySession: ReadonlyMap<string, readonly PackageV2FixtureFloor[]>
  readonly floorInfoOverridesByCall?: ReadonlyMap<number, FloorInfoIdentityOverride>
  readonly loadGates?: ReadonlyMap<string, Deferred<void>>
  readonly ignoreUnloadGenerationForSessions?: ReadonlySet<string>
  readonly loadFailureCall?: number
}) {
  const scene = new THREE.Scene()
  const topology = createTopologyTool()
  const states: TopologySceneSessionSnapshot[] = []
  const loadCalls: LoadCall[] = []
  const cleanupEvents: string[] = []
  const compileContexts: TopologySidecarCompileContext[] = []
  const modelRecords = new Map<string, TopologyFloorInfo>()
  const preciseUnloadCalls: string[] = []
  const fetchResources = new Map<string, { bytes?: ArrayBuffer; text?: string }>()
  const cache: TopologyCachePort = {
    enabled: false,
    files: Object.create(null) as Record<string, unknown>,
    add(key, value) {
      if (this.enabled) this.files[key] = value
    },
  }
  let sessionIndex = 0
  let modelEpoch = 0
  let inFlightLoads = 0
  let peakInFlightLoads = 0
  let compileCallCount = 0
  let createGraphCallCount = 0

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
      const parsed = new URL(url, APP_ORIGIN)
      const parts = parsed.pathname.split('/')
      const sessionId = parts[1]?.startsWith('__space-model-package-v') === true
        ? parts[2] ?? null
        : null
      const key = parts.at(-1)!
      const transportMatch = /-(\d{3})-[0-9a-f]{16}\.glb$/u.exec(key)
      const assetIndex = transportMatch === null ? null : Number(transportMatch[1])
      const cached = cache.files[url]
      const callNumber = loadCalls.length + 1
      loadCalls.push({
        url,
        bytes: cached instanceof ArrayBuffer ? cached : null,
        sessionId,
        assetIndex,
      })
      const epoch = modelEpoch
      inFlightLoads += 1
      peakInFlightLoads = Math.max(peakInFlightLoads, inFlightLoads)
      try {
        const gate = sessionId === null ? undefined : options.loadGates?.get(sessionId)
        if (gate !== undefined) await gate.promise
        await Promise.resolve()
        if (
          epoch !== modelEpoch &&
          !options.ignoreUnloadGenerationForSessions?.has(sessionId ?? '')
        ) {
          throw new Error('load invalidated by modelTool generation')
        }
        if (options.loadFailureCall === callNumber) throw new Error('injected load failure')
        const floor = sessionId === null || assetIndex === null
          ? undefined
          : options.floorIdentitiesBySession.get(sessionId)?.[assetIndex]
        const floorName = floor?.floorName ?? key.replace(/\.glb$/iu, '')
        if (!floorName) throw new Error('missing harness floor identity')
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
      const info = modelRecords.get(`${transportKey}.glb`)
      if (info === undefined) return
      scene.remove(info.root)
      modelRecords.delete(`${transportKey}.glb`)
    },
    getScene: () => scene,
    compileSidecar: (text, context) => {
      compileCallCount += 1
      compileContexts.push(context)
      return compileTopologySidecarV1(text, context)
    },
    createGraph: (input: TopologyGraphInput): TopologyGraphSnapshot => {
      createGraphCallCount += 1
      return topology.createGraph(input)
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
    createPackageSessionId: () => options.sessionIds[sessionIndex++] ?? `session_${sessionIndex}`,
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
    modelRecords,
    preciseUnloadCalls,
    fetchResources,
    peakInFlightLoads: () => peakInFlightLoads,
    get compileCallCount() { return compileCallCount },
    get createGraphCallCount() { return createGraphCallCount },
  }
}

async function createTwoAssetV2Fixture() {
  const floorA = PACKAGE_V2_FIXTURE_FLOOR
  const floorB: PackageV2FixtureFloor = {
    floorName: 'B_2F',
    building: 'B',
    level: 2,
    floorType: 'FLOOR',
  }
  return createPackageV2Fixture({
    assets: [
      {
        assetId: 'project-a/building-a/floor-a-1f',
        uri: './models/asset-a.glb',
        floor: floorA,
        bytes: createPackageV2GlbFixture(floorA),
      },
      {
        assetId: 'project-a/building-b/floor-b-2f',
        uri: './models/asset-b.glb',
        floor: floorB,
        bytes: createPackageV2GlbFixture(floorB),
      },
    ],
  })
}

async function createNullSpecialV2Fixture() {
  const tower: PackageV2FixtureFloor = {
    floorName: 'A_T',
    building: 'A',
    level: null,
    floorType: 'TOWER',
  }
  const roof: PackageV2FixtureFloor = {
    floorName: 'A_RF',
    building: 'A',
    level: null,
    floorType: 'ROOF',
  }
  return createPackageV2Fixture({
    assets: [
      {
        assetId: 'project-a/building-a/tower',
        uri: './models/A_T.glb',
        floor: tower,
        bytes: createPackageV2GlbFixture(tower),
      },
      {
        assetId: 'project-a/building-a/roof',
        uri: './models/A_RF.glb',
        floor: roof,
        bytes: createPackageV2GlbFixture(roof),
      },
    ],
  })
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
  harness.fetchResources.set(`${APP_ORIGIN}${record.url}`, {
    bytes: bytes.slice().buffer as ArrayBuffer,
  })
  harness.fetchResources.set(`${APP_ORIGIN}/models/legacy/legacy.topology.v1.json`, { text: sidecar })
  return record
}

function assertStrictCleanup(harness: ReturnType<typeof createHarness>, message: string): void {
  deepEqual(harness.cleanupEvents.slice(-4), CLEANUP_ORDER, `${message} cleanup order`)
  equal(harness.topology.listGraphs().length, 0, `${message} graphs`)
  equal(harness.modelRecords.size, 0, `${message} model records`)
  equal(harness.scene.children.length, 0, `${message} scene roots`)
  equal(harness.lifecycle.snapshot.packageSession, null, `${message} package session`)
}

const tests: Test[] = [
  {
    name: 'authority four-floor v2 ZIP publishes exact nullable resource proofs without topology then cleans up',
    run: async () => {
      const sessionId = 'building_source_v2_session'
      const harness = createHarness({
        sessionIds: [sessionId],
        floorIdentitiesBySession: new Map([[
          sessionId,
          BUILDING_SOURCE_V2_MANIFEST.assets.map((asset) => asset.floor),
        ]]),
      })
      const result = await harness.lifecycle.selectPackageV2(BUILDING_SOURCE_V2.slice())
      equal(result.kind, 'loaded', 'authority v2 selection')
      equal(harness.lifecycle.snapshot.status, 'scene-ready', 'authority v2 scene state')
      equal(harness.lifecycle.snapshot.graphId, null, 'authority v2 graph identity')
      equal(harness.lifecycle.snapshot.nodes.length, 0, 'authority v2 graph nodes')
      equal(harness.topology.listGraphs().length, 0, 'authority v2 graph count')
      equal(harness.compileCallCount, 0, 'authority v2 compile calls')
      equal(harness.createGraphCallCount, 0, 'authority v2 createGraph calls')

      const packageSession = harness.lifecycle.snapshot.packageSession
      assert(packageSession !== null && 'schemaVersion' in packageSession, 'authority v2 package session')
      equal(packageSession.schemaVersion, 2, 'authority v2 schema version')
      equal(BUILDING_SOURCE_V2_MANIFEST.revision, 'b89bdf4c02f7c99182483a3f5119a4ed10141c11889108108bc47cf260f7c8d4', 'authority v2 fixture revision')
      equal(packageSession.revision, 'b89bdf4c02f7c99182483a3f5119a4ed10141c11889108108bc47cf260f7c8d4', 'authority v2 session revision')
      equal(packageSession.assets.length, 4, 'authority v2 session asset count')
      deepEqual(packageSession.assets.map((asset) => ({
        floorName: asset.floorName,
        building: asset.building,
        level: asset.level,
        floorType: asset.floorType,
      })), BUILDING_SOURCE_V2_MANIFEST.assets.map((asset) => asset.floor), 'authority v2 floor identity order')
      for (const [index, asset] of packageSession.assets.entries()) {
        const manifestAsset = BUILDING_SOURCE_V2_MANIFEST.assets[index]!
        equal(asset.resourceProof.canonicalUri, asset.canonicalUri, `authority v2 proof ${index} canonical URI`)
        equal(asset.resourceProof.digest.value, manifestAsset.digest.value, `authority v2 proof ${index} digest`)
        equal(asset.resourceProof.packageRevision, BUILDING_SOURCE_V2_MANIFEST.revision, `authority v2 proof ${index} revision`)
        equal(asset.resourceProof.provenance, 'SAME_RESPONSE_BYTES', `authority v2 proof ${index} provenance`)
        equal(asset.resourceProof.root, asset.root, `authority v2 proof ${index} root`)
        equal(asset.resourceProof.selectionGeneration, result.generation, `authority v2 proof ${index} generation`)
        equal(harness.lifecycle.getPackageV2ResourceProof(asset.assetId), asset.resourceProof, `authority v2 proof ${index} lookup`)
      }
      deepEqual(
        currentTopologyUnavailableResult(harness.lifecycle.snapshot),
        { ok: false, code: 'TOPOLOGY_UNAVAILABLE', reasonCode: 'PACKAGE_DECLARED_ABSENT' },
        'authority v2 capability projection',
      )

      harness.lifecycle.invalidateAndCleanup()
      equal(harness.lifecycle.getPackageV2ResourceProof(BUILDING_SOURCE_V2_MANIFEST.assets[0]!.assetId), null, 'authority v2 proof cleared')
      assertStrictCleanup(harness, 'authority v2 cleanup')
    },
  },
  {
    name: 'null TOWER and ROOF identities publish exact v2 session proofs with topology unavailable',
    run: async () => {
      const fixture = await createNullSpecialV2Fixture()
      const sessionId = 'special_null_v2_session'
      const harness = createHarness({
        sessionIds: [sessionId],
        floorIdentitiesBySession: new Map([[sessionId, fixture.assets.map((asset) => asset.floor)]]),
      })
      const result = await harness.lifecycle.selectPackageV2(fixture.zip)
      equal(result.kind, 'loaded', 'special null v2 result')
      equal(harness.lifecycle.snapshot.status, 'scene-ready', 'special null v2 state')
      equal(harness.lifecycle.snapshot.graphId, null, 'special null v2 graph identity')
      equal(harness.lifecycle.snapshot.nodes.length, 0, 'special null v2 graph nodes')
      equal(harness.compileCallCount, 0, 'special null v2 compile calls')
      equal(harness.createGraphCallCount, 0, 'special null v2 createGraph calls')

      const packageSession = harness.lifecycle.snapshot.packageSession
      assert(packageSession !== null && 'schemaVersion' in packageSession, 'v2 package session')
      equal(packageSession.schemaVersion, 2, 'v2 schema version')
      equal(packageSession.assets.length, 2, 'special null v2 asset count')
      for (const [index, asset] of packageSession.assets.entries()) {
        const expected = fixture.manifest.assets[index]!
        equal(asset.floorName, expected.floor.floorName, `asset ${index} floorName`)
        equal(asset.floorType, expected.floor.floorType, `asset ${index} floorType`)
        equal(asset.level, null, `asset ${index} null level`)
        equal(asset.building, 'A', `asset ${index} building`)
        equal(asset.resourceProof.canonicalUri, asset.canonicalUri, `proof ${index} canonical URI`)
        equal(asset.resourceProof.digest.value, expected.digest.value, `proof ${index} digest`)
        equal(asset.resourceProof.packageRevision, fixture.manifest.revision, `proof ${index} revision`)
        equal(asset.resourceProof.provenance, 'SAME_RESPONSE_BYTES', `proof ${index} provenance`)
        equal(asset.resourceProof.selectionGeneration, result.generation, `proof ${index} generation`)
        equal(harness.lifecycle.getPackageV2ResourceProof(asset.assetId), asset.resourceProof, `proof ${index} lookup`)
      }
      deepEqual(
        currentTopologyUnavailableResult(harness.lifecycle.snapshot),
        { ok: false, code: 'TOPOLOGY_UNAVAILABLE', reasonCode: 'PACKAGE_DECLARED_ABSENT' },
        'special null v2 capability projection',
      )
      harness.lifecycle.invalidateAndCleanup()
      assertStrictCleanup(harness, 'special null v2 cleanup')
    },
  },
  {
    name: 'mirrored Studio v2 loads exact bytes and atomically publishes Scene Metadata and immutable resource proofs',
    run: async () => {
      const fixture = {
        zip: GOLDEN_V2.slice(),
        manifest: GOLDEN_V2_MANIFEST,
        assets: GOLDEN_V2_MANIFEST.assets,
      }
      const sessionId = 'v2_success_session'
      const floorIdentities = fixture.assets.map((asset) => asset.floor)
      const harness = createHarness({
        sessionIds: [sessionId],
        floorIdentitiesBySession: new Map([[sessionId, floorIdentities]]),
      })
      const firstTransport = transportUrl(
        sessionId,
        0,
        fixture.manifest.assets[0]!.digest.value,
        2,
      )
      const previousCacheValue = { owner: 'pre-existing' }
      harness.cache.files[firstTransport] = previousCacheValue

      const result = await harness.lifecycle.selectPackageV2(fixture.zip.slice())
      if (result.kind !== 'loaded') {
        throw new Error(`v2 selection failed: ${JSON.stringify(harness.lifecycle.snapshot.packageDiagnostic)}`)
      }
      equal(result.kind, 'loaded', 'v2 selection result')
      equal(harness.lifecycle.snapshot.status, 'scene-ready', 'v2 session status')
      equal(harness.lifecycle.snapshot.graphId, null, 'v2 graph identity')
      equal(harness.lifecycle.snapshot.nodes.length, 0, 'v2 graph nodes')
      equal(harness.topology.listGraphs().length, 0, 'v2 graph count')
      equal(harness.compileCallCount, 0, 'v2 sidecar compile calls')
      equal(harness.createGraphCallCount, 0, 'v2 createGraph calls')
      equal(harness.loadCalls.length, 2, 'v2 asset load count')
      assert(harness.peakInFlightLoads() >= 2 && harness.peakInFlightLoads() <= 3, 'v2 concurrency')
      equal(harness.cache.enabled, false, 'cache enabled restored')
      equal(harness.cache.files[firstTransport], previousCacheValue, 'previous cache value restored')
      equal(Object.keys(harness.cache.files).length, 1, 'temporary cache leases released')

      for (const [index, call] of harness.loadCalls.entries()) {
        assert(call.bytes !== null, `asset ${index} cache bytes`)
        equal(
          await sha256Hex(new Uint8Array(call.bytes)),
          fixture.manifest.assets[index]!.digest.value,
          `asset ${index} exact bytes`,
        )
      }

      const packageSession = harness.lifecycle.snapshot.packageSession
      assert(packageSession !== null && 'schemaVersion' in packageSession, 'v2 package session')
      equal(packageSession.schemaVersion, 2, 'v2 schema discriminator')
      equal(packageSession.assets.length, 2, 'v2 asset mapping')
      equal(packageSession.topologyCapability.code, 'TOPOLOGY_UNAVAILABLE', 'topology code')
      equal(packageSession.topologyCapability.reasonCode, 'PACKAGE_DECLARED_ABSENT', 'topology reason')
      deepEqual(
        currentTopologyUnavailableResult(harness.lifecycle.snapshot),
        {
          ok: false,
          code: 'TOPOLOGY_UNAVAILABLE',
          reasonCode: 'PACKAGE_DECLARED_ABSENT',
        },
        'runtime capability projection comes from the published lifecycle session',
      )
      for (const [index, asset] of packageSession.assets.entries()) {
        const manifestAsset = fixture.manifest.assets[index]!
        const canonicalUri = new URL(manifestAsset.uri, packageSession.manifestUri).href
        equal(asset.canonicalUri, canonicalUri, `asset ${index} public URI`)
        equal(asset.resourceProof.canonicalUri, canonicalUri, `proof ${index} URI`)
        equal(asset.resourceProof.digest.value, manifestAsset.digest.value, `proof ${index} digest`)
        equal(asset.resourceProof.packageRevision, fixture.manifest.revision, `proof ${index} revision`)
        equal(asset.resourceProof.provenance, 'SAME_RESPONSE_BYTES', `proof ${index} provenance`)
        equal(asset.resourceProof.root, asset.root, `proof ${index} root`)
        equal(asset.resourceProof.selectionGeneration, result.generation, `proof ${index} generation`)
        equal(harness.lifecycle.getPackageV2ResourceProof(asset.assetId), asset.resourceProof, 'proof lookup')
        equal(harness.lifecycle.getPackageAssetById(asset.assetId), null, 'v1 lookup remains isolated')
        assert(!('.transport' in asset), 'transport is not a public asset field')
        assert(!asset.canonicalUri.includes('.transport'), 'transport is not public identity')
        assert(!('buffer' in asset.metadata), 'raw GLB buffer is not exposed')
        assert(Object.isFrozen(asset.resourceProof), 'resource proof is immutable')
        assert(Object.isFrozen(asset.metadata.nodes), 'metadata projection is immutable')
      }
      const readyStates = harness.states.filter((state) => state.status === 'scene-ready')
      equal(readyStates.length, 1, 'one atomic ready publication')
      equal(readyStates[0]!.packageSession?.assets.length, 2, 'ready publication is complete')

      harness.lifecycle.invalidateAndCleanup()
      equal(harness.lifecycle.getPackageV2ResourceProof(packageSession.assets[0]!.assetId), null, 'proof cleared')
      assertStrictCleanup(harness, 'v2 unmount')
    },
  },
  {
    name: 'v2 digest and Metadata failures complete before any model load',
    run: async () => {
      const fixture = await createTwoAssetV2Fixture()
      const files = unzipSync(fixture.zip)
      files['models/asset-a.glb']![0] ^= 1
      const digestMismatch = createStoredPackageZipV2Fixture(files)
      const digestHarness = createHarness({
        sessionIds: ['v2_digest_failure'],
        floorIdentitiesBySession: new Map(),
      })
      const digestResult = await digestHarness.lifecycle.selectPackageV2(digestMismatch)
      equal(digestResult.kind, 'model-error', 'digest mismatch result')
      equal(digestHarness.lifecycle.snapshot.packageDiagnostic?.code, 'PACKAGE_DIGEST_MISMATCH', 'digest code')
      equal(digestHarness.lifecycle.snapshot.packageDiagnostic?.phase, 'HASH', 'digest phase')
      equal(
        currentTopologyUnavailableResult(digestHarness.lifecycle.snapshot),
        null,
        'digest failure is not declared absence',
      )
      equal(digestHarness.loadCalls.length, 0, 'digest mismatch zero load')
      assertStrictCleanup(digestHarness, 'digest mismatch')

      const embedded = createPackageV2GlbFixture(PACKAGE_V2_FIXTURE_FLOOR, { embedded: true })
      const metadataFixture = await createPackageV2Fixture({
        assets: [{
          assetId: 'project-a/building-a/floor-a-1f',
          uri: './A_1F.glb',
          floor: PACKAGE_V2_FIXTURE_FLOOR,
          bytes: embedded,
        }],
      })
      const metadataHarness = createHarness({
        sessionIds: ['v2_metadata_failure'],
        floorIdentitiesBySession: new Map(),
      })
      const metadataResult = await metadataHarness.lifecycle.selectPackageV2(metadataFixture.zip)
      equal(metadataResult.kind, 'model-error', 'Metadata failure result')
      equal(
        metadataHarness.lifecycle.snapshot.packageDiagnostic?.code,
        'PACKAGE_EMBEDDED_TOPOLOGY_FORBIDDEN',
        'Metadata policy code',
      )
      equal(metadataHarness.loadCalls.length, 0, 'Metadata failure zero load')
      assertStrictCleanup(metadataHarness, 'Metadata failure')
    },
  },
  {
    name: 'v2 partial model failure clears every root without publishing partial readiness',
    run: async () => {
      const fixture = await createTwoAssetV2Fixture()
      const sessionId = 'v2_partial_failure'
      const harness = createHarness({
        sessionIds: [sessionId],
        floorIdentitiesBySession: new Map([[sessionId, fixture.assets.map((asset) => asset.floor)]]),
        loadFailureCall: 2,
      })
      const result = await harness.lifecycle.selectPackageV2(fixture.zip)
      equal(result.kind, 'model-error', 'partial failure result')
      equal(harness.lifecycle.snapshot.status, 'error', 'partial failure state')
      equal(
        currentTopologyUnavailableResult(harness.lifecycle.snapshot),
        null,
        'partial load failure is not declared absence',
      )
      equal(harness.states.some((state) => state.status === 'scene-ready'), false, 'no partial readiness')
      equal(harness.compileCallCount, 0, 'partial failure compile calls')
      equal(harness.createGraphCallCount, 0, 'partial failure graph calls')
      assertStrictCleanup(harness, 'partial failure')
    },
  },
  {
    name: 'v2 loader floor identity drift fails lifecycle before resource proof or scene publication',
    run: async () => {
      const fixture = await createNullSpecialV2Fixture()
      const variants = [
        { field: 'level', override: { level: 0 } },
        { field: 'building', override: { building: 'B' } },
        { field: 'floorType', override: { floorType: 'FLOOR' } },
      ] as const
      for (const variant of variants) {
        const sessionId = `v2_identity_mismatch_${variant.field}`
        const harness = createHarness({
          sessionIds: [sessionId],
          floorIdentitiesBySession: new Map([[sessionId, fixture.assets.map((asset) => asset.floor)]]),
          floorInfoOverridesByCall: new Map([[1, variant.override]]),
        })
        const result = await harness.lifecycle.selectPackageV2(fixture.zip.slice())
        equal(result.kind, 'model-error', `${variant.field} mismatch result`)
        equal(harness.lifecycle.snapshot.packageDiagnostic?.code, 'PACKAGE_FIELD_INVALID', `${variant.field} mismatch code`)
        equal(harness.lifecycle.snapshot.packageDiagnostic?.phase, 'LIFECYCLE', `${variant.field} mismatch phase`)
        equal(harness.lifecycle.snapshot.packageDiagnostic?.details.field, variant.field, `${variant.field} mismatch detail`)
        equal(harness.lifecycle.snapshot.packageSession, null, `${variant.field} session not published`)
        equal(harness.lifecycle.getPackageV2ResourceProof(fixture.assets[0]!.assetId), null, `${variant.field} proof lookup empty`)
        equal(harness.topology.listGraphs().length, 0, `${variant.field} graph not published`)
        equal(harness.compileCallCount, 0, `${variant.field} compile calls`)
        equal(harness.createGraphCallCount, 0, `${variant.field} createGraph calls`)
        equal(currentTopologyUnavailableResult(harness.lifecycle.snapshot), null, `${variant.field} capability not published`)
        assert(harness.preciseUnloadCalls.length >= 1, `${variant.field} mismatched transport retired`)
        assertStrictCleanup(harness, `${variant.field} identity mismatch`)
      }
    },
  },
  {
    name: 'late v2 A roots retire only after pending B loads and B remains ready',
    run: async () => {
      const fixture = await createTwoAssetV2Fixture()
      const staleGate = deferred<void>()
      const freshGate = deferred<void>()
      const staleSession = 'v2_stale_session_a'
      const freshSession = 'v2_fresh_session_b'
      const floorIdentities = fixture.assets.map((asset) => asset.floor)
      const harness = createHarness({
        sessionIds: [staleSession, freshSession],
        floorIdentitiesBySession: new Map([
          [staleSession, floorIdentities],
          [freshSession, floorIdentities],
        ]),
        loadGates: new Map([
          [staleSession, staleGate],
          [freshSession, freshGate],
        ]),
        ignoreUnloadGenerationForSessions: new Set([staleSession]),
      })

      const stalePromise = harness.lifecycle.selectPackageV2(fixture.zip.slice())
      await until(() => harness.loadCalls.length === 2, 'stale A loads start')
      const freshPromise = harness.lifecycle.selectPackageV2(fixture.zip.slice())
      await until(() => harness.loadCalls.length === 4, 'fresh B loads start')
      staleGate.resolve()
      await until(() => harness.modelRecords.size === 2, 'late A roots attach')
      equal(harness.lifecycle.snapshot.status, 'loading', 'B stays pending while A retires')
      equal(harness.preciseUnloadCalls.length, 0, 'A retirement waits for B loads')
      freshGate.resolve()

      const [staleResult, freshResult] = await Promise.all([stalePromise, freshPromise])
      equal(staleResult.kind, 'stale', 'A result')
      equal(freshResult.kind, 'loaded', 'B result')
      equal(harness.lifecycle.snapshot.status, 'scene-ready', 'B ready state')
      equal(harness.preciseUnloadCalls.length, 2, 'both late A transports retired')
      equal(harness.modelRecords.size, 2, 'only B roots remain')
      assert(
        [...harness.modelRecords.keys()].every((key) => key.includes(freshSession)),
        'no stale A model record remains',
      )
      const packageSession = harness.lifecycle.snapshot.packageSession
      assert(packageSession !== null && 'schemaVersion' in packageSession, 'B v2 session')
      assert(packageSession.manifestUri.includes(`/${freshSession}/`), 'B manifest identity')
      equal(harness.compileCallCount, 0, 'stale transition compile calls')
    },
  },
  {
    name: 'v2 v1 legacy and v2 switch through one cleanup and graph lifecycle',
    run: async () => {
      const fixture = await createTwoAssetV2Fixture()
      const v2A = 'switch_v2_session_a'
      const v1 = 'switch_v1_session_b'
      const v2B = 'switch_v2_session_c'
      const floorIdentities = fixture.assets.map((asset) => asset.floor)
      const harness = createHarness({
        sessionIds: [v2A, v1, v2B],
        floorIdentitiesBySession: new Map([
          [v2A, floorIdentities],
          [v1, GOLDEN_V1_MANIFEST.assets.map((asset) => asset.floor)],
          [v2B, floorIdentities],
        ]),
      })
      const legacy = await installLegacyFixture(harness)

      equal((await harness.lifecycle.selectPackageV2(fixture.zip.slice())).kind, 'loaded', 'initial v2')
      equal(harness.lifecycle.snapshot.status, 'scene-ready', 'initial v2 state')
      equal(harness.topology.listGraphs().length, 0, 'initial v2 graph count')

      equal((await harness.lifecycle.selectPackage(GOLDEN_V1.slice())).kind, 'loaded', 'v1 selection')
      equal(harness.lifecycle.snapshot.status, 'ready', 'v1 graph state')
      equal(harness.topology.listGraphs().length, 1, 'one v1 graph')
      assert(
        harness.lifecycle.snapshot.packageSession !== null &&
        !('schemaVersion' in harness.lifecycle.snapshot.packageSession),
        'v1 package session remains unchanged',
      )

      equal((await harness.lifecycle.select(legacy.url, [legacy])).kind, 'loaded', 'legacy selection')
      equal(harness.lifecycle.snapshot.status, 'ready', 'legacy graph state')
      equal(harness.lifecycle.snapshot.graphId, 'legacy-graph', 'legacy graph identity')
      equal(harness.lifecycle.snapshot.packageSession, null, 'legacy has no package mapping')
      equal(harness.topology.listGraphs().length, 1, 'one legacy graph')

      equal((await harness.lifecycle.selectPackageV2(fixture.zip.slice())).kind, 'loaded', 'final v2')
      equal(harness.lifecycle.snapshot.status, 'scene-ready', 'final v2 state')
      equal(harness.lifecycle.snapshot.graphId, null, 'final v2 graph identity')
      equal(harness.topology.listGraphs().length, 0, 'legacy graph removed for v2')
      equal(harness.compileCallCount, 2, 'only v1 and legacy compile topology')
      equal(harness.createGraphCallCount, 2, 'only v1 and legacy create graphs')
      deepEqual(harness.cleanupEvents.slice(-4), CLEANUP_ORDER, 'final switch cleanup order')
    },
  },
]

export async function runPackageV2LifecycleSuite(): Promise<{
  readonly passed: number
  readonly names: readonly string[]
  readonly durationMs: number
}> {
  const started = performance.now()
  const names: string[] = []
  for (const test of tests) {
    await test.run()
    names.push(test.name)
  }
  return { passed: names.length, names: Object.freeze(names), durationMs: performance.now() - started }
}
