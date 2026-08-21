import * as THREE from 'three'
import { compileTopologySidecarV1, type TopologySidecarCompileContext, type TopologySidecarCompileResult, type TopologySidecarDiagnostic } from '@/adapters/topology'
import type { ModelRecord } from '@/composables/useModelLibrary'
import {
  TopologyError,
  type TopologyGraphInput,
  type TopologyGraphSnapshot,
} from '@/ssp/topology/types'
import {
  assertSelfContainedGlb,
  computeSha256Hex,
  createTopologySceneLifecycle,
  loadFloorWithSynchronousCacheLease,
  resolveTopologySelectionPlan,
  type TopologyCachePort,
  type TopologyFetchResponse,
  type TopologyFloorInfo,
  type TopologySceneSessionSnapshot,
} from '@/topology/sceneLifecycle'

type TestBody = () => void | Promise<void>

interface TestCase {
  name: string
  run: TestBody
}

export interface TopologySceneLifecycleSuiteResult {
  passed: number
  names: readonly string[]
  durationMs: number
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function equal<T>(actual: T, expected: T, message: string): void {
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

async function rejects(run: () => unknown | Promise<unknown>, message: string): Promise<unknown> {
  try {
    await run()
  } catch (error) {
    return error
  }
  throw new Error(`${message}: expected rejection`)
}

function deferred<T>(): {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

async function until(predicate: () => boolean, message: string): Promise<void> {
  for (let index = 0; index < 40; index++) {
    if (predicate()) return
    await Promise.resolve()
  }
  throw new Error(message)
}

function record(overrides: Partial<ModelRecord> = {}): ModelRecord {
  return {
    kind: 'file',
    subcategory: 'demo',
    filename: 'floor.glb',
    url: '/models/demo/floor.glb',
    displayName: 'Floor',
    sizeBytes: 128,
    sizeMB: 0.01,
    mtime: 1,
    ...overrides,
  }
}

function makeGlb(json: Record<string, unknown> = { asset: { version: '2.0' } }): ArrayBuffer {
  const encoded = new TextEncoder().encode(JSON.stringify(json))
  const paddedLength = Math.ceil(encoded.byteLength / 4) * 4
  const bytes = new Uint8Array(20 + paddedLength)
  bytes.set(encoded, 20)
  bytes.fill(0x20, 20 + encoded.byteLength)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, bytes.byteLength, true)
  view.setUint32(12, paddedLength, true)
  view.setUint32(16, 0x4e4f534a, true)
  return bytes.buffer
}

function graphInput(id = 'graph-demo'): TopologyGraphInput {
  return {
    id,
    layers: [{ id: 'L1' }],
    nodes: [
      {
        id: 'node-a',
        layerId: 'L1',
        position: { x: 0, y: 0, z: 0 },
        label: 'A',
        kind: 'WAYPOINT',
      },
      {
        id: 'node-b',
        layerId: 'L1',
        position: { x: 1, y: 0, z: 0 },
      },
    ],
    edges: [],
  }
}

function graphSnapshot(input: TopologyGraphInput, id = input.id ?? 'generated'): TopologyGraphSnapshot {
  return {
    schemaVersion: 2,
    id,
    routingRevision: 0,
    visualRevision: 0,
    layers: input.layers.map((layer) => ({ ...layer, tags: [...(layer.tags ?? [])] })),
    nodes: input.nodes.map((node) => ({ ...node, tags: [...(node.tags ?? [])] })),
    edges: [],
    tags: [...(input.tags ?? [])],
  }
}

function sidecarTextFor(
  assets: readonly ModelRecord[],
  options: {
    graphId?: string
    digestFor?: (asset: ModelRecord, index: number) => string
  } = {},
): string {
  const files = assets.filter((asset) => asset.kind === 'file')
  return JSON.stringify({
    schema: 'space-ai-platform/topology-sidecar',
    schemaVersion: 1,
    revision: 'scene-lifecycle-test-r1',
    graphId: options.graphId ?? 'graph-demo',
    coordinateSpace: 'ASSET_LOCAL',
    unit: 'meter',
    upAxis: 'Y',
    assets: files.map((asset, index) => ({
      assetId: `asset-${String(index)}`,
      uri: asset.url,
      digest: {
        algorithm: 'SHA-256',
        value: options.digestFor?.(asset, index) ?? 'a'.repeat(64),
      },
    })),
    layers: [{ id: 'L1' }],
    nodes: files.map((_asset, index) => ({
      id: `node-${String(index)}`,
      layerId: 'L1',
      assetId: `asset-${String(index)}`,
      position: { x: index, y: 0, z: 0 },
    })),
    edges: [],
    connectors: [],
    blockers: [],
  })
}

function response(options: {
  status?: number
  url: string
  redirected?: boolean
  bytes?: ArrayBuffer
  text?: string
}): TopologyFetchResponse {
  const status = options.status ?? 200
  return {
    ok: status >= 200 && status < 300,
    status,
    redirected: options.redirected ?? false,
    url: options.url,
    arrayBuffer: async () => options.bytes ?? new ArrayBuffer(0),
    text: async () => options.text ?? '',
  }
}

interface HarnessBehavior {
  fetch: (url: string, init: { signal: AbortSignal; credentials: 'same-origin'; redirect: 'error' }) => Promise<TopologyFetchResponse>
  digestSha256: (bytes: ArrayBuffer) => Promise<string>
  resolveLoaderUrl: (url: string) => string
  loadFloor: (url: string) => Promise<TopologyFloorInfo>
  compileSidecar: (text: string, context: TopologySidecarCompileContext) => TopologySidecarCompileResult
  createGraph: (input: TopologyGraphInput) => TopologyGraphSnapshot
  removeGraph: (id: string) => boolean
}

function createHarness(options: {
  manifest?: readonly ModelRecord[]
  buffers?: ReadonlyMap<string, ArrayBuffer>
  sidecarStatus?: number
  sidecarText?: string
  sidecarRedirected?: boolean
} = {}) {
  const manifest = options.manifest ?? [record()]
  const defaultBuffer = makeGlb()
  const buffers = options.buffers ?? new Map(
    manifest
      .filter((item) => item.kind === 'file')
      .map((item) => [item.url, defaultBuffer]),
  )
  const scene = new THREE.Scene()
  const cache: TopologyCachePort = {
    enabled: false,
    files: Object.create(null) as Record<string, unknown>,
    add(key, value) {
      if (this.enabled) this.files[key] = value
    },
  }
  const states: TopologySceneSessionSnapshot[] = []
  const fetchCalls: Array<{
    url: string
    credentials: string
    redirect: string
    signal: AbortSignal
  }> = []
  const digestInputs: ArrayBuffer[] = []
  const cacheCaptures = new Map<string, unknown>()
  const loadFloorCalls: Array<{ url: string; exactCacheHit: boolean }> = []
  const compileContexts: TopologySidecarCompileContext[] = []
  const graphs = new Map<string, TopologyGraphSnapshot>()
  const graphInputs: TopologyGraphInput[] = []
  const removedGraphIds: string[] = []
  const cleanupEvents: string[] = []
  const cleanupAbortStates: boolean[] = []
  const loadedRoots = new Map<string, THREE.Object3D>()
  let modelEpoch = 0

  const defaultFetch: HarnessBehavior['fetch'] = async (url, _init) => {
    const assetBytes = buffers.get(url)
    if (assetBytes !== undefined) {
      return response({
        url: new URL(url, 'https://space.test').href,
        bytes: assetBytes,
      })
    }
    return response({
      status: options.sidecarStatus ?? 200,
      url,
      redirected: options.sidecarRedirected,
      text: options.sidecarText ?? '{}',
    })
  }

  const defaultLoadFloor: HarnessBehavior['loadFloor'] = async (url) => {
    const epoch = modelEpoch
    await Promise.resolve()
    if (epoch !== modelEpoch) throw new Error(`stale model load: ${url}`)
    const root = new THREE.Group()
    root.name = url
    scene.add(root)
    loadedRoots.set(url, root)
    return { floorName: url.split('/').pop()!.replace(/\.glb$/i, ''), url, root }
  }

  const behavior: HarnessBehavior = {
    fetch: defaultFetch,
    digestSha256: async (bytes) => {
      digestInputs.push(bytes)
      return 'a'.repeat(64)
    },
    resolveLoaderUrl: (url) => url,
    loadFloor: defaultLoadFloor,
    compileSidecar: (_text, context) => {
      compileContexts.push(context)
      return { ok: true, input: graphInput() } as TopologySidecarCompileResult
    },
    createGraph: (input) => {
      graphInputs.push(input)
      const snapshot = graphSnapshot(input)
      graphs.set(snapshot.id, snapshot)
      return snapshot
    },
    removeGraph: (id) => graphs.delete(id),
  }

  const lifecycle = createTopologySceneLifecycle(
    {
      origin: 'https://space.test',
      fetch: (url, init) => {
        fetchCalls.push({ url, ...init })
        return behavior.fetch(url, init)
      },
      digestSha256: (bytes) => behavior.digestSha256(bytes),
      cache,
      resolveLoaderUrl: (url) => behavior.resolveLoaderUrl(url),
      loadFloor: (url) => {
        const captured = cache.files[behavior.resolveLoaderUrl(url)]
        const expected = buffers.get(url)
        const exactCacheHit = captured !== undefined && captured === expected
        cacheCaptures.set(url, captured)
        loadFloorCalls.push({ url, exactCacheHit })
        if (captured !== undefined) {
          assert(exactCacheHit, `cache handoff must contain exact bytes for ${url}`)
        }
        return behavior.loadFloor(url)
      },
      getScene: () => scene,
      compileSidecar: (text, context) => behavior.compileSidecar(text, context),
      createGraph: (input) => behavior.createGraph(input),
      getGraph: (id) => graphs.get(id) ?? null,
      removeGraph: (id) => {
        removedGraphIds.push(id)
        return behavior.removeGraph(id)
      },
      removeAllRoutes: () => {
        cleanupEvents.push('removeAllRoutes')
        cleanupAbortStates.push(fetchCalls.at(-1)?.signal.aborted ?? false)
        return 0
      },
      removeAllGraphs: () => {
        cleanupEvents.push('removeAllGraphs')
        cleanupAbortStates.push(fetchCalls.at(-1)?.signal.aborted ?? false)
        const count = graphs.size
        graphs.clear()
        return count
      },
      removeAllLegacyTopologies: () => {
        cleanupEvents.push('legacyRemoveAll')
        cleanupAbortStates.push(fetchCalls.at(-1)?.signal.aborted ?? false)
        return 0
      },
      unloadAllModels: () => {
        cleanupEvents.push('modelUnloadAll')
        cleanupAbortStates.push(fetchCalls.at(-1)?.signal.aborted ?? false)
        modelEpoch++
        loadedRoots.forEach((root) => scene.remove(root))
        loadedRoots.clear()
      },
      assetConcurrency: 3,
    },
    (state) => states.push(state),
  )

  return {
    lifecycle,
    behavior,
    defaultFetch,
    defaultLoadFloor,
    manifest,
    buffers,
    scene,
    cache,
    states,
    fetchCalls,
    digestInputs,
    cacheCaptures,
    loadFloorCalls,
    compileContexts,
    graphs,
    graphInputs,
    removedGraphIds,
    cleanupEvents,
    cleanupAbortStates,
    loadedRoots,
    get modelEpoch() { return modelEpoch },
  }
}

function useRealSidecarCompiler(harness: ReturnType<typeof createHarness>): void {
  harness.behavior.compileSidecar = (text, context) => {
    harness.compileContexts.push(context)
    return compileTopologySidecarV1(text, context)
  }
}

const cleanupOrder = [
  'removeAllRoutes',
  'removeAllGraphs',
  'legacyRemoveAll',
  'modelUnloadAll',
]

const tests: TestCase[] = [
  {
    name: 'file and scene discovery use exact R1 sidecar locations and current manifest records',
    run: () => {
      const floor = record()
      const scene = record({
        kind: 'scene',
        filename: 'hospital',
        subcategory: 'hospital',
        url: '/models/hospital',
      })
      const a = record({ filename: 'a.glb', subcategory: 'hospital', url: '/models/hospital/a.glb' })
      const b = record({ filename: 'b.glb', subcategory: 'hospital', url: '/models/hospital/b.glb' })
      const other = record({ filename: 'x.glb', subcategory: 'other', url: '/models/other/x.glb' })

      const filePlan = resolveTopologySelectionPlan(floor.url, [floor], 'https://space.test')
      equal(filePlan.sidecarUri, 'https://space.test/models/demo/floor.topology.v1.json', 'file sidecar')
      deepEqual(filePlan.assets.map((item) => item.url), [floor.url], 'file assets')

      const scenePlan = resolveTopologySelectionPlan(scene.url, [scene, a, b, other], 'https://space.test')
      equal(scenePlan.sidecarUri, 'https://space.test/models/hospital/topology.v1.json', 'scene sidecar')
      deepEqual(scenePlan.assets.map((item) => item.url), [a.url, b.url], 'scene manifest assets')
    },
  },
  {
    name: 'manifest authorization rejects cross-origin, redirecting, and non-GLB asset paths',
    run: async () => {
      await rejects(
        () => resolveTopologySelectionPlan(
          'https://evil.test/floor.glb',
          [record({ url: 'https://evil.test/floor.glb' })],
          'https://space.test',
        ),
        'cross-origin manifest asset',
      )
      await rejects(
        () => resolveTopologySelectionPlan('/models/demo/floor.gltf', [record({ url: '/models/demo/floor.gltf' })], 'https://space.test'),
        'non-GLB manifest asset',
      )
      await rejects(
        () => resolveTopologySelectionPlan('floor.glb', [record({ url: 'floor.glb' })], 'https://space.test'),
        'loader-incompatible relative manifest asset',
      )

      const harness = createHarness({ sidecarRedirected: true })
      const result = await harness.lifecycle.select(harness.manifest[0]!.url, harness.manifest)
      equal(result.kind, 'loaded', 'sidecar redirect must not hide the loaded model')
      equal(harness.lifecycle.snapshot.status, 'error', 'sidecar redirect topology status')
      equal(harness.graphInputs.length, 0, 'sidecar redirect must not commit')
      harness.fetchCalls.forEach((call) => {
        equal(call.credentials, 'same-origin', 'fetch credentials policy')
        equal(call.redirect, 'error', 'fetch redirect policy')
      })

      for (const variant of ['redirect', 'url-mismatch'] as const) {
        const model = record()
        const assetHarness = createHarness({
          manifest: [model],
          sidecarText: sidecarTextFor([model]),
        })
        useRealSidecarCompiler(assetHarness)
        assetHarness.behavior.fetch = async (url, init) => {
          const fetched = await assetHarness.defaultFetch(url, init)
          if (!url.endsWith('.glb')) return fetched
          return {
            ...fetched,
            redirected: variant === 'redirect',
            url: variant === 'url-mismatch'
              ? 'https://space.test/models/demo/other.glb'
              : fetched.url,
          }
        }
        const assetResult = await assetHarness.lifecycle.select(
          assetHarness.manifest[0]!.url,
          assetHarness.manifest,
        )
        equal(assetResult.kind, 'model-error', `${variant} asset result`)
        equal(assetHarness.lifecycle.snapshot.diagnostic?.code, 'SIDECAR_ASSET_NOT_LOADED', `${variant} diagnostic`)
        equal(assetHarness.compileContexts.length, 0, `${variant} zero-visual compiler gate`)
        equal(assetHarness.graphInputs.length, 0, `${variant} asset graph count`)
        equal(assetHarness.loadedRoots.size, 0, `${variant} asset loaded roots`)
        equal(assetHarness.loadFloorCalls.length, 0, `${variant} must not reach model loader`)
      }
    },
  },
  {
    name: 'SHA-256 hashes the exact GLB container and self-contained gate rejects external URIs',
    run: async () => {
      const abc = new TextEncoder().encode('abc')
      equal(
        await computeSha256Hex(abc.buffer),
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
        'SHA-256 digest',
      )
      assertSelfContainedGlb(makeGlb(), 'https://space.test/topology.v1.json', 'https://space.test/a.glb')
      const error = await rejects(
        () => assertSelfContainedGlb(
          makeGlb({ asset: { version: '2.0' }, images: [{ uri: 'texture.png' }] }),
          'https://space.test/topology.v1.json',
          'https://space.test/a.glb',
        ),
        'external image URI',
      ) as { diagnostic?: TopologySidecarDiagnostic }
      equal(error.diagnostic?.code, 'SIDECAR_ASSET_BINDING_UNVERIFIABLE', 'self-contained diagnostic')
      equal(error.diagnostic?.details.requirement, 'SELF_CONTAINED_GLB', 'self-contained requirement')
    },
  },
  {
    name: 'THREE.Cache lease uses resolved key, captures synchronously, and restores old global state',
    run: async () => {
      const globalCache = THREE.Cache as unknown as TopologyCachePort
      const key = 'https://space.test/models/test.glb'
      const files = globalCache.files
      const originalEnabled = globalCache.enabled
      const originallyHadKey = Object.prototype.hasOwnProperty.call(files, key)
      const originalValue = files[key]
      const oldValue = { old: true }
      const bytes = makeGlb()
      files[key] = oldValue
      globalCache.enabled = false

      try {
        const promise = loadFloorWithSynchronousCacheLease({
          url: '/models/test.glb',
          canonicalUrl: 'https://space.test/models/test.glb',
          bytes,
          cache: globalCache,
          resolveLoaderUrl: () => key,
          assertCurrent: () => undefined,
          loadFloor: async () => {
            equal(globalCache.enabled, true, 'cache enabled inside synchronous handoff')
            equal(THREE.Cache.get(key), bytes, 'loader captures exact response buffer')
            return 'loaded'
          },
        })
        equal(globalCache.enabled, false, 'enabled restored before await')
        equal(files[key], oldValue, 'old cache entry restored before await')
        equal(await promise, 'loaded', 'load result')
      } finally {
        if (originallyHadKey) files[key] = originalValue
        else delete files[key]
        globalCache.enabled = originalEnabled
      }
    },
  },
  {
    name: 'cache lease restores missing/undefined keys and enabled state on sync and async failures',
    run: async () => {
      const files: Record<string, unknown> = Object.create(null) as Record<string, unknown>
      const cache: TopologyCachePort = {
        enabled: true,
        files,
        add(key, value) { if (this.enabled) files[key] = value },
      }
      files['/models/sync.glb'] = undefined
      await rejects(
        () => loadFloorWithSynchronousCacheLease({
          url: '/models/sync.glb',
          canonicalUrl: 'https://space.test/models/sync.glb',
          bytes: makeGlb(),
          cache,
          resolveLoaderUrl: (url) => url,
          assertCurrent: () => undefined,
          loadFloor: () => { throw new Error('sync failure') },
        }),
        'sync cache handoff failure',
      )
      equal(cache.enabled, true, 'enabled restored after sync failure')
      assert(Object.prototype.hasOwnProperty.call(files, '/models/sync.glb'), 'undefined old key must still exist')
      equal(files['/models/sync.glb'], undefined, 'undefined old value restored')

      cache.enabled = false
      const promise = loadFloorWithSynchronousCacheLease({
        url: '/models/async.glb',
        canonicalUrl: 'https://space.test/models/async.glb',
        bytes: makeGlb(),
        cache,
        resolveLoaderUrl: (url) => url,
        assertCurrent: () => undefined,
        loadFloor: () => Promise.reject(new Error('async failure')),
      })
      equal(cache.enabled, false, 'enabled restored before async rejection')
      assert(!Object.prototype.hasOwnProperty.call(files, '/models/async.glb'), 'temporary missing key removed')
      await rejects(() => promise, 'async cache handoff failure')

      cache.enabled = false
      const addFailureCache: TopologyCachePort = {
        enabled: false,
        files,
        add(key, value) {
          files[key] = value
          throw new Error('cache add failure')
        },
      }
      await rejects(
        () => loadFloorWithSynchronousCacheLease({
          url: '/models/add-failure.glb',
          canonicalUrl: 'https://space.test/models/add-failure.glb',
          bytes: makeGlb(),
          cache: addFailureCache,
          resolveLoaderUrl: (url) => url,
          assertCurrent: () => undefined,
          loadFloor: async () => 'unreachable',
        }),
        'cache add failure',
      )
      equal(addFailureCache.enabled, false, 'enabled restored after cache.add failure')
      assert(!Object.prototype.hasOwnProperty.call(files, '/models/add-failure.glb'), 'cache.add partial key removed')
    },
  },
  {
    name: 'loader resolved URL must equal the authorized canonical asset before handoff',
    run: async () => {
      const model = record()
      const harness = createHarness({
        manifest: [model],
        sidecarText: sidecarTextFor([model]),
      })
      harness.behavior.resolveLoaderUrl = () => '/models/demo/not-authorized.glb'

      const result = await harness.lifecycle.select(model.url, harness.manifest)
      equal(result.kind, 'model-error', 'resolver mismatch visual result')
      equal(harness.lifecycle.snapshot.diagnostic?.code, 'SIDECAR_ASSET_NOT_LOADED', 'resolver mismatch topology diagnostic')
      equal(harness.loadFloorCalls.length, 0, 'resolver mismatch must not reach model loader')
      equal(harness.loadedRoots.size, 0, 'resolver mismatch visible roots')
      equal(harness.digestInputs.length, 0, 'resolver mismatch must not issue proof')
      equal(harness.graphInputs.length, 0, 'resolver mismatch graph count')
      assert(
        !Object.prototype.hasOwnProperty.call(harness.cache.files, '/models/demo/not-authorized.glb'),
        'resolver mismatch must not mutate global cache',
      )
    },
  },
  {
    name: 'multi-asset success creates exact SAME_RESPONSE_BYTES proofs and commits once',
    run: async () => {
      const sceneRecord = record({ kind: 'scene', filename: 'hospital', subcategory: 'hospital', url: '/models/hospital' })
      const a = record({ filename: 'a.glb', subcategory: 'hospital', url: '/models/hospital/a.glb' })
      const b = record({ filename: 'b.glb', subcategory: 'hospital', url: '/models/hospital/b.glb' })
      const bytesA = makeGlb({ asset: { version: '2.0' }, extras: { asset: 'a' } })
      const bytesB = makeGlb({ asset: { version: '2.0' }, extras: { asset: 'b' } })
      const harness = createHarness({
        manifest: [sceneRecord, a, b],
        buffers: new Map([[a.url, bytesA], [b.url, bytesB]]),
      })
      harness.behavior.digestSha256 = async (bytes) => {
        harness.digestInputs.push(bytes)
        return bytes === bytesA ? 'a'.repeat(64) : 'b'.repeat(64)
      }

      const result = await harness.lifecycle.select(sceneRecord.url, harness.manifest)
      equal(result.kind, 'loaded', 'scene result')
      if (result.kind === 'loaded') equal(result.assetCount, 2, 'scene asset count')
      equal(harness.lifecycle.snapshot.status, 'ready', 'scene topology state')
      equal(harness.graphInputs.length, 1, 'createGraph call count')
      equal(harness.compileContexts.length, 1, 'compile call count')
      const context = harness.compileContexts[0]!
      equal(context.loadedAssets.length, 2, 'loaded asset count')
      equal(context.assetProofs.length, 2, 'proof count')
      context.assetProofs.forEach((proof, index) => {
        const model = [a, b][index]!
        const bytes = [bytesA, bytesB][index]!
        equal(proof.provenance, 'SAME_RESPONSE_BYTES', 'proof provenance')
        equal(proof.root, context.loadedAssets[index]!.root, 'proof/root identity')
        equal(proof.selectionGeneration, context.selectionGeneration, 'proof generation')
        equal(proof.digest?.algorithm, 'SHA-256', 'proof digest algorithm')
        equal(proof.digest?.value, index === 0 ? 'a'.repeat(64) : 'b'.repeat(64), 'proof digest value')
        equal(harness.cacheCaptures.get(model.url), bytes, 'cache/digest source bytes')
        equal(harness.digestInputs[index], bytes, 'digest exact response bytes')
        equal(
          harness.fetchCalls.filter((call) => call.url === model.url).length,
          1,
          'each GLB must be fetched exactly once',
        )
      })
      deepEqual(
        harness.lifecycle.snapshot.nodes.map((node) => node.id),
        ['node-a', 'node-b'],
        'explicit endpoint candidates',
      )
      assert(Object.isFrozen(harness.lifecycle.snapshot), 'session snapshot must be frozen')
      assert(Object.isFrozen(harness.lifecycle.snapshot.nodes), 'session node collection must be frozen')
      assert(Object.isFrozen(harness.lifecycle.snapshot.nodes[0]), 'session nodes must be frozen')
      try {
        ;(harness.lifecycle.snapshot.nodes[0] as { id: string }).id = 'mutated'
      } catch {
        // ESM strict mode throws for frozen writes; either way the value must not change.
      }
      equal(harness.lifecycle.snapshot.nodes[0]?.id, 'node-a', 'session node remains read-only')
    },
  },
  {
    name: '404 sidecar keeps the loaded model visible and reports SIDECAR_NOT_FOUND',
    run: async () => {
      const harness = createHarness({ sidecarStatus: 404 })
      harness.behavior.digestSha256 = async () => {
        throw new Error('SubtleCrypto unavailable')
      }
      const result = await harness.lifecycle.select(harness.manifest[0]!.url, harness.manifest)
      equal(result.kind, 'loaded', '404 model result')
      equal(harness.lifecycle.snapshot.status, 'unavailable', '404 topology state')
      equal(harness.lifecycle.snapshot.diagnostic?.code, 'SIDECAR_NOT_FOUND', '404 diagnostic')
      assert(Object.isFrozen(harness.lifecycle.snapshot.diagnostic), 'session diagnostic must be frozen')
      assert(Object.isFrozen(harness.lifecycle.snapshot.diagnostic?.details), 'diagnostic details must be frozen')
      equal(harness.graphInputs.length, 0, '404 graph commits')
      equal(harness.loadedRoots.size, 1, '404 must leave model loaded')
      deepEqual(
        harness.loadFloorCalls.map((call) => call.exactCacheHit),
        [true],
        '404 discovery must outrank proof failure without a visual refetch',
      )
    },
  },
  {
    name: 'scene 404 sidecar keeps every successfully loaded model visible',
    run: async () => {
      const selection = record({
        kind: 'scene',
        filename: 'hospital',
        subcategory: 'hospital',
        url: '/models/hospital',
      })
      const a = record({ filename: 'a.glb', subcategory: 'hospital', url: '/models/hospital/a.glb' })
      const b = record({ filename: 'b.glb', subcategory: 'hospital', url: '/models/hospital/b.glb' })
      const harness = createHarness({
        manifest: [selection, a, b],
        sidecarStatus: 404,
      })

      const result = await harness.lifecycle.select(selection.url, harness.manifest)
      equal(result.kind, 'loaded', 'scene 404 visual result')
      if (result.kind === 'loaded') equal(result.assetCount, 2, 'scene 404 visible count')
      equal(harness.lifecycle.snapshot.status, 'unavailable', 'scene 404 topology state')
      equal(harness.lifecycle.snapshot.diagnostic?.code, 'SIDECAR_NOT_FOUND', 'scene 404 diagnostic')
      equal(harness.loadedRoots.size, 2, 'scene 404 visible roots')
      equal(harness.graphInputs.length, 0, 'scene 404 graph count')
    },
  },
  {
    name: 'invalid scene sidecar keeps all successful visual roots and creates no graph',
    run: async () => {
      const selection = record({
        kind: 'scene',
        filename: 'hospital',
        subcategory: 'hospital',
        url: '/models/hospital',
      })
      const a = record({ filename: 'a.glb', subcategory: 'hospital', url: '/models/hospital/a.glb' })
      const b = record({ filename: 'b.glb', subcategory: 'hospital', url: '/models/hospital/b.glb' })
      const harness = createHarness({ manifest: [selection, a, b], sidecarText: '{' })
      useRealSidecarCompiler(harness)

      const result = await harness.lifecycle.select(selection.url, harness.manifest)
      equal(result.kind, 'loaded', 'invalid scene sidecar visual result')
      if (result.kind === 'loaded') equal(result.assetCount, 2, 'invalid scene sidecar visible count')
      equal(harness.lifecycle.snapshot.status, 'error', 'invalid scene sidecar topology state')
      equal(harness.lifecycle.snapshot.diagnostic?.code, 'SIDECAR_JSON_INVALID', 'invalid scene sidecar diagnostic')
      equal(harness.loadedRoots.size, 2, 'invalid scene sidecar visible roots')
      assert(
        harness.loadFloorCalls.every((call) => call.exactCacheHit),
        'invalid scene sidecar visuals use exact fetched bytes',
      )
      equal(harness.graphInputs.length, 0, 'invalid scene sidecar graph count')
    },
  },
  {
    name: 'invalid sidecar diagnostic takes priority over a missing asset proof',
    run: async () => {
      const harness = createHarness({ sidecarText: '{' })
      harness.behavior.digestSha256 = async () => {
        throw new Error('SubtleCrypto unavailable')
      }
      useRealSidecarCompiler(harness)
      const result = await harness.lifecycle.select(harness.manifest[0]!.url, harness.manifest)
      equal(result.kind, 'loaded', 'invalid sidecar model result')
      equal(harness.lifecycle.snapshot.status, 'error', 'invalid sidecar topology state')
      equal(harness.lifecycle.snapshot.diagnostic?.code, 'SIDECAR_JSON_INVALID', 'invalid sidecar diagnostic')
      equal(harness.graphInputs.length, 0, 'invalid sidecar graph commits')
      equal(harness.loadedRoots.size, 1, 'invalid sidecar must leave model loaded')
      deepEqual(
        harness.loadFloorCalls.map((call) => call.exactCacheHit),
        [true],
        'invalid sidecar proof failure must still use the original response bytes visually',
      )
    },
  },
  {
    name: 'caught compiler TopologyError preserves only bounded safe JSON details',
    run: async () => {
      const harness = createHarness()
      const unsafeDetails: Record<string, unknown> = {
        safe: 'kept',
        nested: { count: 2, message: 'drop nested message' },
        message: 'drop message',
        stack: 'drop stack',
        token: 'drop-token-value',
        localPath: '/Users/mac/private/model.glb',
        sourceUri: 'https://alice:password@space.test/model.glb?token=drop-query#fragment',
        embeddedUnixPath: 'asset=/Users/mac/private/model.glb',
        embeddedWindowsPath: String.raw`asset=C:\Users\mac\private\model.glb`,
        embeddedFileUri: 'failed:file:///private/tmp/model.glb',
        volumePath: 'asset=/Volumes/ExternalDrive/project/model.glb',
        etcPath: '/etc/hosts',
        quotedPath: 'source="/Users/mac/private/model.glb"',
        bracketedPath: 'context=[/Volumes/ExternalDrive/model.glb]',
        opaque: new Date(0),
      }
      unsafeDetails.self = unsafeDetails
      harness.behavior.compileSidecar = () => {
        throw new TopologyError(
          'INVALID_GRAPH',
          'secret compiler message',
          '/nodes/0',
          unsafeDetails as never,
        )
      }

      const result = await harness.lifecycle.select(harness.manifest[0]!.url, harness.manifest)
      equal(result.kind, 'loaded', 'compiler exception visual result')
      equal(harness.lifecycle.snapshot.status, 'error', 'compiler exception topology state')
      const details = harness.lifecycle.snapshot.diagnostic?.details
      equal(details?.cause, 'TopologyError', 'compiler error class')
      const topologyError = details?.topologyError as Record<string, unknown> | undefined
      equal(topologyError?.code, 'INVALID_GRAPH', 'compiler TopologyError code')
      equal(topologyError?.path, '/nodes/0', 'compiler TopologyError path')
      deepEqual(
        topologyError?.details,
        {
          safe: 'kept',
          nested: { count: 2 },
          localPath: '[redacted-local-path]',
          sourceUri: 'https://space.test/model.glb',
          embeddedUnixPath: '[redacted-local-path]',
          embeddedWindowsPath: '[redacted-local-path]',
          embeddedFileUri: '[redacted-local-path]',
          volumePath: '[redacted-local-path]',
          etcPath: '[redacted-local-path]',
          quotedPath: '[redacted-local-path]',
          bracketedPath: '[redacted-local-path]',
        },
        'compiler safe details',
      )
      const serialized = JSON.stringify(details)
      assert(!serialized.includes('secret compiler message'), 'compiler message must not leak')
      assert(!serialized.includes('drop stack'), 'compiler stack-like details must not leak')
      assert(!serialized.includes('drop nested message'), 'nested message keys must not leak')
      assert(!serialized.includes('drop-token-value'), 'sensitive-key values must not leak')
      assert(!serialized.includes('/Users/mac'), 'local paths must not leak')
      assert(!serialized.includes('C:\\Users'), 'Windows local paths must not leak')
      assert(!serialized.includes('file:///private'), 'embedded file URIs must not leak')
      assert(!serialized.includes('/Volumes/'), 'mounted-volume paths must not leak')
      assert(!serialized.includes('/etc/'), 'generic POSIX paths must not leak')
      assert(!serialized.includes('alice:password'), 'URL credentials must not leak')
      assert(!serialized.includes('drop-query'), 'URL query secrets must not leak')
      equal(harness.graphInputs.length, 0, 'compiler exception graph count')
      equal(harness.loadedRoots.size, 1, 'compiler exception keeps visual root')
    },
  },
  {
    name: 'snapshot mismatch compensates only the trusted compiled graph id',
    run: async () => {
      for (const variant of ['id', 'schema'] as const) {
        const harness = createHarness()
        harness.behavior.createGraph = (input) => {
          harness.graphInputs.push(input)
          const committed = graphSnapshot(input)
          harness.graphs.set(committed.id, committed)
          if (variant === 'id') {
            harness.graphs.set('wrong-id', graphSnapshot(graphInput('wrong-id')))
            return graphSnapshot(input, 'wrong-id')
          }
          return { ...committed, schemaVersion: 1 } as unknown as TopologyGraphSnapshot
        }
        const result = await harness.lifecycle.select(harness.manifest[0]!.url, harness.manifest)
        equal(result.kind, 'loaded', `${variant} model result`)
        equal(harness.lifecycle.snapshot.status, 'error', `${variant} topology state`)
        equal(harness.lifecycle.snapshot.diagnostic?.code, 'SIDECAR_GRAPH_COMMIT_FAILED', `${variant} diagnostic`)
        assert(!harness.graphs.has('graph-demo'), `${variant} compiled graph must be compensated`)
        assert(harness.removedGraphIds.includes('graph-demo'), `${variant} must remove compiled graph id`)
        if (variant === 'id') {
          assert(!harness.removedGraphIds.includes('wrong-id'), 'untrusted snapshot id must never be removed')
          assert(harness.graphs.has('wrong-id'), 'unrelated graph matching the untrusted snapshot id must survive')
        } else {
          equal(harness.graphs.size, 0, 'schema mismatch compensated graph count')
        }
      }
    },
  },
  {
    name: 'createGraph TopologyError after mutation is compensated and safely diagnosed',
    run: async () => {
      const harness = createHarness()
      harness.behavior.createGraph = (input) => {
        harness.graphInputs.push(input)
        harness.graphs.set(input.id!, graphSnapshot(input))
        throw new TopologyError(
          'DUPLICATE_ID',
          'secret commit message',
          '/id',
          { existing: 'graph-demo', message: 'drop me' },
        )
      }
      const result = await harness.lifecycle.select(harness.manifest[0]!.url, harness.manifest)
      equal(result.kind, 'loaded', 'throw model result')
      equal(harness.lifecycle.snapshot.status, 'error', 'throw topology state')
      equal(harness.graphs.size, 0, 'throw compensated graph count')
      deepEqual(harness.removedGraphIds, ['graph-demo'], 'throw precise compensation')
      const details = harness.lifecycle.snapshot.diagnostic?.details
      equal(details?.cause, 'TopologyError', 'commit error class')
      const topologyError = details?.topologyError as Record<string, unknown> | undefined
      equal(topologyError?.code, 'DUPLICATE_ID', 'commit TopologyError code')
      equal(topologyError?.path, '/id', 'commit TopologyError path')
      deepEqual(topologyError?.details, { existing: 'graph-demo' }, 'commit safe details')
      assert(!JSON.stringify(details).includes('secret commit message'), 'commit message must not leak')
    },
  },
  {
    name: 'generation invalidated immediately after commit compensates and cannot publish ready',
    run: async () => {
      const harness = createHarness()
      harness.behavior.createGraph = (input) => {
        harness.graphInputs.push(input)
        const snapshot = graphSnapshot(input)
        harness.graphs.set(snapshot.id, snapshot)
        harness.lifecycle.invalidate()
        return snapshot
      }
      const result = await harness.lifecycle.select(harness.manifest[0]!.url, harness.manifest)
      equal(result.kind, 'stale', 'post-commit stale result')
      equal(harness.lifecycle.snapshot.status, 'idle', 'post-commit stale state')
      equal(harness.graphs.size, 0, 'post-commit stale graph count')
      deepEqual(harness.removedGraphIds, ['graph-demo'], 'post-commit precise compensation')
    },
  },
  {
    name: 'A to B late completion cannot change B state or leave A model/graph',
    run: async () => {
      const a = record({ filename: 'a.glb', url: '/models/demo/a.glb' })
      const b = record({ filename: 'b.glb', url: '/models/demo/b.glb' })
      const bytesA = makeGlb({ asset: { version: '2.0' }, extras: { name: 'a' } })
      const bytesB = makeGlb({ asset: { version: '2.0' }, extras: { name: 'b' } })
      const harness = createHarness({
        manifest: [a, b],
        buffers: new Map([[a.url, bytesA], [b.url, bytesB]]),
      })
      const gate = deferred<void>()
      let aStarted = false
      let aLateRoot: THREE.Object3D | null = null
      harness.behavior.loadFloor = async (url) => {
        if (url !== a.url) return harness.defaultLoadFloor(url)
        equal(harness.cache.files[url], bytesA, 'A synchronous cache capture')
        const epoch = harness.modelEpoch
        aStarted = true
        await gate.promise
        if (epoch !== harness.modelEpoch) throw new Error('A cancelled by unloadAll')
        const root = new THREE.Group()
        aLateRoot = root
        harness.scene.add(root)
        return { floorName: 'a', url, root }
      }
      harness.behavior.compileSidecar = (_text, context) => {
        harness.compileContexts.push(context)
        const id = context.loadedAssets[0]!.canonicalUri.endsWith('/b.glb') ? 'graph-b' : 'graph-a'
        return { ok: true, input: graphInput(id) } as TopologySidecarCompileResult
      }

      const aPromise = harness.lifecycle.select(a.url, harness.manifest)
      await until(() => aStarted, 'A loadFloor did not start')
      const bPromise = harness.lifecycle.select(b.url, harness.manifest)
      const aSignal = harness.fetchCalls.find((call) => call.url === a.url)?.signal
      equal(aSignal?.aborted, true, 'A signal must abort when B starts')
      deepEqual(harness.cleanupAbortStates.slice(4, 8), [true, true, true, true], 'abort must precede B cleanup')
      const bResult = await bPromise
      equal(bResult.kind, 'loaded', 'B result')
      equal(harness.lifecycle.snapshot.graphId, 'graph-b', 'B graph state')
      gate.resolve()
      const aResult = await aPromise
      equal(aResult.kind, 'stale', 'A late result')
      equal(harness.lifecycle.snapshot.graphId, 'graph-b', 'A cannot overwrite B graph state')
      assert(!harness.graphs.has('graph-a'), 'A graph must not exist')
      assert(harness.graphs.has('graph-b'), 'B graph must remain')
      assert(!harness.loadedRoots.has(a.url), 'A root must not remain')
      assert(harness.loadedRoots.has(b.url), 'B root must remain')
      equal(aLateRoot, null, 'A cancelled load must never create a late scene root')
    },
  },
  {
    name: 'stale A compensation cannot remove B when both generations reuse one graph id',
    run: async () => {
      const a = record({ filename: 'a.glb', url: '/models/demo/a.glb' })
      const b = record({ filename: 'b.glb', url: '/models/demo/b.glb' })
      const harness = createHarness({ manifest: [a, b] })
      harness.behavior.compileSidecar = (_text, context) => {
        harness.compileContexts.push(context)
        return { ok: true, input: graphInput('shared-graph') } as TopologySidecarCompileResult
      }

      let bPromise: ReturnType<typeof harness.lifecycle.select> | null = null
      let commitCount = 0
      harness.behavior.createGraph = (input) => {
        commitCount += 1
        harness.graphInputs.push(input)
        const snapshot = graphSnapshot(input)
        harness.graphs.set(snapshot.id, snapshot)
        if (commitCount === 1) {
          bPromise = harness.lifecycle.select(b.url, harness.manifest)
        }
        return snapshot
      }

      const aResult = await harness.lifecycle.select(a.url, harness.manifest)
      equal(aResult.kind, 'stale', 'A result after reentrant B selection')
      const pendingB = bPromise as ReturnType<typeof harness.lifecycle.select> | null
      assert(pendingB !== null, 'B selection must start during A commit')
      const bResult = await pendingB
      equal(bResult.kind, 'loaded', 'B result')
      equal(harness.lifecycle.snapshot.status, 'ready', 'B topology state')
      equal(harness.lifecycle.snapshot.graphId, 'shared-graph', 'B graph id')
      assert(harness.graphs.has('shared-graph'), 'B graph must survive A stale compensation')
      assert(harness.loadedRoots.has(b.url), 'B model root must remain visible')
      assert(!harness.loadedRoots.has(a.url), 'A model root must be removed by B cleanup')
      equal(commitCount, 2, 'both generations reach one synchronous commit attempt')
    },
  },
  {
    name: 'switch, empty selection, and unload invalidate first and preserve cleanup order',
    run: async () => {
      const harness = createHarness()
      const first = await harness.lifecycle.select(harness.manifest[0]!.url, harness.manifest)
      equal(first.kind, 'loaded', 'initial selection')
      deepEqual(harness.cleanupEvents.slice(0, 4), cleanupOrder, 'selection cleanup order')

      const beforeEmptyGeneration = first.generation
      const empty = await harness.lifecycle.select('', harness.manifest)
      equal(empty.kind, 'empty', 'empty result')
      assert(empty.generation > beforeEmptyGeneration, 'empty must invalidate generation')
      deepEqual(harness.cleanupEvents.slice(4, 8), cleanupOrder, 'empty cleanup order')
      equal(harness.lifecycle.snapshot.status, 'idle', 'empty state')

      const unloadGeneration = harness.lifecycle.invalidateAndCleanup()
      assert(unloadGeneration > empty.generation, 'unload must invalidate generation')
      deepEqual(harness.cleanupEvents.slice(8, 12), cleanupOrder, 'unload cleanup order')
      equal(harness.lifecycle.snapshot.status, 'idle', 'unload state')
    },
  },
  {
    name: 'precise graph compensation failure falls back to route and graph cleanup',
    run: async () => {
      const harness = createHarness()
      harness.behavior.createGraph = (input) => {
        harness.graphInputs.push(input)
        const committed = graphSnapshot(input)
        harness.graphs.set(committed.id, committed)
        return graphSnapshot(input, 'wrong-id')
      }
      harness.behavior.removeGraph = () => {
        throw new Error('precise removeGraph unavailable')
      }

      const result = await harness.lifecycle.select(harness.manifest[0]!.url, harness.manifest)
      equal(result.kind, 'loaded', 'fallback model result')
      equal(harness.lifecycle.snapshot.status, 'error', 'fallback topology state')
      equal(harness.lifecycle.snapshot.diagnostic?.details.compensationFallbackUsed, true, 'fallback diagnostic')
      equal(harness.lifecycle.snapshot.diagnostic?.details.compensationFailed, false, 'fallback completion')
      equal(harness.graphs.size, 0, 'fallback must leave no graph')
      deepEqual(
        harness.cleanupEvents.slice(-2),
        ['removeAllRoutes', 'removeAllGraphs'],
        'fallback cleanup order',
      )
    },
  },
  {
    name: 'file proof eligibility failures retain the exact-byte visual without a refetch',
    run: async () => {
      const cases = [
        {
          name: 'WebCrypto unavailable',
          bytes: makeGlb(),
          failDigest: true,
          expectedDigestAttempts: 1,
        },
        {
          name: 'external GLB buffer',
          bytes: makeGlb({ asset: { version: '2.0' }, buffers: [{ uri: 'mesh.bin' }] }),
          failDigest: false,
          expectedDigestAttempts: 0,
        },
        {
          name: 'external GLB image',
          bytes: makeGlb({ asset: { version: '2.0' }, images: [{ uri: 'texture.png' }] }),
          failDigest: false,
          expectedDigestAttempts: 0,
        },
      ] as const

      for (const testCase of cases) {
        const model = record()
        const harness = createHarness({
          manifest: [model],
          buffers: new Map([[model.url, testCase.bytes]]),
          sidecarText: sidecarTextFor([model]),
        })
        let digestAttempts = 0
        harness.behavior.digestSha256 = async () => {
          digestAttempts += 1
          if (testCase.failDigest) throw new Error('SubtleCrypto unavailable')
          return 'a'.repeat(64)
        }
        useRealSidecarCompiler(harness)

        const result = await harness.lifecycle.select(model.url, harness.manifest)
        equal(result.kind, 'loaded', `${testCase.name} visual result`)
        if (result.kind === 'loaded') equal(result.assetCount, 1, `${testCase.name} visible count`)
        equal(harness.lifecycle.snapshot.status, 'error', `${testCase.name} topology state`)
        equal(
          harness.lifecycle.snapshot.diagnostic?.code,
          'SIDECAR_ASSET_BINDING_UNVERIFIABLE',
          `${testCase.name} diagnostic`,
        )
        equal(harness.loadedRoots.size, 1, `${testCase.name} visible roots`)
        equal(harness.compileContexts.length, 1, `${testCase.name} compile count`)
        equal(harness.compileContexts[0]!.loadedAssets.length, 1, `${testCase.name} loaded subset`)
        equal(harness.compileContexts[0]!.assetProofs.length, 0, `${testCase.name} proof subset`)
        equal(harness.graphInputs.length, 0, `${testCase.name} graph count`)
        equal(digestAttempts, testCase.expectedDigestAttempts, `${testCase.name} digest attempts`)
        deepEqual(
          harness.loadFloorCalls,
          [{ url: model.url, exactCacheHit: true }],
          `${testCase.name} exact-byte visual handoff`,
        )
        equal(
          harness.fetchCalls.filter((call) => call.url === model.url).length,
          1,
          `${testCase.name} coordinator GLB fetch count`,
        )
      }
    },
  },
  {
    name: 'initial file fetch failure falls back once to an ordinary visual loader without proof',
    run: async () => {
      const model = record()
      const harness = createHarness({
        manifest: [model],
        sidecarText: sidecarTextFor([model]),
      })
      useRealSidecarCompiler(harness)
      harness.behavior.fetch = async (url, init) => {
        if (url === model.url) {
          return response({ status: 500, url: new URL(url, 'https://space.test').href })
        }
        return harness.defaultFetch(url, init)
      }

      const result = await harness.lifecycle.select(model.url, harness.manifest)
      equal(result.kind, 'loaded', 'ordinary fallback visual result')
      if (result.kind === 'loaded') equal(result.assetCount, 1, 'ordinary fallback visible count')
      equal(harness.loadedRoots.size, 1, 'ordinary fallback visible roots')
      equal(harness.lifecycle.snapshot.status, 'error', 'ordinary fallback topology state')
      equal(
        harness.lifecycle.snapshot.diagnostic?.code,
        'SIDECAR_ASSET_BINDING_UNVERIFIABLE',
        'ordinary fallback compiler diagnostic',
      )
      deepEqual(
        harness.loadFloorCalls,
        [{ url: model.url, exactCacheHit: false }],
        'ordinary fallback must not claim a cache proof handoff',
      )
      equal(harness.digestInputs.length, 0, 'ordinary fallback digest count')
      equal(harness.compileContexts[0]!.loadedAssets.length, 1, 'ordinary fallback loaded subset')
      equal(harness.compileContexts[0]!.assetProofs.length, 0, 'ordinary fallback proof subset')
      equal(harness.graphInputs.length, 0, 'ordinary fallback graph count')
      equal(
        harness.fetchCalls.filter((call) => call.url === model.url).length,
        1,
        'ordinary fallback coordinator fetch count',
      )
    },
  },
  {
    name: 'file fetch and ordinary loader failure leaves no visual and no graph',
    run: async () => {
      const model = record()
      const harness = createHarness({
        manifest: [model],
        sidecarText: sidecarTextFor([model]),
      })
      harness.behavior.fetch = async (url, init) => {
        if (url === model.url) {
          return response({ status: 500, url: new URL(url, 'https://space.test').href })
        }
        return harness.defaultFetch(url, init)
      }
      harness.behavior.loadFloor = async () => {
        throw new Error('ordinary model loader failed')
      }

      const result = await harness.lifecycle.select(model.url, harness.manifest)
      equal(result.kind, 'model-error', 'fully failed file result')
      equal(harness.loadedRoots.size, 0, 'fully failed file visible roots')
      equal(harness.lifecycle.snapshot.diagnostic?.code, 'SIDECAR_ASSET_NOT_LOADED', 'fully failed file diagnostic')
      equal(harness.compileContexts.length, 0, 'fully failed file must not call even a permissive compiler')
      equal(harness.graphInputs.length, 0, 'fully failed file graph count')
    },
  },
  {
    name: 'invalid sidecar still outranks the zero-visual compiler gate',
    run: async () => {
      const model = record()
      const harness = createHarness({ manifest: [model], sidecarText: '{' })
      harness.behavior.fetch = async (url, init) => {
        if (url === model.url) {
          return response({ status: 500, url: new URL(url, 'https://space.test').href })
        }
        return harness.defaultFetch(url, init)
      }
      harness.behavior.loadFloor = async () => {
        throw new Error('ordinary model loader failed')
      }

      const result = await harness.lifecycle.select(model.url, harness.manifest)
      equal(result.kind, 'model-error', 'invalid sidecar zero-visual result')
      equal(harness.lifecycle.snapshot.diagnostic?.code, 'SIDECAR_JSON_INVALID', 'invalid sidecar priority')
      equal(harness.compileContexts.length, 0, 'zero-visual invalid sidecar must not call compiler')
      equal(harness.graphInputs.length, 0, 'zero-visual invalid sidecar graph count')
    },
  },
  {
    name: 'scene proof gaps keep all visuals while the real compiler rejects referenced assets',
    run: async () => {
      for (const variant of ['WebCrypto unavailable', 'external GLB dependency'] as const) {
        const selection = record({
          kind: 'scene',
          filename: 'hospital',
          subcategory: 'hospital',
          url: '/models/hospital',
        })
        const a = record({ filename: 'a.glb', subcategory: 'hospital', url: '/models/hospital/a.glb' })
        const b = record({ filename: 'b.glb', subcategory: 'hospital', url: '/models/hospital/b.glb' })
        const bytesA = makeGlb({ asset: { version: '2.0' }, extras: { name: 'a' } })
        const bytesB = variant === 'external GLB dependency'
          ? makeGlb({ asset: { version: '2.0' }, buffers: [{ uri: 'mesh.bin' }] })
          : makeGlb({ asset: { version: '2.0' }, extras: { name: 'b' } })
        const harness = createHarness({
          manifest: [selection, a, b],
          buffers: new Map([[a.url, bytesA], [b.url, bytesB]]),
          sidecarText: sidecarTextFor([a, b]),
        })
        if (variant === 'WebCrypto unavailable') {
          harness.behavior.digestSha256 = async () => {
            throw new Error('SubtleCrypto unavailable')
          }
        }
        useRealSidecarCompiler(harness)

        const result = await harness.lifecycle.select(selection.url, harness.manifest)
        equal(result.kind, 'loaded', `${variant} scene visual result`)
        if (result.kind === 'loaded') equal(result.assetCount, 2, `${variant} scene visible count`)
        equal(harness.loadedRoots.size, 2, `${variant} scene visible roots`)
        equal(harness.lifecycle.snapshot.status, 'error', `${variant} scene topology state`)
        equal(
          harness.lifecycle.snapshot.diagnostic?.code,
          'SIDECAR_ASSET_BINDING_UNVERIFIABLE',
          `${variant} scene diagnostic`,
        )
        equal(harness.compileContexts[0]!.loadedAssets.length, 2, `${variant} scene loaded subset`)
        equal(
          harness.compileContexts[0]!.assetProofs.length,
          variant === 'WebCrypto unavailable' ? 0 : 1,
          `${variant} scene proof subset`,
        )
        assert(
          harness.loadFloorCalls.every((call) => call.exactCacheHit),
          `${variant} scene must not use ordinary visual fallback`,
        )
        equal(harness.graphInputs.length, 0, `${variant} scene graph count`)
      }
    },
  },
  {
    name: 'scene settles one fully failed referenced member and retains successful visuals',
    run: async () => {
      const selection = record({
        kind: 'scene',
        filename: 'hospital',
        subcategory: 'hospital',
        url: '/models/hospital',
      })
      const a = record({ filename: 'a.glb', subcategory: 'hospital', url: '/models/hospital/a.glb' })
      const b = record({ filename: 'b.glb', subcategory: 'hospital', url: '/models/hospital/b.glb' })
      const harness = createHarness({
        manifest: [selection, a, b],
        sidecarText: sidecarTextFor([a, b]),
      })
      useRealSidecarCompiler(harness)
      harness.behavior.fetch = async (url, init) => {
        if (url === b.url) {
          return response({ status: 500, url: new URL(url, 'https://space.test').href })
        }
        return harness.defaultFetch(url, init)
      }
      harness.behavior.loadFloor = async (url) => {
        if (url === b.url) throw new Error('B ordinary loader failed')
        return harness.defaultLoadFloor(url)
      }

      const result = await harness.lifecycle.select(selection.url, harness.manifest)
      equal(result.kind, 'loaded', 'partial scene visual result')
      if (result.kind === 'loaded') equal(result.assetCount, 1, 'partial scene visible count')
      assert(harness.loadedRoots.has(a.url), 'successful scene asset remains visible')
      assert(!harness.loadedRoots.has(b.url), 'fully failed scene asset has no root')
      equal(harness.lifecycle.snapshot.diagnostic?.code, 'SIDECAR_PARTIAL_SCENE', 'partial scene diagnostic')
      equal(harness.compileContexts[0]!.loadedAssets.length, 1, 'partial scene loaded subset')
      equal(harness.compileContexts[0]!.assetProofs.length, 1, 'partial scene proof subset')
      equal(harness.graphInputs.length, 0, 'partial scene graph count')
      equal(
        harness.fetchCalls.find((call) => call.url === b.url)?.signal.aborted,
        false,
        'one member failure must not abort the current generation',
      )
    },
  },
  {
    name: 'scene parser failure after exact-byte handoff is isolated without fallback or refetch',
    run: async () => {
      const selection = record({
        kind: 'scene',
        filename: 'hospital',
        subcategory: 'hospital',
        url: '/models/hospital',
      })
      const a = record({ filename: 'a.glb', subcategory: 'hospital', url: '/models/hospital/a.glb' })
      const b = record({ filename: 'b.glb', subcategory: 'hospital', url: '/models/hospital/b.glb' })
      const harness = createHarness({
        manifest: [selection, a, b],
        sidecarText: sidecarTextFor([a, b]),
      })
      useRealSidecarCompiler(harness)
      harness.behavior.loadFloor = async (url) => {
        if (url === b.url) throw new Error('B GLB parser failed')
        return harness.defaultLoadFloor(url)
      }

      const result = await harness.lifecycle.select(selection.url, harness.manifest)
      equal(result.kind, 'loaded', 'parser failure scene visual result')
      if (result.kind === 'loaded') equal(result.assetCount, 1, 'parser failure visible count')
      assert(harness.loadedRoots.has(a.url), 'parser failure retains successful asset root')
      assert(!harness.loadedRoots.has(b.url), 'parser failure has no failed asset root')
      equal(harness.lifecycle.snapshot.diagnostic?.code, 'SIDECAR_PARTIAL_SCENE', 'parser failure diagnostic')
      equal(harness.compileContexts[0]!.loadedAssets.length, 1, 'parser failure loaded subset')
      equal(harness.compileContexts[0]!.assetProofs.length, 1, 'parser failure proof subset')
      deepEqual(
        harness.loadFloorCalls.filter((call) => call.url === b.url),
        [{ url: b.url, exactCacheHit: true }],
        'failed parser receives one exact-byte cache handoff',
      )
      equal(
        harness.fetchCalls.filter((call) => call.url === b.url).length,
        1,
        'failed parser asset fetch count',
      )
      equal(harness.graphInputs.length, 0, 'parser failure graph count')
    },
  },
  {
    name: 'failed unreferenced decoration asset does not block the referenced scene graph',
    run: async () => {
      const selection = record({
        kind: 'scene',
        filename: 'hospital',
        subcategory: 'hospital',
        url: '/models/hospital',
      })
      const referenced = record({ filename: 'main.glb', subcategory: 'hospital', url: '/models/hospital/main.glb' })
      const decoration = record({ filename: 'decor.glb', subcategory: 'hospital', url: '/models/hospital/decor.glb' })
      const harness = createHarness({
        manifest: [selection, referenced, decoration],
        sidecarText: sidecarTextFor([referenced], { graphId: 'decor-safe-graph' }),
      })
      useRealSidecarCompiler(harness)
      harness.behavior.fetch = async (url, init) => {
        if (url === decoration.url) {
          return response({ status: 500, url: new URL(url, 'https://space.test').href })
        }
        return harness.defaultFetch(url, init)
      }
      harness.behavior.loadFloor = async (url) => {
        if (url === decoration.url) throw new Error('decoration loader failed')
        return harness.defaultLoadFloor(url)
      }

      const result = await harness.lifecycle.select(selection.url, harness.manifest)
      equal(result.kind, 'loaded', 'decoration failure visual result')
      if (result.kind === 'loaded') equal(result.assetCount, 1, 'decoration failure visible count')
      equal(harness.lifecycle.snapshot.status, 'ready', 'decoration failure topology state')
      equal(harness.lifecycle.snapshot.graphId, 'decor-safe-graph', 'decoration-safe graph id')
      equal(harness.compileContexts[0]!.loadedAssets.length, 1, 'decoration failure loaded subset')
      equal(harness.compileContexts[0]!.assetProofs.length, 1, 'decoration failure proof subset')
      equal(harness.graphInputs.length, 1, 'decoration failure graph commit count')
      assert(harness.loadedRoots.has(referenced.url), 'referenced asset remains visible')
      assert(!harness.loadedRoots.has(decoration.url), 'failed decoration has no root')
    },
  },
]

export async function runTopologySceneLifecycleSuite(): Promise<TopologySceneLifecycleSuiteResult> {
  const started = performance.now()
  const names: string[] = []
  for (const test of tests) {
    try {
      await test.run()
      names.push(test.name)
    } catch (error) {
      const reason = error instanceof Error ? error.stack ?? error.message : String(error)
      throw new Error(`[topology-scene-lifecycle] ${test.name}\n${reason}`)
    }
  }
  return { passed: names.length, names, durationMs: performance.now() - started }
}
