import * as THREE from 'three'
import {
  compileTopologySidecarV1,
  parseTopologySidecarV1,
  type TopologyAssetProof,
  type TopologySidecarCompileContext,
  type TopologySidecarCompileResult,
  type TopologySidecarDiagnostic,
  type TopologySidecarDiagnosticCode,
} from '../../adapters/topology'
import { createTopologyTool } from '../../ssp/topology/topologyTool'

type TestBody = () => void | Promise<void>
type MutableJson = Record<string, any>

interface TestCase {
  name: string
  run: TestBody
}

export interface SidecarFixtureTexts {
  rotatedSingleRoot: string
  multiRootCrossLayer: string
}

export interface SidecarToGraphSuiteResult {
  passed: number
  names: readonly string[]
  durationMs: number
}

const ROTATED_SIDECAR_URI = 'https://assets.example.test/scenes/rotated/topology.v1.json'
const ROTATED_ASSET_URI = 'https://assets.example.test/scenes/rotated/rotated-single-root.glb'
const ROTATED_DIGEST = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const MULTI_SIDECAR_URI = 'https://assets.example.test/scenes/multi/topology.v1.json'
const LOWER_ASSET_URI = 'https://assets.example.test/scenes/multi/lower.glb'
const UPPER_ASSET_URI = 'https://assets.example.test/scenes/shared/upper.glb'

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
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`)
  }
}

function parseMutable(jsonText: string): MutableJson {
  return JSON.parse(jsonText) as MutableJson
}

function json(document: MutableJson): string {
  return JSON.stringify(document)
}

function expectFailure(
  result: TopologySidecarCompileResult,
  code: TopologySidecarDiagnosticCode,
  message: string,
  path?: string,
): TopologySidecarDiagnostic {
  assert(!result.ok, `${message}: expected compilation failure`)
  equal(result.diagnostics.length, 1, `${message}: failure should be deterministic`)
  const diagnostic = result.diagnostics[0]!
  equal(diagnostic.code, code, message)
  if (path !== undefined) equal(diagnostic.path, path, `${message}: diagnostic path`)
  assert(!('input' in result), `${message}: failure must not expose a partial graph input`)
  return diagnostic
}

function expectParseFailure(
  jsonText: string,
  code: TopologySidecarDiagnosticCode,
  message: string,
  path?: string,
  sidecarUri = ROTATED_SIDECAR_URI,
): TopologySidecarDiagnostic {
  const result = parseTopologySidecarV1(jsonText, sidecarUri)
  assert(!result.ok, `${message}: expected parse failure`)
  equal(result.diagnostics.length, 1, `${message}: failure should be deterministic`)
  const diagnostic = result.diagnostics[0]!
  equal(diagnostic.code, code, message)
  if (path !== undefined) equal(diagnostic.path, path, `${message}: diagnostic path`)
  assert(!('document' in result), `${message}: failure must not expose a partial document`)
  return diagnostic
}

function expectParseSuccess(jsonText: string, message: string): void {
  const result = parseTopologySidecarV1(jsonText, ROTATED_SIDECAR_URI)
  if (!result.ok) {
    throw new Error(`${message}: ${result.diagnostics[0]?.code ?? 'unknown failure'}`)
  }
}

function expectNotLimited(jsonText: string, message: string): void {
  const result = parseTopologySidecarV1(jsonText, ROTATED_SIDECAR_URI)
  if (!result.ok) {
    assert(
      result.diagnostics[0]!.code !== 'SIDECAR_LIMIT_EXCEEDED',
      `${message}: exact boundary must not be rejected as over-limit`,
    )
  }
}

function assertDiagnosticEnvelope(
  diagnostic: TopologySidecarDiagnostic,
  expected: Pick<TopologySidecarDiagnostic, 'phase' | 'assetId' | 'entityId'> & {
    details: unknown
  },
  message: string,
): void {
  equal(diagnostic.phase, expected.phase, `${message}: phase`)
  equal(diagnostic.assetId, expected.assetId, `${message}: assetId`)
  equal(diagnostic.entityId, expected.entityId, `${message}: entityId`)
  deepEqual(diagnostic.details, expected.details, `${message}: details`)
}

function nodePosition(
  result: Extract<TopologySidecarCompileResult, { ok: true }>,
  nodeId: string,
): { x: number; y: number; z: number } {
  const node = result.input.nodes.find((candidate) => candidate.id === nodeId)
  assert(node, `missing compiled node ${nodeId}`)
  return node.position
}

function rotatedSetup(): {
  scene: THREE.Scene
  root: THREE.Group
  context: TopologySidecarCompileContext
} {
  const scene = new THREE.Scene()
  const root = new THREE.Group()
  root.position.set(10, 2, -5)
  root.rotation.set(0, Math.PI / 2, 0)
  root.scale.set(2, 3, 4)
  scene.add(root)
  const proof: TopologyAssetProof = {
    canonicalUri: ROTATED_ASSET_URI,
    root,
    selectionGeneration: 'selection-rotated',
    digest: { algorithm: 'SHA-256', value: ROTATED_DIGEST },
    provenance: 'SAME_RESPONSE_BYTES',
  }
  return {
    scene,
    root,
    context: {
      sidecarUri: ROTATED_SIDECAR_URI,
      scene,
      selectionGeneration: 'selection-rotated',
      isSelectionCurrent: (generation) => generation === 'selection-rotated',
      loadedAssets: [{
        canonicalUri: ROTATED_ASSET_URI,
        root,
        selectionGeneration: 'selection-rotated',
      }],
      assetProofs: [proof],
    },
  }
}

function multiSetup(): {
  scene: THREE.Scene
  lowerRoot: THREE.Group
  upperRoot: THREE.Group
  context: TopologySidecarCompileContext
} {
  const scene = new THREE.Scene()
  const lowerRoot = new THREE.Group()
  lowerRoot.position.set(1, 0, 0)
  lowerRoot.scale.set(1, 2, 1)
  const upperRoot = new THREE.Group()
  upperRoot.position.set(4, 4, 0)
  upperRoot.rotation.set(0, Math.PI / 2, 0)
  upperRoot.scale.set(2, 2, 2)
  scene.add(lowerRoot, upperRoot)
  return {
    scene,
    lowerRoot,
    upperRoot,
    context: {
      sidecarUri: MULTI_SIDECAR_URI,
      scene,
      selectionGeneration: 42,
      isSelectionCurrent: (generation) => generation === 42,
      loadedAssets: [
        {
          canonicalUri: LOWER_ASSET_URI,
          root: lowerRoot,
          selectionGeneration: 42,
        },
        {
          canonicalUri: UPPER_ASSET_URI,
          root: upperRoot,
          selectionGeneration: 42,
        },
      ],
      assetProofs: [
        {
          canonicalUri: LOWER_ASSET_URI,
          root: lowerRoot,
          selectionGeneration: 42,
          revision: 'asset-lower-r42',
          provenance: 'IMMUTABLE_PACKAGE_REVISION',
        },
        {
          canonicalUri: UPPER_ASSET_URI,
          root: upperRoot,
          selectionGeneration: 42,
          revision: 'asset-upper-r42',
          provenance: 'IMMUTABLE_PACKAGE_REVISION',
        },
      ],
    },
  }
}

function success(
  result: TopologySidecarCompileResult,
  message: string,
): Extract<TopologySidecarCompileResult, { ok: true }> {
  if (!result.ok) {
    throw new Error(`${message}: ${result.diagnostics[0]?.code ?? 'unknown failure'}`)
  }
  return result
}

function makeTests(fixtures: SidecarFixtureTexts): readonly TestCase[] {
  return [
    {
      name: 'rotated single root compiles once to world space and explicit blockers reroute',
      run: () => {
        const { context } = rotatedSetup()
        const compiled = success(
          compileTopologySidecarV1(fixtures.rotatedSingleRoot, context),
          'rotated fixture should compile',
        )
        const start = nodePosition(compiled, 'node/start')
        const junction = nodePosition(compiled, 'node/junction')
        const detour = nodePosition(compiled, 'node/detour')
        const goal = nodePosition(compiled, 'node/goal')
        deepEqual(start, { x: 10, y: 2, z: -5 }, 'translation should be applied')
        closeTo(junction.x, 10, 'rotation/scale junction x')
        closeTo(junction.y, 2, 'rotation/scale junction y')
        closeTo(junction.z, -7, 'rotation/scale junction z')
        closeTo(detour.x, 14, 'non-uniform scale detour x')
        closeTo(detour.z, -7, 'non-uniform scale detour z')
        closeTo(goal.x, 10, 'goal x')
        closeTo(goal.z, -9, 'goal z')

        const entry = compiled.input.edges.find((edge) => edge.id === 'edge/entry')
        assert(entry?.path, 'entry edge should retain its explicit polyline')
        closeTo(entry.path.via[0]!.x, 12, 'via x should be transformed exactly once')
        closeTo(entry.path.via[0]!.y, 2, 'via y should be transformed exactly once')
        closeTo(entry.path.via[0]!.z, -6, 'via z should be transformed exactly once')
        const direct = compiled.input.edges.find((edge) => edge.id === 'edge/direct')
        deepEqual(
          direct?.initialState?.blockerIds,
          ['blocker/alpha', 'blocker/zeta'],
          'active blockers should be sorted and compiled from the top-level source',
        )
        const entryBlockers = entry.initialState?.blockerIds ?? []
        deepEqual(entryBlockers, [], 'inactive blockers should not enter routing state')
        assert(!('assetId' in compiled.input.nodes[0]!), 'assetId must not leak into TopologyGraphInput nodes')
        equal(compiled.bindingSnapshot.assets.length, 1, 'binding snapshot asset count')
        equal(compiled.bindingSnapshot.assets[0]!.canonicalUri, ROTATED_ASSET_URI, 'canonical URI snapshot')

        const tool = createTopologyTool()
        try {
          const graph = tool.createGraph(compiled.input)
          equal(graph.id, 'fixture/rotated-single-root', 'Topology core should accept the compiled graph')
          equal(graph.schemaVersion, 2, 'sidecar v1 must compile to the current Topology snapshot schema')
          const path = tool.findPath({
            graphId: graph.id,
            startNodeId: 'node/start',
            goalNodeId: 'node/goal',
          })
          if (!path.ok) throw new Error(`blocked graph should retain an explicit detour: ${path.message}`)
          deepEqual(
            path.route.nodeIds,
            ['node/start', 'node/junction', 'node/detour', 'node/goal'],
            'active blocker should force the explicit detour',
          )
          deepEqual(
            path.route.flattenedPoints[0],
            { x: 10, y: 2, z: -5 },
            'route geometry should consume compiled world-space points without a second transform',
          )
        } finally {
          tool.removeAllGraphs()
        }
      },
    },
    {
      name: 'multi-root fixture compiles cross-layer connector and mixed-root via geometry',
      run: () => {
        const { context } = multiSetup()
        const compiled = success(
          compileTopologySidecarV1(fixtures.multiRootCrossLayer, context),
          'multi-root fixture should compile',
        )
        deepEqual(nodePosition(compiled, 'node/lower-start'), { x: 1, y: 0, z: 0 }, 'lower root translation')
        deepEqual(nodePosition(compiled, 'node/lower-transfer'), { x: 3, y: 0, z: 0 }, 'lower root point')
        deepEqual(nodePosition(compiled, 'node/upper-transfer'), { x: 4, y: 4, z: 0 }, 'upper root origin')
        const upperGoal = nodePosition(compiled, 'node/upper-goal')
        closeTo(upperGoal.x, 8, 'upper root rotation/scale x')
        closeTo(upperGoal.y, 4, 'upper root rotation/scale y')
        closeTo(upperGoal.z, 0, 'upper root rotation/scale z')
        const connectorNodes = compiled.input.nodes
          .filter((node) => node.id.endsWith('transfer'))
          .map((node) => node.connectorId)
        deepEqual(
          connectorNodes,
          ['connector/between-layers', 'connector/between-layers'],
          'connector should be the single source of node connectorId',
        )
        const upperEdge = compiled.input.edges.find((edge) => edge.id === 'edge/upper-link')
        assert(upperEdge?.path, 'upper edge should preserve via geometry')
        closeTo(upperEdge.path.via[0]!.x, 6, 'upper-root via x')
        closeTo(upperEdge.path.via[0]!.y, 4, 'upper-root via y')
        closeTo(upperEdge.path.via[0]!.z, 0, 'upper-root via z')
        equal(compiled.bindingSnapshot.assets.length, 2, 'both roots must be strongly bound')

        const tool = createTopologyTool()
        try {
          const graph = tool.createGraph(compiled.input)
          const path = tool.findPath({
            graphId: graph.id,
            startNodeId: 'node/lower-start',
            goalNodeId: 'node/upper-goal',
          })
          if (!path.ok) throw new Error(`cross-layer graph should be routable: ${path.message}`)
          deepEqual(
            path.route.nodeIds,
            ['node/lower-start', 'node/lower-transfer', 'node/upper-transfer', 'node/upper-goal'],
            'path should traverse the explicit connector edge',
          )
        } finally {
          tool.removeAllGraphs()
        }
      },
    },
    {
      name: 'JSON, schema version, and closed fields fail before binding',
      run: () => {
        const malformed = expectParseFailure('{not-json', 'SIDECAR_JSON_INVALID', 'malformed JSON', '')
        assertDiagnosticEnvelope(
          malformed,
          { phase: 'PARSE', assetId: null, entityId: null, details: {} },
          'PARSE diagnostic envelope',
        )

        const unknownVersion = parseMutable(fixtures.rotatedSingleRoot)
        unknownVersion.schemaVersion = 2
        expectParseFailure(
          json(unknownVersion),
          'SIDECAR_SCHEMA_UNSUPPORTED',
          'unknown version',
          '/schemaVersion',
        )

        const topUnknown = parseMutable(fixtures.rotatedSingleRoot)
        topUnknown.frames = []
        expectParseFailure(json(topUnknown), 'SIDECAR_FIELD_INVALID', 'top-level unknown field', '/frames')

        const nestedUnknown = parseMutable(fixtures.rotatedSingleRoot)
        nestedUnknown.nodes[0].connectorId = 'forbidden-second-source'
        expectParseFailure(
          json(nestedUnknown),
          'SIDECAR_FIELD_INVALID',
          'node connectorId is forbidden',
          '/nodes/0/connectorId',
        )

        const blockerIds = parseMutable(fixtures.rotatedSingleRoot)
        blockerIds.edges[0].initialState = { blockerIds: ['forbidden'] }
        expectParseFailure(
          json(blockerIds),
          'SIDECAR_FIELD_INVALID',
          'edge blockerIds is forbidden',
          '/edges/0/initialState/blockerIds',
        )
      },
    },
    {
      name: 'duplicate IDs and broken references fail closed',
      run: () => {
        const duplicate = parseMutable(fixtures.rotatedSingleRoot)
        duplicate.nodes[1].id = duplicate.nodes[0].id
        expectParseFailure(json(duplicate), 'SIDECAR_DUPLICATE_ID', 'duplicate node ID', '/nodes/1/id')

        const brokenNode = parseMutable(fixtures.rotatedSingleRoot)
        brokenNode.edges[0].source = 'node/missing'
        const brokenNodeDiagnostic = expectParseFailure(
          json(brokenNode),
          'SIDECAR_REFERENCE_BROKEN',
          'broken edge-node reference',
          '/edges/0/source',
        )
        assertDiagnosticEnvelope(
          brokenNodeDiagnostic,
          {
            phase: 'VALIDATE',
            assetId: null,
            entityId: 'edge/entry',
            details: { referenceType: 'node' },
          },
          'VALIDATE diagnostic envelope',
        )

        const brokenAsset = parseMutable(fixtures.rotatedSingleRoot)
        brokenAsset.edges[0].path.via[0].assetId = 'asset/missing'
        expectParseFailure(
          json(brokenAsset),
          'SIDECAR_REFERENCE_BROKEN',
          'broken via-asset reference',
          '/edges/0/path/via/0/assetId',
        )
      },
    },
    {
      name: 'connector and blocker invariants reject invalid ownership and references',
      run: () => {
        const missingNode = parseMutable(fixtures.multiRootCrossLayer)
        missingNode.connectors[0].nodeIds[1] = 'node/missing'
        expectParseFailure(
          json(missingNode),
          'SIDECAR_CONNECTOR_INVALID',
          'connector missing endpoint',
          '/connectors/0/nodeIds/1',
        )

        const missingEdge = parseMutable(fixtures.multiRootCrossLayer)
        missingEdge.connectors[0].edgeIds[0] = 'edge/missing'
        expectParseFailure(
          json(missingEdge),
          'SIDECAR_CONNECTOR_INVALID',
          'connector missing edge',
          '/connectors/0/edgeIds/0',
        )

        const missingOwner = parseMutable(fixtures.multiRootCrossLayer)
        missingOwner.connectors = []
        expectParseFailure(
          json(missingOwner),
          'SIDECAR_CONNECTOR_INVALID',
          'cross-layer edge without connector owner',
          '/edges/1',
        )

        const sameLayer = parseMutable(fixtures.multiRootCrossLayer)
        sameLayer.nodes[2].layerId = 'layer/lower'
        expectParseFailure(
          json(sameLayer),
          'SIDECAR_CONNECTOR_INVALID',
          'connector nodes on one layer',
          '/connectors/0/nodeIds',
        )

        const crossLayerLink = parseMutable(fixtures.multiRootCrossLayer)
        crossLayerLink.edges[1].relation = 'LINK'
        expectParseFailure(
          json(crossLayerLink),
          'SIDECAR_CONNECTOR_INVALID',
          'cross-layer LINK is forbidden',
          '/connectors/0/edgeIds/0',
        )

        const sameLayerConnector = parseMutable(fixtures.rotatedSingleRoot)
        sameLayerConnector.edges[1].relation = 'CONNECTOR'
        expectParseFailure(
          json(sameLayerConnector),
          'SIDECAR_CONNECTOR_INVALID',
          'same-layer CONNECTOR is forbidden',
          '/edges/1',
        )

        const duplicateOwner = parseMutable(fixtures.multiRootCrossLayer)
        duplicateOwner.connectors.push({
          id: 'connector/duplicate-owner',
          nodeIds: [...duplicateOwner.connectors[0].nodeIds],
          edgeIds: [...duplicateOwner.connectors[0].edgeIds],
        })
        expectParseFailure(
          json(duplicateOwner),
          'SIDECAR_CONNECTOR_INVALID',
          'connector node and edge ownership must be unique',
          '/connectors/1/nodeIds/0',
        )

        const brokenBlocker = parseMutable(fixtures.rotatedSingleRoot)
        brokenBlocker.blockers[0].edgeIds = ['edge/missing']
        expectParseFailure(
          json(brokenBlocker),
          'SIDECAR_BLOCKER_INVALID',
          'blocker missing edge',
          '/blockers/0/edgeIds/0',
        )
      },
    },
    {
      name: 'all graph capacity gates and string bounds are enforced before binding',
      run: () => {
        const tooManyLayers = parseMutable(fixtures.rotatedSingleRoot)
        tooManyLayers.layers = Array.from({ length: 33 }, (_, index) => ({ id: `layer/${String(index)}` }))
        expectParseFailure(json(tooManyLayers), 'SIDECAR_LIMIT_EXCEEDED', 'layer limit', '/layers')

        const tooManyNodes = parseMutable(fixtures.rotatedSingleRoot)
        tooManyNodes.nodes = Array.from({ length: 2_001 }, (_, index) => ({
          id: `node/${String(index)}`,
          layerId: 'layer/base',
          assetId: 'asset/rotated-root',
          position: { x: index, y: 0, z: 0 },
        }))
        expectParseFailure(json(tooManyNodes), 'SIDECAR_LIMIT_EXCEEDED', 'node limit', '/nodes')

        const tooManyEdges = parseMutable(fixtures.rotatedSingleRoot)
        tooManyEdges.edges = Array.from({ length: 5_001 }, (_, index) => ({
          id: `edge/${String(index)}`,
          source: 'node/start',
          target: 'node/junction',
          relation: 'LINK',
          direction: 'FORWARD',
        }))
        expectParseFailure(json(tooManyEdges), 'SIDECAR_LIMIT_EXCEEDED', 'edge limit', '/edges')

        const tooManyVia = parseMutable(fixtures.rotatedSingleRoot)
        tooManyVia.edges[0].path.via = Array.from({ length: 65 }, (_, index) => ({
          assetId: 'asset/rotated-root',
          position: { x: index + 0.25, y: 0, z: 0.25 },
        }))
        expectParseFailure(
          json(tooManyVia),
          'SIDECAR_LIMIT_EXCEEDED',
          'per-edge via limit',
          '/edges/0/path/via',
        )

        const tooManySegments = parseMutable(fixtures.rotatedSingleRoot)
        const via = Array.from({ length: 64 }, (_, index) => ({
          assetId: 'asset/rotated-root',
          position: { x: index + 0.1, y: 0, z: 0.1 },
        }))
        tooManySegments.edges = Array.from({ length: 308 }, (_, index) => ({
          id: `edge/segment-limit/${String(index)}`,
          source: 'node/start',
          target: 'node/junction',
          relation: 'LINK',
          direction: 'FORWARD',
          path: { type: 'POLYLINE', via },
        }))
        expectParseFailure(
          json(tooManySegments),
          'SIDECAR_LIMIT_EXCEEDED',
          'total segment limit',
          '/edges',
        )

        const longId = parseMutable(fixtures.rotatedSingleRoot)
        longId.nodes[0].id = 'n'.repeat(161)
        expectParseFailure(json(longId), 'SIDECAR_LIMIT_EXCEEDED', 'ID length bound', '/nodes/0/id')
      },
    },
    {
      name: 'UTF-8 source and sidecar collection budgets enforce exact boundaries',
      run: () => {
        const sourceLimit = 8 * 1024 * 1024
        const fixtureBytes = new TextEncoder().encode(fixtures.rotatedSingleRoot).byteLength
        const exactSource = fixtures.rotatedSingleRoot + ' '.repeat(sourceLimit - fixtureBytes)
        expectParseSuccess(exactSource, '8 MiB UTF-8 source boundary')
        const overSource = `${exactSource}é`
        const overSetup = rotatedSetup()
        let lifecycleChecks = 0
        overSetup.context.isSelectionCurrent = () => {
          lifecycleChecks += 1
          return true
        }
        const sourceDiagnostic = expectFailure(
          compileTopologySidecarV1(overSource, overSetup.context),
          'SIDECAR_LIMIT_EXCEEDED',
          '8 MiB UTF-8 source overflow',
          '',
        )
        equal(sourceDiagnostic.phase, 'PARSE', 'source limit diagnostic phase')
        deepEqual(
          sourceDiagnostic.details,
          { limitBytes: sourceLimit, actualBytesAtLeast: sourceLimit + 2 },
          'source limit details must be deterministic',
        )
        equal(lifecycleChecks, 0, 'source limit must fail before lifecycle and binding')

        const exactAssets = parseMutable(fixtures.rotatedSingleRoot)
        exactAssets.assets = [
          exactAssets.assets[0],
          ...Array.from({ length: 127 }, (_, index) => ({
            assetId: `asset/budget-${String(index)}`,
            uri: `./budget-${String(index)}.glb`,
            revision: 'r1',
          })),
        ]
        expectParseSuccess(json(exactAssets), '128 assets boundary')
        const overAssets = parseMutable(json(exactAssets))
        overAssets.assets.push({ assetId: 'asset/over', uri: './over.glb', revision: 'r1' })
        expectParseFailure(json(overAssets), 'SIDECAR_LIMIT_EXCEEDED', '129 assets', '/assets')

        const exactConnectors = parseMutable(fixtures.multiRootCrossLayer)
        exactConnectors.connectors = Array.from({ length: 2_000 }, (_, index) => ({
          id: `connector/count-${String(index)}`,
          nodeIds: ['node/lower-transfer', 'node/upper-transfer'],
          edgeIds: ['edge/cross-layer'],
        }))
        expectNotLimited(json(exactConnectors), '2,000 connectors boundary')
        exactConnectors.connectors.push({
          id: 'connector/count-over',
          nodeIds: ['node/lower-transfer', 'node/upper-transfer'],
          edgeIds: ['edge/cross-layer'],
        })
        expectParseFailure(
          json(exactConnectors),
          'SIDECAR_LIMIT_EXCEEDED',
          '2,001 connectors',
          '/connectors',
        )

        const exactBlockers = parseMutable(fixtures.rotatedSingleRoot)
        exactBlockers.blockers = Array.from({ length: 5_000 }, (_, index) => ({
          id: `blocker/count-${String(index)}`,
          active: false,
          edgeIds: ['edge/direct'],
        }))
        expectParseSuccess(json(exactBlockers), '5,000 blockers boundary')
        exactBlockers.blockers.push({
          id: 'blocker/count-over',
          active: false,
          edgeIds: ['edge/direct'],
        })
        expectParseFailure(
          json(exactBlockers),
          'SIDECAR_LIMIT_EXCEEDED',
          '5,001 blockers',
          '/blockers',
        )
      },
    },
    {
      name: 'tag, URI, and free-text budgets enforce exact boundaries',
      run: () => {
        const exactTags = parseMutable(fixtures.rotatedSingleRoot)
        exactTags.tags = Array.from({ length: 64 }, (_, index) => `tag-${String(index)}`)
        expectParseSuccess(json(exactTags), '64 tags boundary')
        exactTags.tags.push('tag-over')
        expectParseFailure(json(exactTags), 'SIDECAR_LIMIT_EXCEEDED', '65 tags', '/tags')

        const exactUri = parseMutable(fixtures.rotatedSingleRoot)
        const uriAtLimit = `./${'a'.repeat(4_090)}.glb`
        equal(uriAtLimit.length, 4_096, 'asset URI boundary fixture length')
        exactUri.assets[0].uri = uriAtLimit
        expectParseSuccess(json(exactUri), '4,096 character asset URI boundary')
        exactUri.assets[0].uri = `${uriAtLimit}x`
        expectParseFailure(
          json(exactUri),
          'SIDECAR_LIMIT_EXCEEDED',
          '4,097 character asset URI',
          '/assets/0/uri',
        )

        const exactRevision = parseMutable(fixtures.rotatedSingleRoot)
        exactRevision.assets[0].revision = 'r'.repeat(160)
        expectParseSuccess(json(exactRevision), '160 character asset revision boundary')
        exactRevision.assets[0].revision = 'r'.repeat(161)
        expectParseFailure(
          json(exactRevision),
          'SIDECAR_LIMIT_EXCEEDED',
          '161 character asset revision',
          '/assets/0/revision',
        )

        const connectorLabel = parseMutable(fixtures.multiRootCrossLayer)
        connectorLabel.connectors[0].label = 'c'.repeat(160)
        expectParseSuccess(json(connectorLabel), '160 character connector label boundary')
        connectorLabel.connectors[0].label = 'c'.repeat(161)
        expectParseFailure(
          json(connectorLabel),
          'SIDECAR_LIMIT_EXCEEDED',
          '161 character connector label',
          '/connectors/0/label',
        )

        const blockerLabel = parseMutable(fixtures.rotatedSingleRoot)
        blockerLabel.blockers[0].label = 'b'.repeat(160)
        expectParseSuccess(json(blockerLabel), '160 character blocker label boundary')
        blockerLabel.blockers[0].label = 'b'.repeat(161)
        expectParseFailure(
          json(blockerLabel),
          'SIDECAR_LIMIT_EXCEEDED',
          '161 character blocker label',
          '/blockers/0/label',
        )
      },
    },
    {
      name: 'data depth, width, node, and string budgets fail closed without recursion overflow',
      run: () => {
        const makeNestedData = (depth: number): MutableJson => {
          let value: MutableJson = { leaf: true }
          for (let level = 1; level < depth; level += 1) value = { next: value }
          return value
        }

        const exactDepth = parseMutable(fixtures.rotatedSingleRoot)
        exactDepth.data = makeNestedData(16)
        expectParseSuccess(json(exactDepth), 'data depth 16 boundary')
        exactDepth.data = makeNestedData(17)
        expectParseFailure(
          json(exactDepth),
          'SIDECAR_LIMIT_EXCEEDED',
          'data depth 17',
        )

        const exactObjectWidth = parseMutable(fixtures.rotatedSingleRoot)
        exactObjectWidth.data = Object.fromEntries(
          Array.from({ length: 1_024 }, (_, index) => [`key-${String(index)}`, index]),
        )
        expectParseSuccess(json(exactObjectWidth), 'data object width 1,024 boundary')
        exactObjectWidth.data['key-over'] = true
        expectParseFailure(
          json(exactObjectWidth),
          'SIDECAR_LIMIT_EXCEEDED',
          'data object width 1,025',
          '/data',
        )

        const exactArrayWidth = parseMutable(fixtures.rotatedSingleRoot)
        exactArrayWidth.data = { values: Array.from({ length: 1_024 }, (_, index) => index) }
        expectParseSuccess(json(exactArrayWidth), 'data array width 1,024 boundary')
        exactArrayWidth.data.values.push(1_024)
        expectParseFailure(
          json(exactArrayWidth),
          'SIDECAR_LIMIT_EXCEEDED',
          'data array width 1,025',
          '/data/values',
        )

        const makeNodeBudgetData = (lastArrayLength: number): MutableJson => Object.fromEntries(
          Array.from({ length: 1_024 }, (_, index) => [
            `bucket-${String(index)}`,
            Array.from({ length: index === 1_023 ? lastArrayLength : 3 }, () => true),
          ]),
        )
        const exactNodes = parseMutable(fixtures.rotatedSingleRoot)
        exactNodes.data = makeNodeBudgetData(2)
        expectParseSuccess(json(exactNodes), 'data JSON-node count 4,096 boundary')
        exactNodes.data = makeNodeBudgetData(3)
        expectParseFailure(
          json(exactNodes),
          'SIDECAR_LIMIT_EXCEEDED',
          'data JSON-node count 4,097',
          '/data/bucket-1023',
        )

        const exactString = parseMutable(fixtures.rotatedSingleRoot)
        exactString.data = { text: 'd'.repeat(4_096) }
        expectParseSuccess(json(exactString), 'data string length 4,096 boundary')
        exactString.data.text = 'd'.repeat(4_097)
        expectParseFailure(
          json(exactString),
          'SIDECAR_LIMIT_EXCEEDED',
          'data string length 4,097',
          '/data/text',
        )
      },
    },
    {
      name: 'connector, blocker, and active-blocker reference budgets enforce exact boundaries',
      run: () => {
        const nodeReferences = Array.from({ length: 2_000 }, (_, index) => `node/ref-${String(index)}`)
        const edgeReferences = Array.from({ length: 5_000 }, (_, index) => `edge/ref-${String(index)}`)
        const exactConnectorReferences = parseMutable(fixtures.multiRootCrossLayer)
        exactConnectorReferences.connectors = [
          { id: 'connector/ref-a', nodeIds: nodeReferences, edgeIds: edgeReferences },
          { id: 'connector/ref-b', nodeIds: nodeReferences, edgeIds: edgeReferences },
          {
            id: 'connector/ref-c',
            nodeIds: nodeReferences,
            edgeIds: edgeReferences.slice(0, 4_000),
          },
        ]
        expectNotLimited(json(exactConnectorReferences), '20,000 connector references boundary')
        exactConnectorReferences.connectors[2].edgeIds.push(edgeReferences[4_000])
        expectParseFailure(
          json(exactConnectorReferences),
          'SIDECAR_LIMIT_EXCEEDED',
          '20,001 connector references',
          '/connectors',
        )

        const exactBlockerReferences = parseMutable(fixtures.rotatedSingleRoot)
        exactBlockerReferences.blockers = Array.from({ length: 4 }, (_, index) => ({
          id: `blocker/ref-${String(index)}`,
          active: false,
          edgeIds: edgeReferences,
        }))
        expectNotLimited(json(exactBlockerReferences), '20,000 blocker references boundary')
        exactBlockerReferences.blockers.push({
          id: 'blocker/ref-over',
          active: false,
          edgeIds: [edgeReferences[0]],
        })
        expectParseFailure(
          json(exactBlockerReferences),
          'SIDECAR_LIMIT_EXCEEDED',
          '20,001 blocker references',
          '/blockers',
        )

        const exactActiveBlockers = parseMutable(fixtures.rotatedSingleRoot)
        exactActiveBlockers.blockers = Array.from({ length: 64 }, (_, index) => ({
          id: `blocker/active-${String(index)}`,
          active: true,
          edgeIds: ['edge/direct'],
        }))
        expectParseSuccess(json(exactActiveBlockers), '64 active blockers on one edge boundary')
        exactActiveBlockers.blockers.push({
          id: 'blocker/active-over',
          active: true,
          edgeIds: ['edge/direct'],
        })
        expectParseFailure(
          json(exactActiveBlockers),
          'SIDECAR_LIMIT_EXCEEDED',
          '65 active blockers on one edge',
          '/blockers/64/edgeIds/0',
        )
      },
    },
    {
      name: 'self-loops, empty strings, duplicate tags, and cross-origin asset URIs are rejected',
      run: () => {
        const selfLoop = parseMutable(fixtures.rotatedSingleRoot)
        selfLoop.edges[1].target = selfLoop.edges[1].source
        expectParseFailure(
          json(selfLoop),
          'SIDECAR_FIELD_INVALID',
          'self-loop',
          '/edges/1/target',
        )

        const emptyLabel = parseMutable(fixtures.rotatedSingleRoot)
        emptyLabel.nodes[0].label = '   '
        expectParseFailure(
          json(emptyLabel),
          'SIDECAR_FIELD_INVALID',
          'empty SSP string',
          '/nodes/0/label',
        )

        const duplicateTags = parseMutable(fixtures.rotatedSingleRoot)
        duplicateTags.nodes[0].tags = ['generic', ' generic ']
        expectParseFailure(
          json(duplicateTags),
          'SIDECAR_FIELD_INVALID',
          'duplicate normalized tags',
          '/nodes/0/tags/1',
        )

        const absoluteUri = parseMutable(fixtures.rotatedSingleRoot)
        absoluteUri.assets[0].uri = 'https://other.example.test/asset.glb'
        expectParseFailure(
          json(absoluteUri),
          'SIDECAR_FIELD_INVALID',
          'absolute asset URI',
          '/assets/0/uri',
        )

        const protocolRelativeUri = parseMutable(fixtures.rotatedSingleRoot)
        protocolRelativeUri.assets[0].uri = '//other.example.test/asset.glb'
        expectParseFailure(
          json(protocolRelativeUri),
          'SIDECAR_FIELD_INVALID',
          'protocol-relative asset URI',
          '/assets/0/uri',
        )
      },
    },
    {
      name: 'active blockers and explicitly disabled edges produce structured no-path results',
      run: () => {
        const assertNoPath = (document: MutableJson, message: string): void => {
          const compiled = success(
            compileTopologySidecarV1(json(document), rotatedSetup().context),
            `${message} should compile`,
          )
          const tool = createTopologyTool()
          try {
            const graph = tool.createGraph(compiled.input)
            const result = tool.findPath({
              graphId: graph.id,
              startNodeId: 'node/start',
              goalNodeId: 'node/goal',
            })
            assert(!result.ok, `${message}: expected structured no-path result`)
            equal(result.code, 'NO_PATH', message)
          } finally {
            tool.removeAllGraphs()
          }
        }

        const fullyBlocked = parseMutable(fixtures.rotatedSingleRoot)
        fullyBlocked.blockers.push({
          id: 'blocker/detour',
          active: true,
          edgeIds: ['edge/detour-out'],
        })
        assertNoPath(fullyBlocked, 'active blocker')

        const explicitlyDisabled = parseMutable(fixtures.rotatedSingleRoot)
        explicitlyDisabled.edges[2].initialState = { enabled: false }
        assertNoPath(explicitlyDisabled, 'explicitly disabled edge')
      },
    },
    {
      name: 'URI and AssetProof binding mismatches are rejected without partial input',
      run: () => {
        const notLoaded = rotatedSetup()
        notLoaded.context.loadedAssets = []
        expectFailure(
          compileTopologySidecarV1(fixtures.rotatedSingleRoot, notLoaded.context),
          'SIDECAR_ASSET_NOT_LOADED',
          'single asset not loaded',
          '/assets/0/uri',
        )

        const missing = rotatedSetup()
        missing.context.assetProofs = []
        expectFailure(
          compileTopologySidecarV1(fixtures.rotatedSingleRoot, missing.context),
          'SIDECAR_ASSET_BINDING_UNVERIFIABLE',
          'missing proof',
          '/assets/0/uri',
        )

        const mismatch = rotatedSetup()
        mismatch.context.assetProofs = [{
          ...mismatch.context.assetProofs[0]!,
          digest: { algorithm: 'SHA-256', value: 'b'.repeat(64) },
        }]
        const mismatchDiagnostic = expectFailure(
          compileTopologySidecarV1(fixtures.rotatedSingleRoot, mismatch.context),
          'SIDECAR_ASSET_BINDING_MISMATCH',
          'digest mismatch',
          '/assets/0/digest/value',
        )
        assertDiagnosticEnvelope(
          mismatchDiagnostic,
          {
            phase: 'BIND',
            assetId: 'asset/rotated-root',
            entityId: null,
            details: { algorithm: 'SHA-256' },
          },
          'BIND diagnostic envelope',
        )

        const untrusted = rotatedSetup()
        untrusted.context.assetProofs = [{
          ...untrusted.context.assetProofs[0]!,
          provenance: 'REFETCHED_MUTABLE_URI' as TopologyAssetProof['provenance'],
        }]
        expectFailure(
          compileTopologySidecarV1(fixtures.rotatedSingleRoot, untrusted.context),
          'SIDECAR_ASSET_BINDING_UNVERIFIABLE',
          'untrusted provenance',
          '/assets/0',
        )

        const uriMismatch = rotatedSetup()
        uriMismatch.context.assetProofs = [{
          ...uriMismatch.context.assetProofs[0]!,
          canonicalUri: 'https://assets.example.test/scenes/rotated/other.glb',
        }]
        expectFailure(
          compileTopologySidecarV1(fixtures.rotatedSingleRoot, uriMismatch.context),
          'SIDECAR_ASSET_BINDING_MISMATCH',
          'canonical URI mismatch',
          '/assets/0/uri',
        )

        const rootMismatch = rotatedSetup()
        const proofRoot = new THREE.Group()
        rootMismatch.scene.add(proofRoot)
        rootMismatch.context.assetProofs = [{
          ...rootMismatch.context.assetProofs[0]!,
          root: proofRoot,
        }]
        expectFailure(
          compileTopologySidecarV1(fixtures.rotatedSingleRoot, rootMismatch.context),
          'SIDECAR_ASSET_BINDING_MISMATCH',
          'AssetProof root mismatch',
          '/assets/0',
        )

        const detached = rotatedSetup()
        detached.root.removeFromParent()
        expectFailure(
          compileTopologySidecarV1(fixtures.rotatedSingleRoot, detached.context),
          'SIDECAR_ASSET_NOT_LOADED',
          'detached root',
          '/assets/0',
        )

        const redacted = rotatedSetup()
        redacted.context.sidecarUri = `${ROTATED_SIDECAR_URI}?token=must-not-leak#fragment`
        redacted.context.assetProofs = []
        const redactedResult = compileTopologySidecarV1(fixtures.rotatedSingleRoot, redacted.context)
        expectFailure(
          redactedResult,
          'SIDECAR_ASSET_BINDING_UNVERIFIABLE',
          'signed sidecar URI failure',
          '/assets/0/uri',
        )
        assert(!redactedResult.ok, 'redacted URI case must fail')
        equal(
          redactedResult.diagnostics[0]!.sidecarUri,
          ROTATED_SIDECAR_URI,
          'diagnostic URI must omit query and fragment',
        )
      },
    },
    {
      name: 'diagnostics and successful binding snapshots redact sensitive URIs',
      run: () => {
        for (const unsafeUri of [
          'file:///Users/example/private/topology.v1.json',
          'data:application/json,private-payload',
          'not a valid URI with private text',
        ]) {
          const diagnostic = expectParseFailure(
            '{not-json',
            'SIDECAR_JSON_INVALID',
            'non-HTTP sidecar diagnostic URI',
            '',
            unsafeUri,
          )
          equal(
            diagnostic.sidecarUri,
            '[non-http-sidecar-uri]',
            'non-HTTP and invalid sidecar URIs must use one safe placeholder',
          )
        }

        const signedDocument = parseMutable(fixtures.rotatedSingleRoot)
        const signedAssetUri = `${ROTATED_ASSET_URI}?signature=must-not-leak`
        signedDocument.assets[0].uri = './rotated-single-root.glb?signature=must-not-leak'
        const signed = rotatedSetup()
        signed.context.loadedAssets = [{
          ...signed.context.loadedAssets[0]!,
          canonicalUri: signedAssetUri,
        }]
        signed.context.assetProofs = [{
          ...signed.context.assetProofs[0]!,
          canonicalUri: signedAssetUri,
        }]
        const compiled = success(
          compileTopologySidecarV1(json(signedDocument), signed.context),
          'signed asset should bind using its full canonical URI',
        )
        equal(
          compiled.bindingSnapshot.assets[0]!.canonicalUri,
          ROTATED_ASSET_URI,
          'binding snapshot URI must omit query and fragment',
        )
        assert(
          !JSON.stringify(compiled.bindingSnapshot).includes('must-not-leak'),
          'binding snapshot must not retain signed URL secrets',
        )
      },
    },
    {
      name: 'multi-root partial scene and duplicate loaded instances fail closed',
      run: () => {
        const allMissing = multiSetup()
        allMissing.context.loadedAssets = []
        expectFailure(
          compileTopologySidecarV1(fixtures.multiRootCrossLayer, allMissing.context),
          'SIDECAR_ASSET_NOT_LOADED',
          'all multi-root assets absent',
          '/assets/0/uri',
        )

        const partial = multiSetup()
        partial.context.loadedAssets = [partial.context.loadedAssets[0]!]
        expectFailure(
          compileTopologySidecarV1(fixtures.multiRootCrossLayer, partial.context),
          'SIDECAR_PARTIAL_SCENE',
          'partial multi-root scene',
          '/assets/1/uri',
        )

        const inversePartial = multiSetup()
        inversePartial.context.loadedAssets = [inversePartial.context.loadedAssets[1]!]
        expectFailure(
          compileTopologySidecarV1(fixtures.multiRootCrossLayer, inversePartial.context),
          'SIDECAR_PARTIAL_SCENE',
          'partial multi-root scene with the first asset absent',
          '/assets/0/uri',
        )

        const duplicate = rotatedSetup()
        const duplicateRoot = new THREE.Group()
        duplicate.scene.add(duplicateRoot)
        duplicate.context.loadedAssets = [
          duplicate.context.loadedAssets[0]!,
          { ...duplicate.context.loadedAssets[0]!, root: duplicateRoot },
        ]
        expectFailure(
          compileTopologySidecarV1(fixtures.rotatedSingleRoot, duplicate.context),
          'SIDECAR_ASSET_NOT_LOADED',
          'duplicate loaded roots',
          '/assets/0/uri',
        )
      },
    },
    {
      name: 'generation staleness is checked before and after world-space compilation',
      run: () => {
        const early = rotatedSetup()
        early.context.isSelectionCurrent = () => false
        const earlyDiagnostic = expectFailure(
          compileTopologySidecarV1(fixtures.rotatedSingleRoot, early.context),
          'SIDECAR_REQUEST_STALE',
          'early stale request',
          '',
        )
        assertDiagnosticEnvelope(
          earlyDiagnostic,
          { phase: 'LIFECYCLE', assetId: null, entityId: null, details: {} },
          'LIFECYCLE diagnostic envelope',
        )

        const proofGeneration = rotatedSetup()
        proofGeneration.context.assetProofs = [{
          ...proofGeneration.context.assetProofs[0]!,
          selectionGeneration: 'selection-before',
        }]
        expectFailure(
          compileTopologySidecarV1(fixtures.rotatedSingleRoot, proofGeneration.context),
          'SIDECAR_ASSET_BINDING_MISMATCH',
          'AssetProof generation mismatch',
          '/assets/0',
        )

        const loadedGeneration = rotatedSetup()
        loadedGeneration.context.loadedAssets = [{
          ...loadedGeneration.context.loadedAssets[0]!,
          selectionGeneration: 'selection-before',
        }]
        expectFailure(
          compileTopologySidecarV1(fixtures.rotatedSingleRoot, loadedGeneration.context),
          'SIDECAR_ASSET_BINDING_MISMATCH',
          'loaded asset generation mismatch',
          '/assets/0',
        )

        const late = rotatedSetup()
        let checks = 0
        late.context.isSelectionCurrent = () => {
          checks += 1
          return checks < 3
        }
        expectFailure(
          compileTopologySidecarV1(fixtures.rotatedSingleRoot, late.context),
          'SIDECAR_REQUEST_STALE',
          'late stale request',
          '',
        )
        equal(checks, 3, 'generation should be rechecked at the final gate')

        const moved = rotatedSetup()
        let moveChecks = 0
        moved.context.isSelectionCurrent = () => {
          moveChecks += 1
          if (moveChecks === 3) moved.root.position.x += 1
          return true
        }
        expectFailure(
          compileTopologySidecarV1(fixtures.rotatedSingleRoot, moved.context),
          'SIDECAR_REQUEST_STALE',
          'world transform changed during compilation',
          '/assets/0',
        )
      },
    },
    {
      name: 'invalid coordinates, world matrices, and near-zero segments fail closed',
      run: () => {
        const overflowJson = fixtures.rotatedSingleRoot.replace(
          '"position": { "x": 0, "y": 0, "z": 0 }',
          '"position": { "x": 1e400, "y": 0, "z": 0 }',
        )
        expectParseFailure(
          overflowJson,
          'SIDECAR_COORDINATE_INVALID',
          'non-finite parsed coordinate',
          '/nodes/0/position/x',
        )

        const invalidMatrix = rotatedSetup()
        invalidMatrix.root.matrixAutoUpdate = false
        invalidMatrix.root.matrix.makeScale(0, 1, 1)
        expectFailure(
          compileTopologySidecarV1(fixtures.rotatedSingleRoot, invalidMatrix.context),
          'SIDECAR_COORDINATE_INVALID',
          'non-invertible matrix',
          '/assets/0',
        )

        const zeroSegment = parseMutable(fixtures.rotatedSingleRoot)
        zeroSegment.edges[0].path.via[0].position = { x: 0, y: 0, z: 0 }
        const zeroSegmentDiagnostic = expectFailure(
          compileTopologySidecarV1(json(zeroSegment), rotatedSetup().context),
          'SIDECAR_COORDINATE_INVALID',
          'coincident world points',
          '/edges/0/path/via/0',
        )
        assertDiagnosticEnvelope(
          zeroSegmentDiagnostic,
          { phase: 'TRANSFORM', assetId: null, entityId: 'edge/entry', details: {} },
          'TRANSFORM diagnostic envelope',
        )

        const negativeWeight = parseMutable(fixtures.rotatedSingleRoot)
        negativeWeight.edges[0].initialState = { weightOverride: -1 }
        expectParseFailure(
          json(negativeWeight),
          'SIDECAR_FIELD_INVALID',
          'negative routing override',
          '/edges/0/initialState/weightOverride',
        )
      },
    },
    {
      name: 'digest plus revision requires both values from immutable-package provenance',
      run: () => {
        const document = parseMutable(fixtures.rotatedSingleRoot)
        document.assets[0].revision = 'asset-combined-r1'
        const setup = rotatedSetup()
        setup.context.assetProofs = [{
          ...setup.context.assetProofs[0]!,
          revision: 'asset-combined-r1',
          provenance: 'IMMUTABLE_PACKAGE_REVISION',
        }]
        success(compileTopologySidecarV1(json(document), setup.context), 'both proof values should match')

        setup.context.assetProofs = [{
          ...setup.context.assetProofs[0]!,
          revision: 'asset-combined-other',
        }]
        expectFailure(
          compileTopologySidecarV1(json(document), setup.context),
          'SIDECAR_ASSET_BINDING_MISMATCH',
          'revision mismatch when both values are declared',
          '/assets/0/revision',
        )
      },
    },
  ]
}

export async function runSidecarToGraphSuite(
  fixtures: SidecarFixtureTexts,
): Promise<SidecarToGraphSuiteResult> {
  assert(
    fixtures.rotatedSingleRoot.trimStart().startsWith('{') && fixtures.multiRootCrossLayer.trimStart().startsWith('{'),
    'runner must provide fixture JSON as source text',
  )
  const tests = makeTests(fixtures)
  const startedAt = performance.now()
  const names: string[] = []
  for (const test of tests) {
    try {
      await test.run()
      names.push(test.name)
      console.log(`[topology-sidecar:test] PASS ${test.name}`)
    } catch (error) {
      const detail = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)
      throw new Error(`[topology-sidecar:test] FAIL ${test.name}\n${detail}`)
    }
  }
  return {
    passed: names.length,
    names,
    durationMs: performance.now() - startedAt,
  }
}
