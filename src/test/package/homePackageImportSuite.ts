import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ref } from 'vue'
import * as THREE from 'three'
import type { PackageDiagnostic } from '@/adapters/package'
import type { TopologySidecarDiagnostic } from '@/adapters/topology'
import type { ModelRecord } from '@/composables/useModelLibrary'
import {
  createHomeSceneSelectionController,
  STANDARD_MODEL_PACKAGE_INPUT_ACCEPT,
  STANDARD_MODEL_PACKAGE_MAX_BYTES,
  type HomePackageFile,
  type HomeSceneLifecyclePort,
  type HomeSceneSelectionController,
} from '@/composables/useHomeSceneSelection'
import type {
  TopologyAbsentPackageSessionSnapshotV2,
  TopologyModelSelectionResult,
  TopologyPackageSessionSnapshot,
  TopologyPackageSessionState,
  TopologySceneSessionStatus,
} from '@/topology'

type Test = { name: string; run: () => void | Promise<void> }

interface Deferred<T> {
  readonly promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

interface PendingPackageCall {
  readonly generation: number
  readonly kind: 'v1' | 'v2'
  readonly bytes: Uint8Array
  readonly deferred: Deferred<TopologyModelSelectionResult>
}

interface PendingLegacyCall {
  readonly generation: number
  readonly url: string
  readonly deferred: Deferred<TopologyModelSelectionResult>
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
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

async function until(predicate: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await Promise.resolve()
  }
  throw new Error(message)
}

const LEGACY_RECORD: ModelRecord = {
  kind: 'file',
  subcategory: 'legacy',
  filename: 'legacy.glb',
  url: '/models/legacy/legacy.glb',
  displayName: 'Legacy Floor',
  sizeBytes: 100,
  sizeMB: 0.1,
  mtime: 1,
}

class FakeLifecycle implements HomeSceneLifecyclePort {
  readonly status = ref<TopologySceneSessionStatus>('idle')
  readonly graphId = ref<string | null>(null)
  readonly diagnostic = ref<TopologySidecarDiagnostic | null>(null)
  readonly packageDiagnostic = ref<PackageDiagnostic | null>(null)
  readonly packageSession = ref<TopologyPackageSessionState | null>(null)
  readonly session = {
    status: this.status,
    graphId: this.graphId,
    diagnostic: this.diagnostic,
    packageDiagnostic: this.packageDiagnostic,
    packageSession: this.packageSession,
  }

  generation = 0
  cleanupCalls = 0
  visibleRoots = 0
  readonly packageCalls: PendingPackageCall[] = []
  readonly packageV2Calls: PendingPackageCall[] = []
  readonly legacyCalls: PendingLegacyCall[] = []

  private clearPublishedState(): void {
    this.status.value = 'idle'
    this.graphId.value = null
    this.diagnostic.value = null
    this.packageDiagnostic.value = null
    this.packageSession.value = null
    this.visibleRoots = 0
  }

  select(url: string): Promise<TopologyModelSelectionResult> {
    const generation = ++this.generation
    this.clearPublishedState()
    if (!url) return Promise.resolve({ kind: 'empty', generation })
    const call = { generation, url, deferred: deferred<TopologyModelSelectionResult>() }
    this.legacyCalls.push(call)
    this.status.value = 'loading'
    return call.deferred.promise
  }

  selectPackage(bytes: Uint8Array): Promise<TopologyModelSelectionResult> {
    const generation = ++this.generation
    this.clearPublishedState()
    const call = {
      generation,
      kind: 'v1' as const,
      bytes,
      deferred: deferred<TopologyModelSelectionResult>(),
    }
    this.packageCalls.push(call)
    this.status.value = 'loading'
    return call.deferred.promise
  }

  selectPackageV2(bytes: Uint8Array): Promise<TopologyModelSelectionResult> {
    const generation = ++this.generation
    this.clearPublishedState()
    const call = {
      generation,
      kind: 'v2' as const,
      bytes,
      deferred: deferred<TopologyModelSelectionResult>(),
    }
    this.packageV2Calls.push(call)
    this.status.value = 'loading'
    return call.deferred.promise
  }

  isGenerationCurrent(generation: number): boolean {
    return generation === this.generation
  }

  invalidateAndCleanup(): number {
    const generation = ++this.generation
    this.cleanupCalls += 1
    this.clearPublishedState()
    return generation
  }

  resolvePackage(
    index: number,
    identity: { packageId: string; revision: string; graphId?: string; floorCount?: number },
  ): void {
    const call = this.packageCalls[index]
    assert(call, `missing package call ${index}`)
    const floorCount = identity.floorCount ?? 2
    const graphId = identity.graphId ?? `graph-${identity.packageId}`
    if (this.isGenerationCurrent(call.generation)) {
      this.status.value = 'ready'
      this.graphId.value = graphId
      this.visibleRoots = floorCount
      this.packageSession.value = packageSession(identity.packageId, identity.revision, floorCount)
    }
    call.deferred.resolve({ kind: 'loaded', generation: call.generation, assetCount: floorCount })
  }

  resolvePackageV2(
    index: number,
    identity: { packageId: string; revision: string; floorCount?: number },
  ): void {
    const call = this.packageV2Calls[index]
    assert(call, `missing package v2 call ${index}`)
    const floorCount = identity.floorCount ?? 2
    if (this.isGenerationCurrent(call.generation)) {
      this.status.value = 'scene-ready'
      this.graphId.value = null
      this.visibleRoots = floorCount
      this.packageSession.value = packageSessionV2(
        identity.packageId,
        identity.revision,
        floorCount,
        call.generation,
      )
    }
    call.deferred.resolve({ kind: 'loaded', generation: call.generation, assetCount: floorCount })
  }

  rejectPackage(
    index: number,
    diagnostic: PackageDiagnostic | TopologySidecarDiagnostic,
  ): void {
    const call = this.packageCalls[index]
    assert(call, `missing package call ${index}`)
    if (this.isGenerationCurrent(call.generation)) {
      this.status.value = 'error'
      this.visibleRoots = 0
      if (diagnostic.code.startsWith('PACKAGE_')) {
        this.packageDiagnostic.value = diagnostic as PackageDiagnostic
      } else {
        this.diagnostic.value = diagnostic as TopologySidecarDiagnostic
      }
    }
    call.deferred.resolve({
      kind: 'model-error',
      generation: call.generation,
      message: '标准模型包校验失败',
    })
  }

  rejectPackageV2(index: number, diagnostic: PackageDiagnostic): void {
    const call = this.packageV2Calls[index]
    assert(call, `missing package v2 call ${index}`)
    if (this.isGenerationCurrent(call.generation)) {
      this.status.value = 'error'
      this.visibleRoots = 0
      this.packageDiagnostic.value = diagnostic
    }
    call.deferred.resolve({
      kind: 'model-error',
      generation: call.generation,
      message: 'Standard Model Package v2 校验失败',
    })
  }

  resolveLegacy(index: number, assetCount = 1): void {
    const call = this.legacyCalls[index]
    assert(call, `missing legacy call ${index}`)
    if (this.isGenerationCurrent(call.generation)) {
      this.status.value = 'ready'
      this.graphId.value = 'legacy-graph'
      this.visibleRoots = assetCount
    }
    call.deferred.resolve({ kind: 'loaded', generation: call.generation, assetCount })
  }
}

function packageSession(
  packageId: string,
  revision: string,
  floorCount: number,
): TopologyPackageSessionSnapshot {
  const scene = new THREE.Scene()
  return {
    manifestUri: `https://space.test/__space-model-package-v1/private/.transport/${packageId}`,
    packageId,
    revision,
    assets: Object.freeze(Array.from({ length: floorCount }, (_, index) => {
      const root = new THREE.Group()
      scene.add(root)
      return Object.freeze({
        assetId: `${packageId}/asset-${index}`,
        canonicalUri: `https://space.test/__space-model-package-v1/public/floor-${index}.glb`,
        floorName: `F${index}`,
        building: 'A',
        level: index,
        floorType: 'FLOOR',
        root,
      })
    })),
  }
}

function packageSessionV2(
  packageId: string,
  revision: string,
  floorCount: number,
  selectionGeneration: number,
): TopologyAbsentPackageSessionSnapshotV2 {
  const scene = new THREE.Scene()
  return {
    schemaVersion: 2,
    profile: 'TOPOLOGY_ABSENT_TRANSITION',
    manifestUri: `https://space.test/__space-model-package-v2/${packageId}/space-model-package.v2.json`,
    packageId,
    revision,
    assets: Object.freeze(Array.from({ length: floorCount }, (_, index) => {
      const root = new THREE.Group()
      scene.add(root)
      const floor = Object.freeze({
        floorName: `F${index}`,
        building: 'A',
        level: index,
        floorType: 'FLOOR',
      })
      return Object.freeze({
        assetId: `${packageId}/asset-${index}`,
        canonicalUri: `https://space.test/__space-model-package-v2/${packageId}/floor-${index}.glb`,
        ...floor,
        root,
        metadata: Object.freeze({
          scene: Object.freeze({ ...floor, name: `Floor ${index}` }),
          nodes: Object.freeze([]),
        }),
        resourceProof: Object.freeze({
          assetId: `${packageId}/asset-${index}`,
          canonicalUri: `https://space.test/__space-model-package-v2/${packageId}/floor-${index}.glb`,
          digest: Object.freeze({ algorithm: 'SHA-256' as const, value: 'a'.repeat(64) }),
          packageRevision: revision,
          root,
          selectionGeneration,
          provenance: 'SAME_RESPONSE_BYTES' as const,
        }),
      })
    })),
    topologyCapability: Object.freeze({
      capability: 'topology',
      status: 'UNAVAILABLE',
      code: 'TOPOLOGY_UNAVAILABLE',
      reasonCode: 'PACKAGE_DECLARED_ABSENT',
      packageSchemaVersion: 2,
    }),
  }
}

function packageDiagnostic(
  code: PackageDiagnostic['code'] = 'PACKAGE_DIGEST_MISMATCH',
  path = '/assets/0/digest',
  phase: PackageDiagnostic['phase'] = 'HASH',
): PackageDiagnostic {
  return {
    code,
    phase,
    path,
    manifestUri: 'https://space.test/.transport/private?token=secret',
    details: Object.freeze({ token: 'must-not-render' }),
  }
}

function sidecarDiagnostic(path: string): TopologySidecarDiagnostic {
  return {
    code: 'SIDECAR_ASSET_BINDING_MISMATCH',
    phase: 'BIND',
    message: 'secret https://space.test/.transport/private?token=secret',
    path,
    sidecarUri: 'https://space.test/.transport/topology.v1.json?token=secret',
    assetId: null,
    entityId: null,
    details: Object.freeze({ token: 'must-not-render' }),
  }
}

function fileFixture(
  name: string,
  bytes: Uint8Array,
  options: {
    size?: number
    readGate?: Deferred<ArrayBuffer>
    readError?: Error
  } = {},
): {
  readonly file: HomePackageFile
  readonly buffer: ArrayBuffer
  readonly readCount: () => number
} {
  const buffer = new Uint8Array(bytes).buffer
  let reads = 0
  return {
    buffer,
    readCount: () => reads,
    file: {
      name,
      size: options.size ?? buffer.byteLength,
      type: 'application/zip',
      async arrayBuffer() {
        reads += 1
        if (options.readError) throw options.readError
        return options.readGate ? options.readGate.promise : buffer
      },
    },
  }
}

function createHarness(options: { fitGates?: Deferred<void>[] } = {}): {
  readonly lifecycle: FakeLifecycle
  readonly controller: HomeSceneSelectionController
  readonly events: string[]
  readonly undoCount: () => number
} {
  const lifecycle = new FakeLifecycle()
  const events: string[] = []
  const fitGates = [...(options.fitGates ?? [])]
  let undoCount = 0
  let controller!: HomeSceneSelectionController
  controller = createHomeSceneSelectionController({
    lifecycle,
    getManifest: () => [LEGACY_RECORD],
    getLegacyLabel: (url) => url === LEGACY_RECORD.url ? LEGACY_RECORD.displayName : '清单模型',
    invalidateVisibilityUndo: () => { undoCount += 1 },
    fitScene: async () => {
      events.push(`fit:${controller.state.selectionLabel}`)
      const gate = fitGates.shift()
      if (gate) await gate.promise
    },
    captureMainViewpoint: async () => {
      events.push(`capture:${controller.state.selectionLabel}`)
    },
  })
  return { lifecycle, controller, events, undoCount: () => undoCount }
}

const tests: Test[] = [
  {
    name: 'ZIP success passes exact File bytes and publishes only safe package summary',
    run: async () => {
      const harness = createHarness()
      const input = fileFixture('hospital-standard.zip', new Uint8Array([1, 2, 3, 4]))
      const promise = harness.controller.selectPackageFile(input.file)
      await until(() => harness.lifecycle.packageCalls.length === 1, 'package call should start')
      equal(harness.controller.state.phase, 'processing', 'honest combined processing phase')
      assert(harness.controller.statusText().includes('Metadata'), 'processing text names Metadata validation')
      assert(harness.controller.statusText().includes('逐楼层加载'), 'processing text names floor loading')
      const call = harness.lifecycle.packageCalls[0]!
      equal(call.bytes.buffer, input.buffer, 'controller passes the exact File ArrayBuffer')
      deepEqual([...call.bytes], [1, 2, 3, 4], 'exact bytes')

      harness.lifecycle.resolvePackage(0, {
        packageId: 'hospital-a',
        revision: 'revision-7',
        graphId: 'hospital-graph',
      })
      await promise

      equal(harness.controller.state.phase, 'ready', 'ready phase')
      equal(harness.controller.statusText(), 'Topology 图就绪', 'graph-ready text')
      equal(harness.controller.state.hasVisibleScene, true, 'package suppresses empty state')
      equal(harness.controller.state.visibleAssetCount, 2, 'visible asset count')
      deepEqual(harness.controller.state.packageSummary, {
        fileName: 'hospital-standard.zip',
        kind: 'v1',
        packageId: 'hospital-a',
        revision: 'revision-7',
        floorCount: 2,
        readiness: 'graph-ready',
        graphId: 'hospital-graph',
        topologyCapability: null,
      }, 'safe package summary')
      assert(!JSON.stringify(harness.controller.state).includes('.transport'), 'summary hides transport identity')
      deepEqual(harness.events, ['fit:hospital-standard.zip', 'capture:hospital-standard.zip'], 'post-load sequence')
    },
  },
  {
    name: 'explicit v2 selection uses only the v2 lifecycle and publishes Scene Metadata readiness',
    run: async () => {
      const harness = createHarness()
      const input = fileFixture('building-v2.zip', new Uint8Array([2, 0, 2, 6]))
      const promise = harness.controller.selectPackageFile(input.file, 'v2')
      await until(() => harness.lifecycle.packageV2Calls.length === 1, 'package v2 call should start')

      equal(harness.lifecycle.packageCalls.length, 0, 'v2 never probes the v1 reader')
      equal(harness.controller.state.packageKind, 'v2', 'explicit v2 UI state')
      assert(harness.controller.statusText().includes('v2 ZIP'), 'v2 processing text')
      const call = harness.lifecycle.packageV2Calls[0]!
      equal(call.kind, 'v2', 'v2 call kind')
      equal(call.bytes.buffer, input.buffer, 'v2 receives exact File ArrayBuffer')

      harness.lifecycle.resolvePackageV2(0, {
        packageId: 'building-v2',
        revision: 'revision-v2',
        floorCount: 3,
      })
      await promise

      equal(harness.controller.state.phase, 'ready', 'v2 ready phase')
      equal(
        harness.controller.statusText(),
        'Scene/Metadata ready / Topology 未提供',
        'v2 readiness text',
      )
      equal(harness.controller.state.hasVisibleScene, true, 'v2 scene remains visible')
      equal(harness.controller.state.visibleAssetCount, 3, 'v2 visible floor count')
      deepEqual(harness.controller.state.packageSummary, {
        fileName: 'building-v2.zip',
        kind: 'v2',
        packageId: 'building-v2',
        revision: 'revision-v2',
        floorCount: 3,
        readiness: 'scene-metadata-ready',
        graphId: null,
        topologyCapability: {
          code: 'TOPOLOGY_UNAVAILABLE',
          reasonCode: 'PACKAGE_DECLARED_ABSENT',
        },
      }, 'safe v2 package summary')
      deepEqual(
        harness.events,
        ['fit:building-v2.zip', 'capture:building-v2.zip'],
        'v2 reuses scene finalization',
      )
      assert(!JSON.stringify(harness.controller.state).includes('.transport'), 'v2 UI hides transport')
    },
  },
  {
    name: 'v1 failure never retries the v2 reader',
    run: async () => {
      const harness = createHarness()
      const input = fileFixture('looks-like-v2.zip', new Uint8Array([1]))
      const promise = harness.controller.selectPackageFile(input.file, 'v1')
      await until(() => harness.lifecycle.packageCalls.length === 1, 'v1 call should start')
      harness.lifecycle.rejectPackage(0, packageDiagnostic('PACKAGE_RESOURCE_NOT_FOUND', '/topology'))
      await promise

      equal(harness.lifecycle.packageCalls.length, 1, 'one v1 attempt')
      equal(harness.lifecycle.packageV2Calls.length, 0, 'no v2 fallback')
      equal(harness.controller.state.phase, 'error', 'v1 failure stays failure')
      assert(
        harness.controller.state.errorText.includes('PACKAGE_RESOURCE_NOT_FOUND'),
        'v1 diagnostic remains visible',
      )
    },
  },
  {
    name: 'the same ZIP can be selected twice as two independent generations',
    run: async () => {
      const harness = createHarness()
      const input = fileFixture('same.zip', new Uint8Array([9, 8, 7]))
      const first = harness.controller.selectPackageFile(input.file)
      await until(() => harness.lifecycle.packageCalls.length === 1, 'first package call')
      harness.lifecycle.resolvePackage(0, { packageId: 'same', revision: 'r1' })
      await first

      const second = harness.controller.selectPackageFile(input.file)
      await until(() => harness.lifecycle.packageCalls.length === 2, 'second package call')
      harness.lifecycle.resolvePackage(1, { packageId: 'same', revision: 'r2' })
      await second

      equal(input.readCount(), 2, 'same File read twice')
      equal(harness.lifecycle.packageCalls.length, 2, 'same ZIP starts two lifecycle selections')
      equal(harness.controller.state.packageSummary?.revision, 'r2', 'second generation wins')
      equal(harness.lifecycle.visibleRoots, 2, 'only current package roots remain')
    },
  },
  {
    name: 'the same v2 ZIP can be explicitly retried without falling through to v1',
    run: async () => {
      const harness = createHarness()
      const input = fileFixture('same-v2.zip', new Uint8Array([2, 2]))
      const first = harness.controller.selectPackageFile(input.file, 'v2')
      await until(() => harness.lifecycle.packageV2Calls.length === 1, 'first v2 call')
      harness.lifecycle.resolvePackageV2(0, { packageId: 'same-v2', revision: 'r1' })
      await first

      const second = harness.controller.selectPackageFile(input.file, 'v2')
      await until(() => harness.lifecycle.packageV2Calls.length === 2, 'second v2 call')
      harness.lifecycle.resolvePackageV2(1, { packageId: 'same-v2', revision: 'r2' })
      await second

      equal(input.readCount(), 2, 'same v2 File read twice')
      equal(harness.lifecycle.packageCalls.length, 0, 'retry never calls v1')
      equal(harness.controller.state.packageSummary?.revision, 'r2', 'second v2 generation wins')
    },
  },
  {
    name: 'a late A lifecycle result cannot close B loading or replace B state',
    run: async () => {
      const harness = createHarness()
      const a = fileFixture('late-a.zip', new Uint8Array([1]))
      const b = fileFixture('current-b.zip', new Uint8Array([2]))
      const aPromise = harness.controller.selectPackageFile(a.file)
      await until(() => harness.lifecycle.packageCalls.length === 1, 'late A starts')
      const bPromise = harness.controller.selectPackageFile(b.file)
      await until(() => harness.lifecycle.packageCalls.length === 2, 'current B starts')

      harness.lifecycle.resolvePackage(0, { packageId: 'late-a', revision: 'a1' })
      await aPromise
      equal(harness.controller.state.loading, true, 'A finally leaves B loading active')
      equal(harness.controller.state.selectionLabel, 'current-b.zip', 'A leaves B label active')
      equal(harness.controller.state.packageSummary, null, 'A cannot publish a stale summary')

      harness.lifecycle.resolvePackage(1, { packageId: 'current-b', revision: 'b1' })
      await bPromise
      equal(harness.controller.state.loading, false, 'B owns final loading state')
      equal(harness.controller.state.packageSummary?.packageId, 'current-b', 'B summary wins')
    },
  },
  {
    name: 'A to B stale guard serializes fit/capture so the new package is final',
    run: async () => {
      const firstFit = deferred<void>()
      const harness = createHarness({ fitGates: [firstFit] })
      const a = fileFixture('A.zip', new Uint8Array([1]))
      const b = fileFixture('B.zip', new Uint8Array([2]))

      const aPromise = harness.controller.selectPackageFile(a.file)
      await until(() => harness.lifecycle.packageCalls.length === 1, 'A package call')
      harness.lifecycle.resolvePackage(0, { packageId: 'package-a', revision: 'a1' })
      await until(() => harness.events.length === 1, 'A fit should be in flight')
      deepEqual(harness.events, ['fit:A.zip'], 'A fit starts')

      const bPromise = harness.controller.selectPackageFile(b.file)
      await until(() => harness.lifecycle.packageCalls.length === 2, 'B package call')
      harness.lifecycle.resolvePackage(1, { packageId: 'package-b', revision: 'b1' })
      firstFit.resolve(undefined)
      await Promise.all([aPromise, bPromise])

      deepEqual(
        harness.events,
        ['fit:A.zip', 'fit:B.zip', 'capture:B.zip'],
        'stale A cannot capture after B and B finalizes last',
      )
      equal(harness.controller.state.packageSummary?.packageId, 'package-b', 'B summary wins')
      equal(harness.controller.state.loading, false, 'stale finally cannot close a newer request incorrectly')
    },
  },
  {
    name: 'ZIP and legacy selections invalidate each other through one lifecycle',
    run: async () => {
      const harness = createHarness()
      const packageA = fileFixture('package-a.zip', new Uint8Array([1, 1]))
      const stalePackage = harness.controller.selectPackageFile(packageA.file)
      await until(() => harness.lifecycle.packageCalls.length === 1, 'package A starts')
      const legacy = harness.controller.selectLegacy(LEGACY_RECORD.url)
      await until(() => harness.lifecycle.legacyCalls.length === 1, 'legacy starts')
      harness.lifecycle.resolveLegacy(0)
      await legacy
      harness.lifecycle.resolvePackage(0, { packageId: 'stale-package', revision: 'r0' })
      await stalePackage
      equal(harness.controller.state.source, 'legacy', 'legacy replaces package')
      equal(harness.controller.state.selectionLabel, LEGACY_RECORD.displayName, 'legacy label hides URL')
      equal(harness.lifecycle.packageSession.value, null, 'legacy has no package session')

      const staleLegacy = harness.controller.selectLegacy(LEGACY_RECORD.url)
      await until(() => harness.lifecycle.legacyCalls.length === 2, 'second legacy starts')
      const packageB = fileFixture('package-b.zip', new Uint8Array([2, 2]))
      const freshPackage = harness.controller.selectPackageFile(packageB.file)
      await until(() => harness.lifecycle.packageCalls.length === 2, 'package B starts')
      harness.lifecycle.resolvePackage(1, { packageId: 'fresh-package', revision: 'r2' })
      await freshPackage
      harness.lifecycle.resolveLegacy(1)
      await staleLegacy
      equal(harness.controller.state.source, 'package', 'package replaces legacy')
      equal(harness.controller.state.packageSummary?.packageId, 'fresh-package', 'fresh package remains')
      equal(harness.lifecycle.visibleRoots, 2, 'only package roots visible')
    },
  },
  {
    name: 'v1 v2 and legacy switch atomically through the shared controller',
    run: async () => {
      const harness = createHarness()
      const v1File = fileFixture('switch-v1.zip', new Uint8Array([1]))
      const v2File = fileFixture('switch-v2.zip', new Uint8Array([2]))

      const staleV1 = harness.controller.selectPackageFile(v1File.file, 'v1')
      await until(() => harness.lifecycle.packageCalls.length === 1, 'switch v1 starts')
      const freshV2 = harness.controller.selectPackageFile(v2File.file, 'v2')
      await until(() => harness.lifecycle.packageV2Calls.length === 1, 'switch v2 starts')
      harness.lifecycle.resolvePackage(0, { packageId: 'stale-v1', revision: 'r1' })
      await staleV1
      harness.lifecycle.resolvePackageV2(0, { packageId: 'fresh-v2', revision: 'r2' })
      await freshV2
      equal(harness.controller.state.packageSummary?.kind, 'v2', 'v2 replaces stale v1')
      equal(harness.controller.state.packageSummary?.graphId, null, 'v2 has no graph')

      const legacy = harness.controller.selectLegacy(LEGACY_RECORD.url)
      await until(() => harness.lifecycle.legacyCalls.length === 1, 'legacy after v2 starts')
      harness.lifecycle.resolveLegacy(0)
      await legacy
      equal(harness.controller.state.source, 'legacy', 'legacy replaces v2')
      equal(harness.controller.state.packageKind, null, 'legacy clears package kind')
      equal(harness.lifecycle.packageSession.value, null, 'legacy clears package session')

      const finalV1 = harness.controller.selectPackageFile(v1File.file, 'v1')
      await until(() => harness.lifecycle.packageCalls.length === 2, 'final v1 starts')
      harness.lifecycle.resolvePackage(1, { packageId: 'final-v1', revision: 'r3' })
      await finalV1
      equal(harness.controller.state.packageSummary?.kind, 'v1', 'v1 replaces legacy')
      equal(harness.controller.state.packageSummary?.graphId, 'graph-final-v1', 'v1 graph ready')
    },
  },
  {
    name: 'unmount cleanup invalidates pending file/lifecycle work and blocks later use',
    run: async () => {
      const harness = createHarness()
      const input = fileFixture('pending.zip', new Uint8Array([3, 3]))
      const pending = harness.controller.selectPackageFile(input.file)
      await until(() => harness.lifecycle.packageCalls.length === 1, 'pending package starts')
      harness.controller.invalidateAndCleanup(true)
      harness.lifecycle.resolvePackage(0, { packageId: 'late', revision: 'late' })
      await pending

      equal(harness.controller.state.source, 'empty', 'unmount resets source')
      equal(harness.controller.state.loading, false, 'unmount resets loading')
      equal(harness.controller.state.hasVisibleScene, false, 'unmount removes visible scene')
      equal(harness.lifecycle.visibleRoots, 0, 'unmount removes roots')
      equal(harness.lifecycle.graphId.value, null, 'unmount removes graph')
      deepEqual(harness.events, [], 'late result cannot fit or capture')
      await harness.controller.selectLegacy(LEGACY_RECORD.url)
      equal(harness.lifecycle.legacyCalls.length, 0, 'disposed controller ignores later selection')
    },
  },
  {
    name: 'diagnostics render only safe code phase and JSON path',
    run: async () => {
      const harness = createHarness()
      const first = fileFixture('bad-digest.zip', new Uint8Array([4]))
      const firstPromise = harness.controller.selectPackageFile(first.file)
      await until(() => harness.lifecycle.packageCalls.length === 1, 'digest package starts')
      harness.lifecycle.rejectPackage(0, packageDiagnostic())
      await firstPromise
      assert(
        harness.controller.state.errorText.includes('PACKAGE_DIGEST_MISMATCH · HASH · /assets/0/digest'),
        'package code phase and path displayed',
      )
      assert(!harness.controller.state.errorText.includes('.transport'), 'package transport hidden')
      assert(!harness.controller.state.errorText.includes('token'), 'package details hidden')
      equal(harness.controller.state.hasVisibleScene, false, 'failed package has no visible scene')

      const second = fileFixture('bad-sidecar.zip', new Uint8Array([5]))
      const secondPromise = harness.controller.selectPackageFile(second.file)
      await until(() => harness.lifecycle.packageCalls.length === 2, 'sidecar package starts')
      harness.lifecycle.rejectPackage(
        1,
        sidecarDiagnostic('https://space.test/.transport/private?token=secret'),
      )
      await secondPromise
      assert(
        harness.controller.state.errorText.includes('SIDECAR_ASSET_BINDING_MISMATCH · BIND · /'),
        'unsafe sidecar path redacted',
      )
      assert(!harness.controller.state.errorText.includes('.transport'), 'sidecar transport hidden')
      assert(!harness.controller.state.errorText.includes('secret'), 'sidecar message/details hidden')

      const third = fileFixture('bad-v2.zip', new Uint8Array([6]))
      const thirdPromise = harness.controller.selectPackageFile(third.file, 'v2')
      await until(() => harness.lifecycle.packageV2Calls.length === 1, 'v2 package starts')
      harness.lifecycle.rejectPackageV2(
        0,
        packageDiagnostic('PACKAGE_METADATA_INVALID', '/assets/0/metadata', 'METADATA'),
      )
      await thirdPromise
      equal(harness.controller.state.phase, 'error', 'v2 package failure is an error')
      equal(harness.controller.state.hasVisibleScene, false, 'failed v2 has no scene')
      equal(harness.controller.state.packageSummary, null, 'failed v2 has no ready summary')
      assert(
        harness.controller.state.errorText.includes('PACKAGE_METADATA_INVALID · METADATA · /assets/0/metadata'),
        'v2 package diagnostic stays distinct from capability absence',
      )
      assert(
        !harness.controller.state.errorText.includes('TOPOLOGY_UNAVAILABLE'),
        'v2 package failure is not capability absence',
      )
    },
  },
  {
    name: 'non-ZIP oversized and unreadable files clear old resources before rejection',
    run: async () => {
      const harness = createHarness()
      const valid = fileFixture('valid.zip', new Uint8Array([6]))
      const validPromise = harness.controller.selectPackageFile(valid.file)
      await until(() => harness.lifecycle.packageCalls.length === 1, 'valid package starts')
      harness.lifecycle.resolvePackage(0, { packageId: 'valid', revision: 'r1' })
      await validPromise
      equal(harness.lifecycle.visibleRoots, 2, 'valid roots visible before rejection')

      const notZip = fileFixture('legacy-batch.tar', new Uint8Array([7]))
      await harness.controller.selectPackageFile(notZip.file)
      equal(harness.lifecycle.packageCalls.length, 1, 'non-ZIP never reaches package lifecycle')
      equal(harness.lifecycle.visibleRoots, 0, 'non-ZIP clears previous roots')
      equal(harness.lifecycle.graphId.value, null, 'non-ZIP clears previous graph')
      assert(harness.controller.state.errorText.includes('PACKAGE_FIELD_INVALID'), 'non-ZIP diagnostic')

      const oversized = fileFixture('huge.zip', new Uint8Array(), {
        size: STANDARD_MODEL_PACKAGE_MAX_BYTES + 1,
      })
      await harness.controller.selectPackageFile(oversized.file)
      equal(oversized.readCount(), 0, 'oversized file rejected before read')
      assert(harness.controller.state.errorText.includes('PACKAGE_LIMIT_EXCEEDED'), 'size diagnostic')

      const unreadable = fileFixture('unreadable.zip', new Uint8Array([8]), {
        readError: new Error('private native file error'),
      })
      await harness.controller.selectPackageFile(unreadable.file)
      assert(harness.controller.state.errorText.includes('PACKAGE_RESOURCE_NOT_FOUND'), 'read diagnostic')
      assert(!harness.controller.state.errorText.includes('private native file error'), 'read error hidden')
      equal(harness.lifecycle.visibleRoots, 0, 'read failure leaves no roots')
      equal(harness.lifecycle.graphId.value, null, 'read failure leaves no graph')
    },
  },
  {
    name: 'HomeView wires a hidden reusable ZIP input without package parsing or transport URLs',
    run: () => {
      const homePath = fileURLToPath(new URL('../../views/HomeView.vue', import.meta.url))
      const source = readFileSync(homePath, 'utf8')
      equal(STANDARD_MODEL_PACKAGE_INPUT_ACCEPT, '.zip,application/zip', 'file accept contract')
      assert(source.includes('导入标准模型包 v1 ZIP'), 'explicit v1 ZIP action')
      assert(source.includes('导入标准模型包 v2 ZIP'), 'explicit v2 ZIP action')
      assert(source.includes("openPackagePicker('v1')"), 'v1 picker dispatch')
      assert(source.includes("openPackagePicker('v2')"), 'v2 picker dispatch')
      assert(source.includes('type="file"'), 'file input')
      assert(source.includes(':accept="STANDARD_MODEL_PACKAGE_INPUT_ACCEPT"'), 'ZIP accept binding')
      assert(source.includes('hidden'), 'file input hidden')
      assert(source.includes('sceneSelection.selectPackageFile(file, packageKind)'), 'versioned controller wiring')
      assert(source.includes('Scene/Metadata ready'), 'v2 scene readiness copy')
      assert(source.includes('Topology 未提供'), 'v2 topology absence copy')
      assert(source.includes('data-capability-code'), 'v2 capability code projection')
      assert(source.includes('data-reason-code'), 'v2 capability reason projection')
      assert(source.includes("input.value = ''"), 'same-file reset')
      assert(source.includes('sceneSelection.invalidateAndCleanup(true)'), 'unmount cleanup')
      assert(source.includes('!sceneSelection.state.hasVisibleScene'), 'package-aware empty state')
      assert(!source.includes('parsePackageZipV1'), 'Home does not parse packages')
      assert(!source.includes('parsePackageZipV2'), 'Home does not parse v2 packages')
      assert(!source.includes("from 'fflate'"), 'Home does not unzip packages')
      assert(!source.includes('URL.createObjectURL'), 'Home creates no object URL')
      assert(!source.includes('.transport'), 'Home renders no transport URI')
    },
  },
]

export async function runHomePackageImportSuite(): Promise<{
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
  return {
    passed: names.length,
    names: Object.freeze(names),
    durationMs: performance.now() - start,
  }
}
