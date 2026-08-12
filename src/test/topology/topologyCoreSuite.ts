import * as THREE from 'three'
import { clearSspContext, setSspContext } from '../../ssp/core/context'
import { createTopologyTool, type TopologyTool } from '../../ssp/topology/topologyTool'
import {
  TopologyError,
  type TopologyGraphInput,
  type TopologyPathResult,
  type TopologyRouteSnapshot,
} from '../../ssp/topology/types'

type TestBody = () => void | Promise<void>

interface TestCase {
  name: string
  run: TestBody
}

export interface TopologyCoreSuiteResult {
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
  if (Math.abs(actual - expected) > epsilon) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`)
  }
}

function path(result: TopologyPathResult, message: string): TopologyRouteSnapshot {
  if (!result.ok) throw new Error(`${message}: ${result.code} (${result.message})`)
  return result.route
}

function failureCode(result: TopologyPathResult, expected: string, message: string): void {
  assert(!result.ok, `${message}: expected failure, got a route`)
  equal(result.code, expected, message)
}

function topologyError(run: () => unknown, expectedCode: TopologyError['code'], message: string): void {
  try {
    run()
  } catch (error) {
    assert(error instanceof TopologyError, `${message}: expected TopologyError`)
    equal(error.code, expectedCode, message)
    return
  }
  throw new Error(`${message}: expected an exception`)
}

function oneLayerGraph(
  id: string,
  nodes: TopologyGraphInput['nodes'],
  edges: TopologyGraphInput['edges'],
): TopologyGraphInput {
  return { id, layers: [{ id: 'L1' }], nodes, edges }
}

function simpleGraph(id: string): TopologyGraphInput {
  return oneLayerGraph(
    id,
    [
      { id: 'start', layerId: 'L1', position: { x: 0, y: 0, z: 0 } },
      { id: 'goal', layerId: 'L1', position: { x: 4, y: 0, z: 0 } },
    ],
    [
      {
        id: 'edge',
        source: 'start',
        target: 'goal',
        relation: 'LINK',
        direction: 'BIDIRECTIONAL',
      },
    ],
  )
}

function installFakeContext(): THREE.Scene {
  const scene = new THREE.Scene()
  setSspContext({
    scene,
    camera: new THREE.PerspectiveCamera(),
    renderer: {} as THREE.WebGLRenderer,
    domElement: {} as HTMLElement,
  })
  return scene
}

const tests: TestCase[] = [
  {
    name: 'legacy and v2 cleanup APIs remain isolated',
    run: () => {
      const tool = createTopologyTool()
      tool.createGraph(simpleGraph('v2-survives-legacy-remove-all'))

      equal(tool.removeAll(), 0, 'legacy removeAll should count only legacy records')
      assert(
        tool.getGraph('v2-survives-legacy-remove-all'),
        'legacy removeAll must not silently remove v2 graphs',
      )
      equal(tool.removeAllGraphs(), 1, 'removeAllGraphs should own v2 graph cleanup')
      equal(tool.listGraphs().length, 0, 'v2 graph cleanup should leave no graphs')
    },
  },
  {
    name: 'opaque STAIR/FACILITY metadata remains readable in detached snapshots',
    run: () => {
      const tool = createTopologyTool()
      const snapshot = tool.createGraph(oneLayerGraph(
        'metadata',
        [
          {
            id: 'stair-north',
            layerId: 'L1',
            position: { x: 0, y: 0, z: 0 },
            connectorId: 'shaft-north',
            kind: 'STAIR',
            subtype: 'EVACUATION_STAIR',
            tags: ['vertical', 'egress'],
            data: { fireRated: true },
          },
          {
            id: 'hydrant-01',
            layerId: 'L1',
            position: { x: 1, y: 0, z: 0 },
            kind: 'FACILITY',
            subtype: 'HYDRANT',
            tags: ['fire'],
            data: { sid: 'FACILITY_A_1F_HYDRANT_01' },
          },
        ],
        [],
      ))

      const stair = snapshot.nodes.find((node) => node.kind === 'STAIR')
      const hydrant = snapshot.nodes.find(
        (node) => node.kind === 'FACILITY' && node.subtype === 'HYDRANT',
      )
      assert(stair, 'STAIR node should be readable by the template layer')
      assert(hydrant, 'FACILITY/HYDRANT node should be readable by the template layer')
      equal(stair.connectorId, 'shaft-north', 'connectorId should be preserved')
      deepEqual(stair.tags, ['vertical', 'egress'], 'STAIR tags should be preserved')
      equal(stair.data?.fireRated, true, 'STAIR opaque data should be preserved')
      equal(hydrant.data?.sid, 'FACILITY_A_1F_HYDRANT_01', 'FACILITY data should be preserved')

      ;(snapshot.nodes[0].position as { x: number }).x = 999
      equal(tool.getGraph('metadata')?.nodes[0].position.x, 0, 'snapshot mutation must not leak inward')
    },
  },
  {
    name: 'polyline geometry is the single source of edge length and default weight',
    run: () => {
      const tool = createTopologyTool()
      const snapshot = tool.createGraph(oneLayerGraph(
        'polyline',
        [
          { id: 'a', layerId: 'L1', position: { x: 0, y: 0, z: 0 } },
          { id: 'b', layerId: 'L1', position: { x: 3, y: 4, z: 0 } },
        ],
        [
          {
            id: 'bent',
            source: 'a',
            target: 'b',
            relation: 'LINK',
            direction: 'FORWARD',
            path: { type: 'POLYLINE', via: [{ x: 3, y: 0, z: 0 }] },
          },
        ],
      ))
      const edge = snapshot.edges[0]
      closeTo(edge.length, 7, 'polyline length should sum every segment')
      closeTo(edge.baseWeight, 7, 'omitted weight should default to geometry length')
      closeTo(edge.routingState.effectiveWeight, 7, 'effective weight should initially use base weight')
      deepEqual(edge.path.via, [{ x: 3, y: 0, z: 0 }], 'via points should remain readable')
    },
  },
  {
    name: 'cross-layer edges require CONNECTOR and matching opaque connectorId values',
    run: () => {
      const base = {
        layers: [{ id: 'A_1F' }, { id: 'A_2F' }],
        nodes: [
          {
            id: 'stair-1f',
            layerId: 'A_1F',
            position: { x: 0, y: 0, z: 0 },
            connectorId: 'shaft-a',
            kind: 'STAIR',
          },
          {
            id: 'stair-2f',
            layerId: 'A_2F',
            position: { x: 0, y: 3, z: 0 },
            connectorId: 'shaft-a',
            kind: 'STAIR',
          },
        ],
      } satisfies Pick<TopologyGraphInput, 'layers' | 'nodes'>

      const wrongRelation = createTopologyTool()
      topologyError(() => wrongRelation.createGraph({
        id: 'wrong-relation',
        ...base,
        edges: [{
          id: 'vertical',
          source: 'stair-1f',
          target: 'stair-2f',
          relation: 'LINK',
          direction: 'BIDIRECTIONAL',
        }],
      }), 'INVALID_GRAPH', 'cross-layer LINK should be rejected')
      equal(wrongRelation.listGraphs().length, 0, 'failed createGraph must be atomic')

      const wrongConnector = createTopologyTool()
      topologyError(() => wrongConnector.createGraph({
        id: 'wrong-connector',
        layers: base.layers,
        nodes: [base.nodes[0], { ...base.nodes[1], connectorId: 'shaft-b' }],
        edges: [{
          id: 'vertical',
          source: 'stair-1f',
          target: 'stair-2f',
          relation: 'CONNECTOR',
          direction: 'BIDIRECTIONAL',
        }],
      }), 'INVALID_GRAPH', 'mismatched connectorId should be rejected')

      const valid = createTopologyTool()
      const graph = valid.createGraph({
        id: 'valid-connector',
        ...base,
        edges: [{
          id: 'vertical',
          source: 'stair-1f',
          target: 'stair-2f',
          relation: 'CONNECTOR',
          direction: 'BIDIRECTIONAL',
        }],
      })
      equal(graph.edges[0].relation, 'CONNECTOR', 'valid connector should be retained')
      deepEqual(
        path(valid.findPath({
          graphId: graph.id,
          startNodeId: 'stair-1f',
          goalNodeId: 'stair-2f',
        }), 'valid connector should be routable').layerIds,
        ['A_1F', 'A_2F'],
        'route should expose traversed layers',
      )
    },
  },
  {
    name: 'routing and visual state use independent revisions and optimistic guards',
    run: () => {
      const tool = createTopologyTool()
      const graph = tool.createGraph(simpleGraph('revisions'))
      equal(graph.routingRevision, 1, 'initial routing revision')
      equal(graph.visualRevision, 1, 'initial visual revision')

      const visual = tool.setEdgeVisualState(
        graph.id,
        { edgeIds: ['edge'] },
        { color: '#123456', width: 0.2, opacity: 0.5 },
        { expectedRevision: 1 },
      )
      assert(visual.ok, 'visual mutation should succeed')
      equal(visual.changed, true, 'visual mutation should report a change')
      equal(visual.visualRevision, 2, 'visual revision should increment')
      equal(tool.getGraph(graph.id)?.routingRevision, 1, 'visual change must not change routing revision')

      const routing = tool.setEdgeRoutingState(
        graph.id,
        { edgeIds: ['edge'] },
        { weightOverride: 8 },
        { expectedRevision: 1 },
      )
      assert(routing.ok, 'routing mutation should succeed')
      equal(routing.changed, true, 'routing mutation should report a change')
      equal(routing.routingRevision, 2, 'routing revision should increment')
      equal(tool.getGraph(graph.id)?.visualRevision, 2, 'routing change must not change visual revision')

      const same = tool.setEdgeRoutingState(graph.id, { edgeIds: ['edge'] }, { weightOverride: 8 })
      assert(same.ok, 'idempotent routing mutation should succeed')
      equal(same.changed, false, 'idempotent routing mutation should not report a change')
      equal(same.routingRevision, 2, 'idempotent mutation should not increment revision')

      const staleRoutingGuard = tool.setEdgeRoutingState(
        graph.id,
        { all: true },
        { enabled: false },
        { expectedRevision: 1 },
      )
      assert(!staleRoutingGuard.ok, 'stale routing guard should fail')
      equal(staleRoutingGuard.code, 'REVISION_CONFLICT', 'routing guard failure code')
      equal(staleRoutingGuard.currentRevision, 2, 'routing guard should return current revision')

      const staleVisualGuard = tool.setEdgeVisualState(
        graph.id,
        { all: true },
        { color: '#ffffff' },
        { expectedRevision: 1 },
      )
      assert(!staleVisualGuard.ok, 'stale visual guard should fail')
      equal(staleVisualGuard.code, 'REVISION_CONFLICT', 'visual guard failure code')
      equal(staleVisualGuard.currentRevision, 2, 'visual guard should return current revision')
    },
  },
  {
    name: 'blockers and weight overrides affect routing without changing graph geometry',
    run: () => {
      const tool = createTopologyTool()
      const graph = tool.createGraph(oneLayerGraph(
        'edge-state',
        [
          { id: 's', layerId: 'L1', position: { x: 0, y: 0, z: 0 } },
          { id: 'a', layerId: 'L1', position: { x: 1, y: 0, z: 0 } },
          { id: 'b', layerId: 'L1', position: { x: 1, y: 0, z: 1 } },
          { id: 'g', layerId: 'L1', position: { x: 2, y: 0, z: 0 } },
        ],
        [
          { id: 'sa', source: 's', target: 'a', relation: 'LINK', direction: 'FORWARD', weight: 1 },
          { id: 'ag', source: 'a', target: 'g', relation: 'LINK', direction: 'FORWARD', weight: 1 },
          { id: 'sb', source: 's', target: 'b', relation: 'LINK', direction: 'FORWARD', weight: 2 },
          { id: 'bg', source: 'b', target: 'g', relation: 'LINK', direction: 'FORWARD', weight: 2 },
        ],
      ))

      deepEqual(
        path(tool.findPath({ graphId: graph.id, startNodeId: 's', goalNodeId: 'g' }), 'initial path').nodeIds,
        ['s', 'a', 'g'],
        'lower-weight branch should win initially',
      )

      const override = tool.setEdgeRoutingState(
        graph.id,
        { edgeIds: ['ag'] },
        { weightOverride: 10 },
      )
      assert(override.ok, 'weight override should succeed')
      closeTo(override.edges[0].length, 1, 'weight override must not alter geometry length')
      equal(override.edges[0].routingState.effectiveWeight, 10, 'override should become effective weight')
      deepEqual(
        path(tool.findPath({ graphId: graph.id, startNodeId: 's', goalNodeId: 'g' }), 'overridden path').nodeIds,
        ['s', 'b', 'g'],
        'weight override should change path selection',
      )

      const blocked = tool.setEdgeRoutingState(
        graph.id,
        { edgeIds: ['sb'] },
        { addBlockerIds: ['wall:partition-01', 'door:closed-02'] },
      )
      assert(blocked.ok, 'adding opaque blocker IDs should succeed')
      equal(blocked.edges[0].routingState.traversable, false, 'blocked edge should be non-traversable')
      deepEqual(
        blocked.edges[0].routingState.blockerIds,
        ['door:closed-02', 'wall:partition-01'],
        'blocker IDs should be stable and sorted',
      )
      deepEqual(
        path(tool.findPath({ graphId: graph.id, startNodeId: 's', goalNodeId: 'g' }), 'blocked path').nodeIds,
        ['s', 'a', 'g'],
        'blocked branch must not be traversed',
      )

      const restored = tool.setEdgeRoutingState(
        graph.id,
        { edgeIds: ['sb', 'ag'] },
        { blockerIds: [], weightOverride: null },
      )
      assert(restored.ok, 'clearing blockers and overrides should succeed')
      equal(restored.edges.every((edge) => edge.routingState.traversable), true, 'selected edges should be traversable')
    },
  },
  {
    name: 'requirement groups use exact constrained Dijkstra rather than greedy waypoint choice',
    run: () => {
      const tool = createTopologyTool()
      const graph = tool.createGraph(oneLayerGraph(
        'requirements',
        [
          { id: 's', layerId: 'L1', position: { x: 0, y: 0, z: 0 } },
          { id: 'near', layerId: 'L1', position: { x: 1, y: 0, z: 0 } },
          { id: 'far', layerId: 'L1', position: { x: 0, y: 0, z: 2 } },
          { id: 'hydrant', layerId: 'L1', position: { x: 3, y: 0, z: 0 }, kind: 'FACILITY', subtype: 'HYDRANT' },
          { id: 'g', layerId: 'L1', position: { x: 4, y: 0, z: 0 } },
        ],
        [
          { id: 's-near', source: 's', target: 'near', relation: 'LINK', direction: 'FORWARD', weight: 1 },
          { id: 'near-h', source: 'near', target: 'hydrant', relation: 'LINK', direction: 'FORWARD', weight: 100 },
          { id: 's-far', source: 's', target: 'far', relation: 'LINK', direction: 'FORWARD', weight: 4 },
          { id: 'far-h', source: 'far', target: 'hydrant', relation: 'LINK', direction: 'FORWARD', weight: 4 },
          { id: 's-h', source: 's', target: 'hydrant', relation: 'LINK', direction: 'FORWARD', weight: 0.5 },
          { id: 'h-g', source: 'hydrant', target: 'g', relation: 'LINK', direction: 'FORWARD', weight: 1 },
        ],
      ))

      const unconstrained = path(tool.findPath({
        graphId: graph.id,
        startNodeId: 's',
        goalNodeId: 'g',
      }), 'unconstrained path')
      deepEqual(unconstrained.nodeIds, ['s', 'hydrant', 'g'], 'unconstrained shortest path')

      const result = tool.findPath({
        graphId: graph.id,
        startNodeId: 's',
        goalNodeId: 'g',
        requirements: [
          { anyOfNodeIds: ['near', 'far'] },
          { anyOfNodeIds: ['hydrant'] },
        ],
      })
      assert(result.ok, 'constrained path should exist')
      equal(result.stats.algorithm, 'CONSTRAINED_DIJKSTRA', 'algorithm should be explicit')
      deepEqual(result.route.nodeIds, ['s', 'far', 'hydrant', 'g'], 'globally optimal required candidate should win')
      deepEqual(result.route.selectedRequirementNodeIds, ['far', 'hydrant'], 'selected requirement nodes')
      closeTo(result.route.totalWeight, 9, 'constrained route total weight')
    },
  },
  {
    name: 'bidirectional reverse traversal reverses every route point',
    run: () => {
      const tool = createTopologyTool()
      const graph = tool.createGraph(oneLayerGraph(
        'reverse-points',
        [
          { id: 'a', layerId: 'L1', position: { x: 0, y: 0, z: 0 } },
          { id: 'b', layerId: 'L1', position: { x: 5, y: 0, z: 0 } },
        ],
        [{
          id: 'curve',
          source: 'a',
          target: 'b',
          relation: 'LINK',
          direction: 'BIDIRECTIONAL',
          path: { type: 'POLYLINE', via: [{ x: 2, y: 1, z: 0 }] },
        }],
      ))
      const route = path(tool.findPath({
        graphId: graph.id,
        startNodeId: 'b',
        goalNodeId: 'a',
      }), 'reverse route')
      equal(route.steps[0].traversalDirection, 'REVERSE', 'traversal direction')
      deepEqual(route.steps[0].points, [
        { x: 5, y: 0, z: 0 },
        { x: 2, y: 1, z: 0 },
        { x: 0, y: 0, z: 0 },
      ], 'step points should follow travel direction')
      deepEqual(route.flattenedPoints, route.steps[0].points, 'flattened route should follow travel direction')
    },
  },
  {
    name: 'transient exclusions and unreachable requirements return explicit no-path results',
    run: () => {
      const tool = createTopologyTool()
      const graph = tool.createGraph(oneLayerGraph(
        'no-path',
        [
          { id: 'a', layerId: 'L1', position: { x: 0, y: 0, z: 0 } },
          { id: 'b', layerId: 'L1', position: { x: 1, y: 0, z: 0 } },
          { id: 'isolated', layerId: 'L1', position: { x: 2, y: 0, z: 0 } },
        ],
        [{ id: 'a-b', source: 'a', target: 'b', relation: 'LINK', direction: 'BIDIRECTIONAL' }],
      ))

      failureCode(tool.findPath({
        graphId: graph.id,
        startNodeId: 'a',
        goalNodeId: 'b',
        excludedEdgeIds: ['a-b'],
      }), 'NO_PATH', 'excluded only edge')
      failureCode(tool.findPath({
        graphId: graph.id,
        startNodeId: 'a',
        goalNodeId: 'b',
        excludedNodeIds: ['a'],
      }), 'NO_PATH', 'excluded endpoint')
      failureCode(tool.findPath({
        graphId: graph.id,
        startNodeId: 'a',
        goalNodeId: 'b',
        requirements: [{ anyOfNodeIds: ['isolated'] }],
      }), 'NO_PATH_SATISFYING_REQUIREMENTS', 'unreachable required node')
      failureCode(tool.findPath({
        graphId: graph.id,
        startNodeId: 'a',
        goalNodeId: 'b',
        maxWeight: 0.5,
      }), 'NO_PATH_WITHIN_WEIGHT', 'weight budget')
    },
  },
  {
    name: 'Three route lifecycle supports visual updates, stale invalidation, and disposal',
    run: () => {
      const scene = installFakeContext()
      const tool: TopologyTool = createTopologyTool()
      try {
        const graph = tool.createGraph(simpleGraph('render-route'))
        const route = path(tool.findPath({
          graphId: graph.id,
          startNodeId: 'start',
          goalNodeId: 'goal',
        }), 'route for rendering')
        const rendered = tool.renderRoute({
          route,
          style: { color: '#ff0000', width: 0.16, depthTest: true },
          flow: { active: true, speed: 3, spacing: 1, color: '#ffff00', size: 0.08 },
        })
        assert(rendered.rendered, 'current route should render')
        const handle = rendered.handle
        equal(handle.status, 'ACTIVE', 'new route status')
        equal(handle.root.parent, scene, 'route root should attach to current scene')
        assert(handle.root.children.length > 0, 'route should contain Three geometry')
        equal(tool.getRouteById(handle.id), handle, 'getRouteById should return the stable handle')
        deepEqual(tool.listRoutes().map((item) => item.id), [handle.id], 'listRoutes should include route')

        equal(tool.hideRoute(handle.id), true, 'hideRoute should succeed')
        equal(handle.status, 'HIDDEN', 'hidden status')
        equal(handle.root.visible, false, 'hidden root')
        equal(tool.showRoute(handle.id), true, 'showRoute should succeed')
        equal(handle.status, 'ACTIVE', 'shown status')
        equal(handle.root.visible, true, 'shown root')
        const rootBeforeRebuild = handle.root
        equal(tool.setRouteVisualState(handle.id, {
          width: 0.22,
          opacity: 0.7,
          flow: { active: true, speed: 2, spacing: 0.8 },
        }), true, 'route visual update should succeed')
        assert(handle.root !== rootBeforeRebuild, 'route visual update should rebuild owned geometry')
        equal(handle.root.parent, scene, 'rebuilt route should remain attached')

        const visual = tool.setEdgeVisualState(graph.id, { edgeIds: ['edge'] }, {
          visible: true,
          color: '#00ff00',
          width: 0.08,
          flow: { active: true, direction: 'BOTH', speed: 1, spacing: 1 },
        })
        assert(visual.ok, 'edge visual should render in fake context')
        equal(handle.status, 'ACTIVE', 'visual-only edge change must not invalidate route')
        assert(
          scene.children.some((child) => child.name === `topology_edge_${graph.id}_edge`),
          'visible network edge should attach to scene',
        )

        const routing = tool.setEdgeRoutingState(
          graph.id,
          { edgeIds: ['edge'] },
          { addBlockerIds: ['wall:test'] },
        )
        assert(routing.ok, 'routing change should succeed')
        deepEqual(routing.invalidatedRouteIds, [handle.id], 'routing change should report invalidated route')
        equal(handle.status, 'STALE', 'existing route should become stale')
        equal(handle.root.visible, false, 'stale route should be hidden')
        equal(tool.showRoute(handle.id), false, 'stale route cannot be shown')

        const rejected = tool.renderRoute({ route })
        assert(!rejected.rendered, 'stale route should be rejected by default')
        equal(rejected.code, 'STALE_ROUTE', 'stale render failure code')
        const snapshotRender = tool.renderRoute({ route, stalePolicy: 'SNAPSHOT', visible: false })
        assert(snapshotRender.rendered, 'SNAPSHOT policy should explicitly allow stale geometry')
        equal(snapshotRender.handle.status, 'HIDDEN', 'snapshot route should honor initial visibility')

        equal(tool.removeRoute(handle.id), true, 'removeRoute should dispose stale route')
        equal(handle.status, 'DISPOSED', 'removed route handle should expose disposed status')
        equal(handle.root.parent, null, 'removed route root should detach')
        equal(tool.removeRoute(handle.id), false, 'removeRoute should be idempotent')

        equal(tool.removeGraph(graph.id), true, 'removeGraph should succeed')
        equal(snapshotRender.handle.status, 'DISPOSED', 'graph removal should dispose its routes')
        equal(tool.listRoutes().length, 0, 'no routes should remain')
        assert(
          !scene.children.some((child) => child.userData.__sspTopologyGraphId === graph.id),
          'graph removal should detach all owned visuals',
        )
      } finally {
        tool.removeAllRoutes()
        tool.removeAllGraphs()
        clearSspContext()
      }
    },
  },
]

export async function runTopologyCoreSuite(): Promise<TopologyCoreSuiteResult> {
  const startedAt = performance.now()
  const names: string[] = []
  for (const test of tests) {
    try {
      await test.run()
      names.push(test.name)
      console.log(`[topology:test] PASS ${test.name}`)
    } catch (error) {
      const detail = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)
      throw new Error(`[topology:test] FAIL ${test.name}\n${detail}`)
    } finally {
      clearSspContext()
    }
  }
  return {
    passed: names.length,
    names,
    durationMs: performance.now() - startedAt,
  }
}
