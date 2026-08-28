import { planIntent } from '../../ai/planner/IntentPlanner'
import type { Intent } from '../../ai/types/Intent'
import { templateCatalog, resolveAiTemplateId } from '../../templates/catalog'
import {
  createTemplateRuntime,
  templateRuntime,
  type TemplateRuntimeDependencies,
} from '../../templates/runtime'
import { executeLegacyTemplate } from '../../templates/legacyRuntime'
import { templateRegistry } from '../../templates/registry'
import {
  currentTopologyUnavailableResult,
  installTopologyCapabilitySessionSource,
  isTemplateCapabilityAvailable,
  isTopologyDeclaredAbsentSession,
  templateRequiresTopology,
  readTopologyCapabilitySession,
  TOPOLOGY_UNAVAILABLE_RESULT,
  type TopologyCapabilitySessionSnapshot,
} from '../../templates/topologyCapabilityGate'
import {
  createTopologyQuickActionFacade,
  topologyQuickActionFacade,
} from '../../templates/topologyQuickAction'

type TestBody = () => void | Promise<void>

interface TestCase {
  readonly name: string
  readonly run: TestBody
}

export interface TopologyCapabilityGateSuiteResult {
  readonly passed: number
  readonly names: readonly string[]
  readonly durationMs: number
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

function expectThrows(run: () => unknown, includes: string, message: string): void {
  try {
    run()
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    assert(detail.includes(includes), `${message}: expected "${includes}", got "${detail}"`)
    return
  }
  throw new Error(`${message}: expected an exception`)
}

const ABSENT_CAPABILITY = Object.freeze({
  capability: 'topology',
  status: 'UNAVAILABLE',
  code: 'TOPOLOGY_UNAVAILABLE',
  reasonCode: 'PACKAGE_DECLARED_ABSENT',
  packageSchemaVersion: 2,
})

function session(
  status: TopologyCapabilitySessionSnapshot['status'],
  packageSession: unknown,
): TopologyCapabilitySessionSnapshot {
  return Object.freeze({ status, packageSession })
}

const V2_ABSENT_SESSION = session('scene-ready', Object.freeze({
  schemaVersion: 2,
  profile: 'TOPOLOGY_ABSENT_TRANSITION',
  topologyCapability: ABSENT_CAPABILITY,
}))

const V1_READY_SESSION = session('ready', Object.freeze({
  manifestUri: 'https://space.test/space-model-package.v1.json',
  packageId: 'package-v1',
  revision: 'a'.repeat(64),
  assets: Object.freeze([]),
}))

function runtimeHarness(readSceneSession: () => TopologyCapabilitySessionSnapshot): {
  readonly runtime: ReturnType<typeof createTemplateRuntime>
  readonly legacyCalls: string[]
  readonly v3Calls: string[]
} {
  const legacyCalls: string[] = []
  const v3Calls: string[] = []
  const dependencies: TemplateRuntimeDependencies = {
    readSceneSession,
    executeLegacy: async (templateId) => {
      legacyCalls.push(templateId)
      return { executed: templateId }
    },
    executeV3: async (templateId) => {
      v3Calls.push(templateId)
      return { executed: templateId }
    },
  }
  return {
    runtime: createTemplateRuntime(dependencies),
    legacyCalls,
    v3Calls,
  }
}

function routeFixture(): Record<string, unknown> {
  const points = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }]
  return {
    graphId: 'graph-v1',
    graphRoutingRevision: 0,
    startNodeId: 'start',
    goalNodeId: 'goal',
    selectedRequirementNodeIds: [],
    nodeIds: ['start', 'goal'],
    layerIds: ['L1'],
    steps: [{
      edgeId: 'edge-1',
      fromNodeId: 'start',
      toNodeId: 'goal',
      fromLayerId: 'L1',
      toLayerId: 'L1',
      relation: 'LINK',
      traversalDirection: 'FORWARD',
      points,
      length: 1,
      weight: 1,
    }],
    flattenedPoints: points,
    totalLength: 1,
    totalWeight: 1,
  }
}

function findSuccess(): Record<string, unknown> {
  return {
    ok: true,
    route: routeFixture(),
    stats: {
      algorithm: 'CONSTRAINED_DIJKSTRA',
      visitedStateCount: 2,
      durationMs: 0.1,
    },
  }
}

function renderSuccess(): Record<string, unknown> {
  return {
    rendered: true,
    id: 'route-owned',
    status: 'ACTIVE',
    graphId: 'graph-v1',
    graphRoutingRevision: 0,
    nodeIds: ['start', 'goal'],
    layerIds: ['L1'],
    edgeIds: ['edge-1'],
    totalLength: 1,
    totalWeight: 1,
  }
}

const tests: readonly TestCase[] = [
  {
    name: 'only the validated scene-ready v2 transition session declares topology absent',
    run: () => {
      equal(isTopologyDeclaredAbsentSession(V2_ABSENT_SESSION), true, 'legal v2 session')
      deepEqual(currentTopologyUnavailableResult(V2_ABSENT_SESSION), {
        ok: false,
        code: 'TOPOLOGY_UNAVAILABLE',
        reasonCode: 'PACKAGE_DECLARED_ABSENT',
      }, 'stable unavailable envelope')

      const nonAbsentSessions = [
        V1_READY_SESSION,
        session('unavailable', null),
        session('error', null),
        session('loading', null),
        session('scene-ready', { ...V2_ABSENT_SESSION.packageSession as object, profile: 'UNKNOWN' }),
        session('error', V2_ABSENT_SESSION.packageSession),
        session('scene-ready', {
          ...V2_ABSENT_SESSION.packageSession as object,
          topologyCapability: { ...ABSENT_CAPABILITY, reasonCode: 'PACKAGE_LOAD_FAILED' },
        }),
      ]
      for (const candidate of nonAbsentSessions) {
        equal(isTopologyDeclaredAbsentSession(candidate), false, `non-absent ${candidate.status}`)
        equal(currentTopologyUnavailableResult(candidate), null, `no unavailable ${candidate.status}`)
      }
    },
  },
  {
    name: 'Registry bindings classify all and only topology templates',
    run: () => {
      const topologyDefinitions = templateRegistry.all().filter((definition) => (
        definition.method?.startsWith('ssp.topologyTool.') === true
      ))
      equal(topologyDefinitions.length, 23, 'topology template count')
      for (const definition of topologyDefinitions) {
        equal(templateRequiresTopology(definition.id), true, `${definition.id} classification`)
      }
      equal(templateRequiresTopology('query-scene'), false, 'query-scene classification')
      equal(templateRequiresTopology('resetVisibility'), false, 'v3 visibility classification')
      equal(templateRequiresTopology('missing-template'), false, 'unknown classification')
    },
  },
  {
    name: 'v2 blocks every topology template before legacy or v3 execution',
    run: async () => {
      const harness = runtimeHarness(() => V2_ABSENT_SESSION)
      const topologyIds = templateRegistry.all()
        .filter((definition) => templateRequiresTopology(definition.id))
        .map((definition) => definition.id)
      for (const templateId of topologyIds) {
        const result = await harness.runtime.execute(templateId, {}, {
          aiOnly: false,
          validateParams: false,
        })
        deepEqual(result, TOPOLOGY_UNAVAILABLE_RESULT, `${templateId} unavailable`)
      }
      equal(harness.legacyCalls.length, 0, 'legacy body calls')
      equal(harness.v3Calls.length, 0, 'v3 body calls')
    },
  },
  {
    name: 'application runtime direct legacy entry and default host facade share the same session gate',
    run: async () => {
      const previousSession = readTopologyCapabilitySession()
      installTopologyCapabilitySessionSource(() => V2_ABSENT_SESSION)
      try {
        deepEqual(
          await templateRuntime.execute('findPath', {}, { aiOnly: false, validateParams: false }),
          TOPOLOGY_UNAVAILABLE_RESULT,
          'application dispatcher result',
        )
        deepEqual(
          await executeLegacyTemplate('renderRoute', {}, { aiOnly: false, validateParams: false }),
          TOPOLOGY_UNAVAILABLE_RESULT,
          'direct legacy result',
        )
        const hostResult = await topologyQuickActionFacade.findPath({
          graphId: 'graph-v1',
          startNodeId: 'start',
          goalNodeId: 'goal',
        })
        assert(hostResult.kind === 'capability-unavailable', 'default host facade unavailable')
        equal(hostResult.reasonCode, 'PACKAGE_DECLARED_ABSENT', 'default host facade reason')
      } finally {
        installTopologyCapabilitySessionSource(() => previousSession)
      }
    },
  },
  {
    name: 'v2 leaves non-topology legacy and v3 templates available',
    run: async () => {
      const harness = runtimeHarness(() => V2_ABSENT_SESSION)
      deepEqual(
        await harness.runtime.execute('query-scene', {}, { aiOnly: false }),
        { executed: 'query-scene' },
        'legacy non-topology result',
      )
      deepEqual(
        await harness.runtime.execute('resetVisibility', {}, { aiOnly: true }),
        { executed: 'resetVisibility' },
        'v3 non-topology result',
      )
      deepEqual(harness.legacyCalls, ['query-scene'], 'legacy non-topology calls')
      deepEqual(harness.v3Calls, ['resetVisibility'], 'v3 non-topology calls')
    },
  },
  {
    name: 'v1 and legacy error states preserve existing topology dispatch',
    run: async () => {
      for (const candidate of [
        V1_READY_SESSION,
        session('ready', null),
        session('unavailable', null),
        session('error', null),
      ]) {
        const harness = runtimeHarness(() => candidate)
        deepEqual(
          await harness.runtime.execute('findPath', {}, { aiOnly: false }),
          { executed: 'findPath' },
          `${candidate.status} topology result`,
        )
        deepEqual(harness.legacyCalls, ['findPath'], `${candidate.status} legacy call`)
      }
    },
  },
  {
    name: 'AI projection hides topology and keeps non-topology capabilities under v2',
    run: () => {
      equal(isTemplateCapabilityAvailable('findPath', V2_ABSENT_SESSION), false, 'findPath availability')
      equal(isTemplateCapabilityAvailable('query-scene', V2_ABSENT_SESSION), true, 'query availability')
      equal(resolveAiTemplateId('findPath', V2_ABSENT_SESSION), null, 'topology AI id')
      equal(resolveAiTemplateId('query-scene', V2_ABSENT_SESSION), 'query-scene', 'query AI id')
      const prompt = templateCatalog.toAiPromptSection(V2_ABSENT_SESSION)
      assert(prompt.includes('query-scene'), 'prompt keeps non-topology query')
      for (const definition of templateRegistry.all().filter((item) => templateRequiresTopology(item.id))) {
        assert(!prompt.includes(definition.id), `prompt hides ${definition.id}`)
      }
      expectThrows(
        () => planIntent({
          action: 'template',
          templateId: 'findPath',
          params: {},
        } as Intent),
        'unknown or non-AI template',
        'planner topology revalidation',
      )
    },
  },
  {
    name: 'Quick Action host facade projects v2 unavailability without rendering',
    run: async () => {
      const calls: string[] = []
      const facade = createTopologyQuickActionFacade({
        async execute(templateId) {
          calls.push(templateId)
          return TOPOLOGY_UNAVAILABLE_RESULT
        },
      })
      const result = await facade.findPath({
        graphId: 'graph-v1',
        startNodeId: 'start',
        goalNodeId: 'goal',
      })
      assert(result.kind === 'capability-unavailable', 'Quick Action unavailable kind')
      equal(result.code, 'TOPOLOGY_UNAVAILABLE', 'Quick Action unavailable code')
      equal(result.reasonCode, 'PACKAGE_DECLARED_ABSENT', 'Quick Action unavailable reason')
      deepEqual(calls, ['findPath'], 'Quick Action must not render')
    },
  },
  {
    name: 'render and owned remove preserve the stable gate result across a session switch',
    run: async () => {
      let mode: 'find' | 'render-unavailable' | 'render-success' | 'remove-unavailable' | 'remove-success' = 'find'
      const facade = createTopologyQuickActionFacade({
        async execute(templateId, params = {}) {
          if (templateId === 'findPath' && mode === 'find') return findSuccess()
          if (templateId === 'renderRoute' && mode === 'render-unavailable') {
            return TOPOLOGY_UNAVAILABLE_RESULT
          }
          if (templateId === 'renderRoute' && mode === 'render-success') return renderSuccess()
          if (templateId === 'removeRoute' && mode === 'remove-unavailable') {
            return TOPOLOGY_UNAVAILABLE_RESULT
          }
          if (templateId === 'removeRoute' && mode === 'remove-success') {
            return { id: params.routeId, removed: true }
          }
          throw new Error(`unexpected ${templateId} in ${mode}`)
        },
      })

      const firstPath = await facade.findPath({
        graphId: 'graph-v1', startNodeId: 'start', goalNodeId: 'goal',
      })
      assert(firstPath.kind === 'path', 'first path receipt')
      mode = 'render-unavailable'
      const unavailableRender = await facade.renderRoute(firstPath)
      equal(unavailableRender.kind, 'capability-unavailable', 'render unavailable kind')

      mode = 'find'
      const secondPath = await facade.findPath({
        graphId: 'graph-v1', startNodeId: 'start', goalNodeId: 'goal',
      })
      assert(secondPath.kind === 'path', 'second path receipt')
      mode = 'render-success'
      const rendered = await facade.renderRoute(secondPath)
      assert(rendered.kind === 'rendered', 'owned route receipt')
      mode = 'remove-unavailable'
      const unavailableRemove = await facade.removeRoute(rendered.routeId)
      assert('kind' in unavailableRemove, 'remove unavailable receipt')
      equal(unavailableRemove.reasonCode, 'PACKAGE_DECLARED_ABSENT', 'remove unavailable reason')
      mode = 'remove-success'
      const removed = await facade.removeRoute(rendered.routeId)
      assert(!('kind' in removed), 'owned route remains removable after gate clears')
      equal(removed.removed, true, 'owned route removed')
    },
  },
]

export async function runTopologyCapabilityGateSuite(): Promise<TopologyCapabilityGateSuiteResult> {
  const startedAt = performance.now()
  const names: string[] = []
  for (const test of tests) {
    try {
      await test.run()
      names.push(test.name)
      console.log(`[topology-capability-gate:test] PASS ${test.name}`)
    } catch (error) {
      const detail = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)
      throw new Error(`[topology-capability-gate:test] FAIL ${test.name}\n${detail}`)
    }
  }
  return {
    passed: names.length,
    names,
    durationMs: performance.now() - startedAt,
  }
}
