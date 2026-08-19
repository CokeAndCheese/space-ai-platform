import * as THREE from 'three'
import {
  TOPOLOGY_OVERRIDE_MAX_OPERATIONS,
  topologyOverrideTool,
} from '../../adapters/glbTopology/manualOverrideTool'
import { createTopologyTool, type TopologyTool } from '../../ssp/topology/topologyTool'
import {
  TopologyError,
  type TopologyGraphInput,
  type TopologyRouteRenderOptions,
  type TopologyRouteRenderResult,
  type TopologyRouteSnapshot,
} from '../../ssp/topology/types'
import {
  cloneWithInvalidCoordinateSpace,
  cloneWithInvalidEndpoint,
  cloneWithInvalidSchemaVersion,
  cloneWithNonFiniteCoordinate,
  createEmbeddedTopologyFixture,
  createWorldTransform,
  type EmbeddedTopologyFixture,
} from './fixtures'
import { findNonSameLayerOverrideEdgeIds } from '../sandbox/topologyEditor'

type TestBody = () => void | Promise<void>

interface TestCase {
  name: string
  run: TestBody
}

interface ValidationFailure {
  path?: string
  message?: string
}

interface ValidationResult {
  ok?: boolean
  value?: unknown
  issues?: readonly ValidationFailure[]
  errors?: readonly ValidationFailure[]
}

interface GlbTopologyAssetMount {
  graphIds: readonly string[]
  routeIds: readonly string[]
  renderRoute(options: TopologyRouteRenderOptions): TopologyRouteRenderResult
  removeRoute(routeId: string): boolean
  dispose(): void
}

interface GlbTopologyRuntime {
  attach(options: {
    assetId: string
    root: THREE.Object3D
    topology?: unknown
  }): GlbTopologyAssetMount
  dispose(): void
}

interface GlbTopologyRuntimeTool {
  createGraph(input: TopologyGraphInput): { id: string }
  getGraph(id: string): { id: string } | null
  removeGraph(id: string): boolean
  renderRoute: TopologyTool['renderRoute']
  removeRoute: TopologyTool['removeRoute']
}

interface GlbTopologyAdapterModule {
  validateEmbeddedTopology(value: unknown): ValidationResult | boolean | void
  buildWorldGraphs(
    topology: EmbeddedTopologyFixture,
    modelRoot: THREE.Object3D,
  ): readonly TopologyGraphInput[] | { graphs: readonly TopologyGraphInput[] }
  createGlbTopologyRuntime(tool: GlbTopologyRuntimeTool): GlbTopologyRuntime
}

export interface GlbTopologySuiteResult {
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

function closeTo(actual: number, expected: number, message: string, epsilon = 1e-9): void {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > epsilon) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`)
  }
}

function expectTopologyError(run: () => unknown, code: TopologyError['code'], message: string): void {
  try {
    run()
  } catch (error) {
    assert(error instanceof TopologyError, `${message}: expected TopologyError`)
    equal(error.code, code, message)
    return
  }
  throw new Error(`${message}: expected an exception`)
}

function normalizeGraphs(
  value: readonly TopologyGraphInput[] | { graphs: readonly TopologyGraphInput[] },
): readonly TopologyGraphInput[] {
  return Array.isArray(value) ? value : (value as { graphs: readonly TopologyGraphInput[] }).graphs
}

function validationAccepted(result: ValidationResult | boolean | void): boolean {
  if (result === false) return false
  if (result && typeof result === 'object' && 'ok' in result) return result.ok === true
  return true
}

function validationIssues(result: ValidationResult | boolean | void): string {
  if (!result || typeof result !== 'object') return 'validator threw or returned false'
  const issues = result.issues ?? result.errors ?? []
  return issues.map((issue) => issue.path ? `${issue.path}: ${issue.message ?? 'invalid'}` : issue.message ?? 'invalid').join('; ')
}

function expectRejected(
  validate: GlbTopologyAdapterModule['validateEmbeddedTopology'],
  input: unknown,
  message: string,
): void {
  let rejected = false
  try {
    const result = validate(input)
    rejected = !validationAccepted(result)
  } catch {
    // Throwing a validation error is also an accepted negative-case API shape.
    rejected = true
  }
  assert(rejected, `${message}: malformed input was accepted`)
}

function requireAdapterExport<T extends keyof GlbTopologyAdapterModule>(
  module: Record<string, unknown>,
  name: T,
): GlbTopologyAdapterModule[T] {
  const value = module[name]
  if (typeof value !== 'function') {
    throw new Error(
      `runtime adapter export mismatch: expected src/adapters/glbTopology to export ${name}()`,
    )
  }
  return value as GlbTopologyAdapterModule[T]
}

async function loadAdapter(): Promise<GlbTopologyAdapterModule> {
  let imported: Record<string, unknown>
  try {
    imported = await import('../../adapters/glbTopology/index') as Record<string, unknown>
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(
      `runtime adapter unavailable: expected src/adapters/glbTopology/index.ts (${detail})`,
    )
  }

  return {
    validateEmbeddedTopology: requireAdapterExport(imported, 'validateEmbeddedTopology'),
    buildWorldGraphs: requireAdapterExport(imported, 'buildWorldGraphs'),
    createGlbTopologyRuntime: requireAdapterExport(imported, 'createGlbTopologyRuntime'),
  }
}

function assertGraphIsDetached(
  first: readonly TopologyGraphInput[],
  second: readonly TopologyGraphInput[],
  fixture: EmbeddedTopologyFixture,
): void {
  deepEqual(first, second, 'repeated conversion should be deterministic')
  const firstNode = first[0].nodes[0]
  const firstEdge = first[0].edges[0]
  const firstMetadata = firstNode.data as Record<string, unknown>
  const secondMetadata = second[0].nodes[0].data as Record<string, unknown>
  firstNode.position.x = 999
  firstEdge.path!.via[0].x = 999
  firstMetadata.sourceSid = 'mutated-by-consumer'
  firstNode.data = { changed: true }
  equal(fixture.graphs[0].nodes[0].position.x, 1, 'conversion must not mutate embedded node position')
  equal(fixture.graphs[0].edges[0].path!.via[0].x, 2, 'conversion must not mutate embedded via point')
  closeTo(second[0].nodes[0].position.x, 4, 'second conversion x should be detached')
  closeTo(second[0].nodes[0].position.y, 22, 'second conversion y should be detached')
  closeTo(second[0].nodes[0].position.z, 42, 'second conversion z should be detached')
  equal(secondMetadata.sourceSid, 'SPACE_A_1F', 'repeated conversion metadata should be detached')
  equal(
    (fixture.graphs[0].nodes[0].data as Record<string, unknown>).sourceSid,
    'SPACE_A_1F',
    'embedded metadata should not be mutated by conversion output',
  )
}

function assertWorldGraph(graphs: readonly TopologyGraphInput[]): void {
  equal(graphs.length, 1, 'fixture should produce one graph')
  const graph = graphs[0]
  deepEqual(graph.nodes.map((node) => node.id), ['space-a', 'portal-a'], 'node IDs should be preserved')
  closeTo(graph.nodes[0].position.x, 4, 'node world x')
  closeTo(graph.nodes[0].position.y, 22, 'node world y')
  closeTo(graph.nodes[0].position.z, 42, 'node world z')
  const via = graph.edges[0].path!.via
  closeTo(via[0].x, 1, 'first via world x')
  closeTo(via[0].y, 24, 'first via world y')
  closeTo(via[0].z, 42, 'first via world z')
  closeTo(via[1].x, 1, 'second via world x')
  closeTo(via[1].y, 26, 'second via world y')
  closeTo(via[1].z, 42, 'second via world z')
  deepEqual(graph.nodes[0].data, { sourceSid: 'SPACE_A_1F' }, 'node metadata should survive adaptation')
  deepEqual(graph.edges[0].data, { sourceSid: 'EDGE_SPACE_PORTAL_A_1F' }, 'edge metadata should survive adaptation')
}

const tests: TestCase[] = [
  {
    name: 'manual override service isolates baselines, resolves targets, and commits atomically',
    run: () => {
      topologyOverrideTool.clear()
      const fixture = createEmbeddedTopologyFixture()
      let successfulChanges = 0
      topologyOverrideTool.registerAsset({
        assetId: 'asset-a',
        topology: fixture,
        onChange: () => { successfulChanges += 1 },
      })
      equal(topologyOverrideTool.listTargets().length, 1, 'one registered asset should expose one target')
      equal(topologyOverrideTool.getDocument().overrideSchemaVersion, 2, 'new documents should be V2')
      equal(topologyOverrideTool.getDocument().target.graphId, fixture.graphs[0].id, 'unique target may omit selector')

      const detachedDocument = structuredClone(topologyOverrideTool.getDocument()) as unknown as { operations: Array<Record<string, unknown>> }
      detachedDocument.operations.push({
        seq: 1,
        type: 'REMOVE_EDGE',
        edgeId: 'space-to-portal',
        expect: { source: 'wrong', target: 'wrong' },
      })
      equal(topologyOverrideTool.getDocument().operations.length, 0, 'document reads must be detached')

      topologyOverrideTool.mutate({
        action: 'OVERRIDE_EDGE_PATH',
        edgeId: 'space-to-portal',
        path: { type: 'POLYLINE', via: [{ x: 2, y: 4, z: 3 }] },
      })
      equal(successfulChanges, 1, 'successful mutation should notify once')
      const effectiveAfterPath = topologyOverrideTool.getEffectiveGraph({ assetId: 'asset-a' })
      equal(effectiveAfterPath.edges[0].path!.via.length, 1, 'effective graph should include AI-like path mutation')
      equal(fixture.graphs[0].edges[0].path!.via.length, 2, 'baseline must remain immutable')

      topologyOverrideTool.mutate({
        action: 'ADD_NODE',
        target: { assetId: 'asset-a', graphId: fixture.graphs[0].id },
        node: { id: 'manual-node', layerId: 'A_1F', position: { x: 6, y: 2, z: 3 } },
      })
      assert(topologyOverrideTool.getEffectiveGraph({ assetId: 'asset-a' }).nodes.some((node) => node.id === 'manual-node'), 'added node should be effective')
      const detachedGraph = topologyOverrideTool.getEffectiveGraph({ assetId: 'asset-a' })
      detachedGraph.nodes.find((node) => node.id === 'space-a')!.position.x = 999
      equal(topologyOverrideTool.getEffectiveGraph({ assetId: 'asset-a' }).nodes.find((node) => node.id === 'space-a')!.position.x, 1, 'effective graph reads must be detached')

      topologyOverrideTool.mutate({
        action: 'RESET_EDGE_PATH',
        target: { assetId: 'asset-a', graphId: fixture.graphs[0].id },
        edgeId: 'space-to-portal',
      })
      equal(topologyOverrideTool.getEffectiveGraph({ assetId: 'asset-a' }).edges[0].path!.via.length, 2, 'reset should canonicalize to the baseline path')
      equal(topologyOverrideTool.getDocument({ assetId: 'asset-a' }).operations.length, 1, 'reset should remove the prior path operation rather than append an invalid restoration')

      topologyOverrideTool.registerAsset({
        assetId: 'asset-b',
        topology: fixture,
        onChange: () => { throw new Error('injected callback failure') },
      })
      let callbackFailed = false
      try {
        topologyOverrideTool.mutate({
          action: 'REMOVE_EDGE',
          target: { assetId: 'asset-b', graphId: fixture.graphs[0].id },
          edgeId: 'space-to-portal',
        })
      } catch {
        callbackFailed = true
      }
      assert(callbackFailed, 'callback failure should reject the mutation')
      equal(topologyOverrideTool.getDocument({ assetId: 'asset-b' }).operations.length, 0, 'callback failure must not commit')

      let reentrantRejected = false
      topologyOverrideTool.registerAsset({
        assetId: 'asset-reentrant',
        topology: fixture,
        onChange: () => {
          try {
            topologyOverrideTool.mutate({
              action: 'REMOVE_EDGE',
              target: { assetId: 'asset-reentrant', graphId: fixture.graphs[0].id },
              edgeId: 'space-to-portal',
            })
          } catch {
            reentrantRejected = true
          }
        },
      })
      topologyOverrideTool.mutate({
        action: 'OVERRIDE_EDGE_PATH',
        target: { assetId: 'asset-reentrant', graphId: fixture.graphs[0].id },
        edgeId: 'space-to-portal',
        path: { type: 'POLYLINE', via: [{ x: 3, y: 4, z: 3 }] },
      })
      assert(reentrantRejected, 'same-target mutation from onChange must be rejected')
      equal(
        topologyOverrideTool.getDocument({ assetId: 'asset-reentrant' }).operations.length,
        1,
        'outer mutation should commit exactly once after a caught reentrant attempt',
      )

      let subscriberAttempted = false
      const unsubscribe = topologyOverrideTool.subscribe(
        { assetId: 'asset-reentrant' },
        () => {
          subscriberAttempted = true
          throw new Error('injected subscriber failure')
        },
      )
      const originalConsoleError = console.error
      try {
        console.error = () => undefined
        topologyOverrideTool.mutate({
          action: 'ADD_NODE',
          target: { assetId: 'asset-reentrant', graphId: fixture.graphs[0].id },
          node: { id: 'subscriber-proof-node', layerId: 'A_1F', position: { x: 7, y: 2, z: 3 } },
        })
      } finally {
        console.error = originalConsoleError
        unsubscribe()
      }
      assert(subscriberAttempted, 'subscriber should receive the committed event')
      equal(
        topologyOverrideTool.getDocument({ assetId: 'asset-reentrant' }).operations.length,
        2,
        'subscriber failure must not roll back the committed document',
      )

      const beforeOversizedReplace = topologyOverrideTool.getDocument({ assetId: 'asset-a' })
      let oversizedRejected = false
      try {
        topologyOverrideTool.replaceDocument({ assetId: 'asset-a' }, {
          overrideSchemaVersion: 2,
          coordinateSpace: 'MODEL_LOCAL',
          target: { graphId: fixture.graphs[0].id },
          operations: Array.from(
            { length: TOPOLOGY_OVERRIDE_MAX_OPERATIONS + 1 },
            (_, index) => ({ seq: index + 1, type: 'REMOVE_EDGE' }),
          ),
        })
      } catch {
        oversizedRejected = true
      }
      assert(oversizedRejected, 'oversized operation logs must be rejected')
      deepEqual(
        topologyOverrideTool.getDocument({ assetId: 'asset-a' }),
        beforeOversizedReplace,
        'oversized replacement must leave the committed document unchanged',
      )

      let ambiguous = false
      try { topologyOverrideTool.getDocument({ graphId: fixture.graphs[0].id }) } catch { ambiguous = true }
      assert(ambiguous, 'graph-only resolution must reject ambiguous multi-asset targets')
      const sourcedFixture = structuredClone(fixture) as unknown as { graphs: Array<TopologyGraphInput> }
      sourcedFixture.graphs[0].data = { sourceAsset: 'building-a.glb' }
      topologyOverrideTool.registerAsset({ assetId: 'runtime-asset-name', topology: sourcedFixture })
      equal(topologyOverrideTool.getDocument({ assetId: 'runtime-asset-name' }).target.sourceAsset, 'building-a.glb', 'document sourceAsset must come from GLB metadata, not runtime assetId')
      topologyOverrideTool.clear()
    },
  },
  {
    name: 'browser override guard keeps cross-layer connector paths read-only',
    run: () => {
      const topology = structuredClone(createEmbeddedTopologyFixture()) as any
      topology.graphs[0].layers.push({ id: 'A_2F' })
      topology.graphs[0].nodes[0].connectorId = 'vertical-a'
      topology.graphs[0].nodes[1].connectorId = 'vertical-a'
      topology.graphs[0].nodes[1].layerId = 'A_2F'
      topology.graphs[0].edges[0].relation = 'CONNECTOR'
      const document = {
        overrideSchemaVersion: 1 as const,
        coordinateSpace: 'MODEL_LOCAL' as const,
        target: { graphId: topology.graphs[0].id },
        edgeOverrides: [{
          edgeId: topology.graphs[0].edges[0].id,
          expect: {
            source: topology.graphs[0].edges[0].source,
            target: topology.graphs[0].edges[0].target,
          },
          path: { type: 'POLYLINE' as const, via: [{ x: 2, y: 4, z: 3 }] },
        }],
      }
      deepEqual(
        findNonSameLayerOverrideEdgeIds(topology, document),
        ['space-to-portal'],
        'browser guard must reject a cross-layer imported override',
      )
      topology.graphs[0].nodes[1].layerId = 'A_1F'
      topology.graphs[0].edges[0].relation = 'LINK'
      deepEqual(
        findNonSameLayerOverrideEdgeIds(topology, document),
        [],
        'same-layer imported override should remain editable',
      )
    },
  },
  {
    name: 'embedded topology schema accepts the V1 contract and rejects malformed payloads',
    run: async () => {
      const adapter = await loadAdapter()
      const fixture = createEmbeddedTopologyFixture()
      const accepted = adapter.validateEmbeddedTopology(fixture)
      assert(validationAccepted(accepted), `valid V1 fixture was rejected: ${validationIssues(accepted)}`)

      expectRejected(adapter.validateEmbeddedTopology, cloneWithInvalidSchemaVersion(fixture), 'schemaVersion')
      expectRejected(adapter.validateEmbeddedTopology, cloneWithInvalidCoordinateSpace(fixture), 'coordinateSpace')
      expectRejected(adapter.validateEmbeddedTopology, cloneWithInvalidEndpoint(fixture), 'edge endpoint')
      expectRejected(adapter.validateEmbeddedTopology, cloneWithNonFiniteCoordinate(fixture), 'non-finite coordinate')
    },
  },
  {
    name: 'model-local nodes and edge via points are converted through matrixWorld',
    run: async () => {
      const adapter = await loadAdapter()
      const fixture = createEmbeddedTopologyFixture()
      const root = createWorldTransform()
      const graphs = normalizeGraphs(adapter.buildWorldGraphs(fixture, root))
      assertWorldGraph(graphs)
    },
  },
  {
    name: 'multiple graphs share one hierarchy update and matrixWorld snapshot',
    run: async () => {
      const adapter = await loadAdapter()
      const fixture = createEmbeddedTopologyFixture()
      const secondGraph: TopologyGraphInput = {
        ...fixture.graphs[0],
        id: 'model-topology:B_1F',
        nodes: fixture.graphs[0].nodes.map((node) => ({
          ...node,
          position: { ...node.position, y: node.position.y + 10 },
        })),
      }
      const topology = { ...fixture, graphs: [fixture.graphs[0], secondGraph] }
      const root = createWorldTransform()
      let updateCalls = 0
      const originalUpdateWorldMatrix = root.updateWorldMatrix
      root.updateWorldMatrix = (updateParents, updateChildren) => {
        updateCalls += 1
        originalUpdateWorldMatrix.call(root, updateParents, updateChildren)
      }

      const graphs = normalizeGraphs(adapter.buildWorldGraphs(topology, root))
      equal(updateCalls, 1, 'all graphs should share one root hierarchy update')
      equal(graphs.length, 2, 'two embedded graphs should be transformed')
      closeTo(graphs[0].nodes[0].position.x, 4, 'first graph should use the shared matrixWorld')
      closeTo(graphs[1].nodes[0].position.x, -26, 'second graph should use the shared matrixWorld')
      closeTo(graphs[1].nodes[0].position.y, 22, 'second graph world y should be transformed')
    },
  },
  {
    name: 'converted graphs are accepted by topologyTool without guessed connectivity',
    run: async () => {
      const adapter = await loadAdapter()
      const fixture = createEmbeddedTopologyFixture()
      const tool = createTopologyTool()
      const graphs = normalizeGraphs(adapter.buildWorldGraphs(fixture, createWorldTransform()))
      const snapshots = graphs.map((graph) => tool.createGraph(graph))
      equal(snapshots.length, 1, 'one converted graph should be accepted')
      equal(snapshots[0].id, 'model-topology:A_1F', 'graph ID should remain stable')
      equal(snapshots[0].edges[0].relation, 'LINK', 'same-layer edge relation should remain LINK')
      equal(snapshots[0].edges[0].direction, 'BIDIRECTIONAL', 'edge direction should remain explicit')
      equal(snapshots[0].edges[0].path.via.length, 2, 'accepted graph should retain via points')
      closeTo(
        snapshots[0].edges[0].baseWeight,
        snapshots[0].edges[0].length,
        'omitted geometric weight should be derived from transformed world-space path',
      )
      closeTo(
        snapshots[0].edges[0].routingState.effectiveWeight,
        snapshots[0].edges[0].length,
        'world-space geometric length should drive routing by default',
      )
      equal(tool.listGraphs().length, 1, 'accepted graph should be owned by the topology tool')
      expectTopologyError(() => tool.createGraph({
        ...graphs[0],
        id: 'invalid-zero-length',
        nodes: graphs[0].nodes.map((node) => ({
          ...node,
          position: { ...graphs[0].nodes[0].position },
        })),
        edges: [{
          ...graphs[0].edges[0],
          id: 'zero-length',
          path: { type: 'POLYLINE', via: [] },
        }],
      }), 'INVALID_GRAPH', 'zero-length graph should be rejected')
      tool.removeAllGraphs()
    },
  },
  {
    name: 'runtime adapter cleanup removes only graphs it owns and is idempotent',
    run: async () => {
      const adapter = await loadAdapter()
      const fixture = createEmbeddedTopologyFixture()
      const tool = createTopologyTool()
      const unrelated = tool.createGraph({
        id: 'unrelated-graph',
        layers: [{ id: 'L1' }],
        nodes: [{ id: 'unrelated', layerId: 'L1', position: { x: 0, y: 0, z: 0 } }],
        edges: [],
      })
      // The adapter contract uses null for a missing graph; topologyTool uses undefined.
      // Keep this normalization local so the test exercises the public adapter boundary.
      const runtimeTool: GlbTopologyRuntimeTool = {
        createGraph: (input) => tool.createGraph(input),
        getGraph: (id) => tool.getGraph(id) ?? null,
        removeGraph: (id) => tool.removeGraph(id),
        renderRoute: tool.renderRoute,
        removeRoute: tool.removeRoute,
      }
      const runtime = adapter.createGlbTopologyRuntime(runtimeTool)
      const mount = runtime.attach({
        assetId: 'fixture-a',
        root: createWorldTransform(),
        topology: fixture,
      })
      assert(mount && typeof mount.dispose === 'function', 'adapter must return a disposable asset mount')
      equal(mount.graphIds.length, 1, 'runtime should report one owned graph')
      const ownedGraphId = mount.graphIds[0]
      assert(ownedGraphId.includes('model-topology:A_1F'), 'owned graph ID should include source graph ID')
      assert(tool.getGraph(ownedGraphId), 'runtime should register its graph')
      mount.dispose()
      mount.dispose()
      equal(runtimeTool.getGraph(ownedGraphId), null, 'dispose should remove owned graph')
      assert(tool.getGraph(unrelated.id), 'dispose must preserve unrelated graph')
      runtime.dispose()
      tool.removeAllGraphs()
    },
  },
  {
    name: 'runtime replacement is atomic and owned route removal stays bounded',
    run: async () => {
      const adapter = await loadAdapter()
      const fixture = createEmbeddedTopologyFixture()
      const graphs = new Map<string, { id: string }>()
      const removedRoutes: string[] = []
      let rejectSecondGraph = false
      const runtimeTool: GlbTopologyRuntimeTool = {
        createGraph: (input) => {
          if (rejectSecondGraph && input.id?.includes('model-topology:B_1F')) {
            throw new Error('injected graph creation failure')
          }
          const graph = { id: input.id ?? 'graph' }
          graphs.set(graph.id, graph)
          return graph
        },
        getGraph: (id) => graphs.get(id) ?? null,
        removeGraph: (id) => graphs.delete(id),
        renderRoute: (options) => ({
          rendered: true,
          handle: {
            id: 'route-1',
            root: new THREE.Group(),
            route: options.route,
            status: 'ACTIVE',
          },
        }),
        removeRoute: (id) => {
          removedRoutes.push(id)
          return true
        },
      }
      const runtime = adapter.createGlbTopologyRuntime(runtimeTool)
      const mount = runtime.attach({ assetId: 'atomic-fixture', root: createWorldTransform(), topology: fixture })
      const originalGraphId = mount.graphIds[0]
      const route = mount.renderRoute({ route: { graphId: originalGraphId } as TopologyRouteSnapshot })
      assert(route.rendered, 'owned route should render')
      equal(mount.routeIds.length, 1, 'mount should track the live route')
      assert(mount.removeRoute(route.handle.id), 'owned route removal should reach the tool')
      equal(mount.routeIds.length, 0, 'removed route must leave the ownership set')
      assert(!mount.removeRoute(route.handle.id), 'already removed route must not be removed twice')
      equal(removedRoutes.length, 1, 'route removal should stay bounded')

      const replacement = {
        ...fixture,
        graphs: [
          fixture.graphs[0],
          { ...fixture.graphs[0], id: 'model-topology:B_1F' },
        ],
      }
      rejectSecondGraph = true
      let failed = false
      try {
        runtime.attach({ assetId: 'atomic-fixture', root: createWorldTransform(), topology: replacement })
      } catch {
        failed = true
      }
      assert(failed, 'injected replacement failure should escape')
      assert(graphs.has(originalGraphId), 'failed replacement must preserve the previous graph')
      equal(mount.graphIds[0], originalGraphId, 'previous mount must remain usable after failure')
      runtime.dispose()
    },
  },
  {
    name: 'mount rejects routes for graphs owned by another mount',
    run: async () => {
      const adapter = await loadAdapter()
      const fixture = createEmbeddedTopologyFixture()
      const tool = createTopologyTool()
      const unrelated = tool.createGraph({
        id: 'unrelated-route-graph',
        layers: [{ id: 'L1' }],
        nodes: [{ id: 'unrelated', layerId: 'L1', position: { x: 0, y: 0, z: 0 } }],
        edges: [],
      })
      let renderCalls = 0
      const runtimeTool: GlbTopologyRuntimeTool = {
        createGraph: (input) => tool.createGraph(input),
        getGraph: (id) => tool.getGraph(id) ?? null,
        removeGraph: (id) => tool.removeGraph(id),
        renderRoute: () => {
          renderCalls += 1
          return { rendered: false, code: 'GRAPH_NOT_FOUND' }
        },
        removeRoute: tool.removeRoute,
      }
      const runtime = adapter.createGlbTopologyRuntime(runtimeTool)
      const mount = runtime.attach({
        assetId: 'fixture-route-owner',
        root: createWorldTransform(),
        topology: fixture,
      })

      const result = mount.renderRoute({
        route: { graphId: unrelated.id } as TopologyRouteSnapshot,
      })
      assert(!result.rendered, 'mount should reject an unrelated graph route')
      equal(result.code, 'GRAPH_NOT_FOUND', 'unrelated graph route rejection code')
      equal(renderCalls, 0, 'unrelated graph route must not reach the topology tool')
      equal(mount.routeIds.length, 0, 'mount must not claim an unrelated route')
      assert(tool.getGraph(unrelated.id), 'unrelated graph must remain registered')

      runtime.dispose()
      tool.removeAllGraphs()
    },
  },
  {
    name: 'conversion returns deterministic detached data and preserves diagnostics metadata',
    run: async () => {
      const adapter = await loadAdapter()
      const fixture = createEmbeddedTopologyFixture()
      const root = createWorldTransform()
      const first = normalizeGraphs(adapter.buildWorldGraphs(fixture, root))
      const second = normalizeGraphs(adapter.buildWorldGraphs(fixture, root))
      assertGraphIsDetached(first, second, fixture)
    },
  },
]

export async function runGlbTopologySuite(): Promise<GlbTopologySuiteResult> {
  const startedAt = performance.now()
  const names: string[] = []
  for (const test of tests) {
    try {
      await test.run()
      names.push(test.name)
      console.log(`[glb-topology:test] PASS ${test.name}`)
    } catch (error) {
      const detail = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)
      throw new Error(`[glb-topology:test] FAIL ${test.name}\n${detail}`)
    }
  }
  return { passed: names.length, names, durationMs: performance.now() - startedAt }
}
