import { computed, shallowRef, type ComputedRef } from 'vue'
import * as THREE from 'three'
import type { TopologySidecarDiagnostic } from '@/adapters/topology'
import type { ModelRecord } from '@/composables/useModelLibrary'
import { ssp } from '@/ssp'
import {
  computeSha256Hex,
  createTopologySceneLifecycle,
  type TopologyCachePort,
  type TopologyModelSelectionResult,
  type TopologySceneSessionNode,
  type TopologySceneSessionSnapshot,
  type TopologySceneSessionStatus,
} from '@/topology'

export interface TopologySceneSession {
  status: ComputedRef<TopologySceneSessionStatus>
  graphId: ComputedRef<string | null>
  nodes: ComputedRef<readonly TopologySceneSessionNode[]>
  diagnostic: ComputedRef<TopologySidecarDiagnostic | null>
}

export interface UseTopologySceneLifecycleReturn {
  session: TopologySceneSession
  select(
    selectedUrl: string,
    manifest: readonly ModelRecord[],
  ): Promise<TopologyModelSelectionResult>
  isGenerationCurrent(generation: number): boolean
  invalidate(): number
  invalidateAndCleanup(): number
}

const initialSnapshot: TopologySceneSessionSnapshot = {
  status: 'idle',
  graphId: null,
  nodes: [],
  diagnostic: null,
}

const snapshot = shallowRef<TopologySceneSessionSnapshot>(initialSnapshot)
const session: TopologySceneSession = Object.freeze({
  status: computed(() => snapshot.value.status),
  graphId: computed(() => snapshot.value.graphId),
  nodes: computed(() => snapshot.value.nodes),
  diagnostic: computed(() => snapshot.value.diagnostic),
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
    isGenerationCurrent: (generation) => activeLifecycle.isGenerationCurrent(generation),
    invalidate: () => activeLifecycle.invalidate(),
    invalidateAndCleanup: () => activeLifecycle.invalidateAndCleanup(),
  }
}
