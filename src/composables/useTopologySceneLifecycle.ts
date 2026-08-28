import { computed, shallowRef, type ComputedRef } from 'vue'
import * as THREE from 'three'
import type { TopologySidecarDiagnostic } from '@/adapters/topology'
import type { PackageDiagnostic } from '@/adapters/package'
import type { ModelRecord } from '@/composables/useModelLibrary'
import { ssp } from '@/ssp'
import {
  computeSha256Hex,
  createTopologySceneLifecycle,
  type TopologyCachePort,
  type TopologyModelSelectionResult,
  type PackageAssetResourceProofV2,
  type TopologyAbsentPackageSessionAssetV2,
  type TopologyPackageSessionAsset,
  type TopologyPackageSessionState,
  type TopologySceneSessionNode,
  type TopologySceneSessionSnapshot,
  type TopologySceneSessionStatus,
} from '@/topology'
import { installTopologyCapabilitySessionSource } from '@/templates/topologyCapabilityGate'

export interface TopologySceneSession {
  status: ComputedRef<TopologySceneSessionStatus>
  graphId: ComputedRef<string | null>
  nodes: ComputedRef<readonly TopologySceneSessionNode[]>
  diagnostic: ComputedRef<TopologySidecarDiagnostic | null>
  packageDiagnostic: ComputedRef<PackageDiagnostic | null>
  packageSession: ComputedRef<TopologyPackageSessionState | null>
}

export interface UseTopologySceneLifecycleReturn {
  session: TopologySceneSession
  select(
    selectedUrl: string,
    manifest: readonly ModelRecord[],
  ): Promise<TopologyModelSelectionResult>
  selectPackage(packageBytes: Uint8Array): Promise<TopologyModelSelectionResult>
  selectPackageV2(packageBytes: Uint8Array): Promise<TopologyModelSelectionResult>
  getPackageAssetById(assetId: string): TopologyPackageSessionAsset | null
  getPackageAssetsByFloorName(floorName: string): readonly TopologyPackageSessionAsset[]
  getPackageV2AssetById(assetId: string): TopologyAbsentPackageSessionAssetV2 | null
  getPackageV2ResourceProof(assetId: string): PackageAssetResourceProofV2 | null
  isGenerationCurrent(generation: number): boolean
  invalidate(): number
  invalidateAndCleanup(): number
}

const initialSnapshot: TopologySceneSessionSnapshot = {
  status: 'idle',
  graphId: null,
  nodes: [],
  diagnostic: null,
  packageDiagnostic: null,
  packageSession: null,
}

const snapshot = shallowRef<TopologySceneSessionSnapshot>(initialSnapshot)
installTopologyCapabilitySessionSource(() => snapshot.value)
const session: TopologySceneSession = Object.freeze({
  status: computed(() => snapshot.value.status),
  graphId: computed(() => snapshot.value.graphId),
  nodes: computed(() => snapshot.value.nodes),
  diagnostic: computed(() => snapshot.value.diagnostic),
  packageDiagnostic: computed(() => snapshot.value.packageDiagnostic),
  packageSession: computed(() => snapshot.value.packageSession),
})

let lifecycle: ReturnType<typeof createTopologySceneLifecycle> | null = null

function getLifecycle(): ReturnType<typeof createTopologySceneLifecycle> {
  if (lifecycle !== null) return lifecycle
  if (typeof window === 'undefined') {
    throw new Error('topology scene lifecycle requires a browser window')
  }

  lifecycle = createTopologySceneLifecycle(
    {
      origin: window.location.origin,
      fetch: (url, init) => window.fetch(url, init),
      digestSha256: (bytes) => computeSha256Hex(bytes, globalThis.crypto?.subtle),
      cache: THREE.Cache as unknown as TopologyCachePort,
      resolveLoaderUrl: (url) => THREE.DefaultLoadingManager.resolveURL(url),
      loadFloor: (url) => ssp.modelTool.loadFloor(url),
      unloadFloor: (transportKey) => ssp.modelTool.unloadFloor(transportKey),
      getScene: () => ssp.getContext().scene,
      createGraph: (input) => ssp.topologyTool.createGraph(input),
      getGraph: (id) => ssp.topologyTool.getGraph(id),
      removeGraph: (id) => ssp.topologyTool.removeGraph(id),
      removeAllRoutes: () => ssp.topologyTool.removeAllRoutes(),
      removeAllGraphs: () => ssp.topologyTool.removeAllGraphs(),
      removeAllLegacyTopologies: () => ssp.topologyTool.removeAll(),
      unloadAllModels: () => ssp.modelTool.unloadAll(),
      assetConcurrency: 3,
    },
    (state) => {
      snapshot.value = state
    },
  )
  return lifecycle
}

export function useTopologySceneLifecycle(): UseTopologySceneLifecycleReturn {
  const activeLifecycle = getLifecycle()
  return {
    session,
    select: (selectedUrl, manifest) => activeLifecycle.select(selectedUrl, manifest),
    selectPackage: (packageBytes) => activeLifecycle.selectPackage(packageBytes),
    selectPackageV2: (packageBytes) => activeLifecycle.selectPackageV2(packageBytes),
    getPackageAssetById: (assetId) => activeLifecycle.getPackageAssetById(assetId),
    getPackageAssetsByFloorName: (floorName) => (
      activeLifecycle.getPackageAssetsByFloorName(floorName)
    ),
    getPackageV2AssetById: (assetId) => activeLifecycle.getPackageV2AssetById(assetId),
    getPackageV2ResourceProof: (assetId) => activeLifecycle.getPackageV2ResourceProof(assetId),
    isGenerationCurrent: (generation) => activeLifecycle.isGenerationCurrent(generation),
    invalidate: () => activeLifecycle.invalidate(),
    invalidateAndCleanup: () => activeLifecycle.invalidateAndCleanup(),
  }
}
