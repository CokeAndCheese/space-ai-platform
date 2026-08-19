import type {
  TopologyGraphInput,
  TopologyRouteRenderOptions,
  TopologyRouteRenderResult,
} from '../../ssp/topology/types'
import { extractEmbeddedTopology } from './extraction'
import { buildWorldGraphs } from './transform'
import type {
  GlbTopologyAssetMount,
  GlbTopologyAttachOptions,
  GlbTopologyRuntimeAdapterHandle,
  GlbTopologyRuntimeAdapterOptions,
  GlbTopologyRuntime,
  GlbTopologyRuntimeTool,
} from './types'
import { validateEmbeddedTopology } from './validation'

interface AssetRecord {
  assetId: string
  root: GlbTopologyAttachOptions['root']
  graphIds: string[]
  routeIds: Set<string>
  mount: GlbTopologyAssetMount
  disposed: boolean
}

function requireAssetId(assetId: string): string {
  if (typeof assetId !== 'string' || assetId.length === 0) {
    throw new Error('[glbTopology] assetId must be a non-empty string')
  }
  return assetId
}

function createGraphId(tool: GlbTopologyRuntimeTool, prefix: string, graph: TopologyGraphInput): string {
  const sourceId = graph.id ?? 'graph'
  let candidate = `${prefix}:${sourceId}`
  let suffix = 2
  while (tool.getGraph(candidate) !== null) {
    candidate = `${prefix}:${sourceId}~${suffix++}`
  }
  return candidate
}

export function createGlbTopologyRuntime(tool: GlbTopologyRuntimeTool): GlbTopologyRuntime {
  const assets = new Map<string, AssetRecord>()

  function disposeRecord(record: AssetRecord): void {
    if (record.disposed) return
    record.disposed = true
    for (const routeId of record.routeIds) tool.removeRoute(routeId)
    record.routeIds.clear()
    for (const graphId of record.graphIds) tool.removeGraph(graphId)
    record.graphIds.length = 0
    if (assets.get(record.assetId) === record) assets.delete(record.assetId)
  }

  function attach(options: GlbTopologyAttachOptions): GlbTopologyAssetMount {
    const assetId = requireAssetId(options.assetId)
    const topology = options.topology === undefined ? extractEmbeddedTopology(options.root) : validateEmbeddedTopology(options.topology)
    const graphs = topology ? buildWorldGraphs(topology, options.root) : []
    const previous = assets.get(assetId)

    const record: AssetRecord = {
      assetId,
      root: options.root,
      graphIds: [],
      routeIds: new Set(),
      mount: undefined as unknown as GlbTopologyAssetMount,
      disposed: false,
    }
    const prefix = `model-topology-runtime:${assetId}`
    try {
      for (const graph of graphs) {
        const id = createGraphId(tool, prefix, graph)
        const created = tool.createGraph({ ...graph, id })
        record.graphIds.push(created.id)
      }
    } catch (error) {
      disposeRecord(record)
      throw error
    }

    const mount: GlbTopologyAssetMount = {
      assetId,
      root: options.root,
      get graphIds() {
        return [...record.graphIds]
      },
      get routeIds() {
        return [...record.routeIds]
      },
      renderRoute(routeOptions: TopologyRouteRenderOptions): TopologyRouteRenderResult {
        if (record.disposed || !record.graphIds.includes(routeOptions.route.graphId)) {
          return { rendered: false, code: 'GRAPH_NOT_FOUND' }
        }
        const result = tool.renderRoute(routeOptions)
        if (result.rendered) record.routeIds.add(result.handle.id)
        return result
      },
      removeRoute(routeId: string): boolean {
        if (record.disposed || !record.routeIds.has(routeId)) return false
        const removed = tool.removeRoute(routeId)
        record.routeIds.delete(routeId)
        return removed
      },
      dispose: () => disposeRecord(record),
    }
    record.mount = mount
    if (previous) disposeRecord(previous)
    assets.set(assetId, record)
    return mount
  }

  function detach(assetId: string): boolean {
    const record = assets.get(assetId)
    if (!record) return false
    disposeRecord(record)
    return true
  }

  function clear(): number {
    const records = [...assets.values()]
    records.forEach(disposeRecord)
    return records.length
  }

  return {
    attach,
    detach,
    clear,
    get: (assetId) => assets.get(assetId)?.mount ?? null,
    list: () => [...assets.values()].map((record) => record.mount),
    dispose: () => {
      clear()
    },
  }
}

export const createGlbTopologyAdapter = createGlbTopologyRuntime

/**
 * Compatibility lifecycle for a single embedded asset.
 * Existing graph IDs are retained when available; a deterministic suffix is
 * used only if another graph already owns the requested ID.
 */
export function createGlbTopologyRuntimeAdapter(
  options: GlbTopologyRuntimeAdapterOptions,
): GlbTopologyRuntimeAdapterHandle {
  const topology = validateEmbeddedTopology(options.embeddedTopology)
  const graphs = buildWorldGraphs(topology, options.modelRoot)
  const graphIds: string[] = []
  const routeIds = new Set<string>()

  try {
    for (const graph of graphs) {
      const sourceId = graph.id ?? 'graph'
      let id = sourceId
      let suffix = 2
      while (options.topologyTool.getGraph(id) !== null) id = `${sourceId}~${suffix++}`
      const created = options.topologyTool.createGraph({ ...graph, id })
      graphIds.push(created.id)
    }
  } catch (error) {
    for (const graphId of graphIds) options.topologyTool.removeGraph(graphId)
    throw error
  }

  let disposed = false
  return {
    get graphIds() {
      return [...graphIds]
    },
    get routeIds() {
      return [...routeIds]
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      for (const routeId of routeIds) options.topologyTool.removeRoute(routeId)
      routeIds.clear()
      for (const graphId of graphIds) options.topologyTool.removeGraph(graphId)
      graphIds.length = 0
    },
  }
}
