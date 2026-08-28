import * as THREE from 'three'
import { effectScope, ref, type EffectScope, type Ref } from 'vue'
import { ssp } from '../../ssp'
import {
  createTopologyQuickAction,
  type TopologyQuickActionSession,
  type UseTopologyQuickActionReturn,
} from '../../composables/useTopologyQuickAction'
import {
  createTopologyQuickActionFacade,
  topologyQuickActionFacade,
  type TopologyPathReceipt,
  type TopologyQuickActionTemplateRuntime,
} from '../../templates/topologyQuickAction'
import type {
  TopologySceneSessionNode,
  TopologySceneSessionStatus,
} from '../../topology'
import type { TopologySidecarDiagnostic } from '../../adapters/topology'

type TestBody = () => void | Promise<void>

interface TestCase {
  name: string
  run: TestBody
}

export interface TopologyQuickActionSuiteResult {
  passed: number
  names: readonly string[]
  durationMs: number
}

interface RuntimeCall {
  templateId: string
  params: Record<string, unknown>
  options: { aiOnly?: boolean; validateParams?: boolean }
}

type RuntimeHandler = (
  templateId: string,
  params: Record<string, unknown>,
  options: { aiOnly?: boolean; validateParams?: boolean },
) => unknown | Promise<unknown>

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

async function expectRejects(
  run: () => Promise<unknown>,
  includes: string,
  message: string,
): Promise<void> {
  try {
    await run()
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    assert(detail.includes(includes), `${message}: expected "${includes}", got "${detail}"`)
    return
  }
  throw new Error(`${message}: expected a rejection`)
}

function deferred<T>(): {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function until(predicate: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (predicate()) return
    await Promise.resolve()
  }
  throw new Error(message)
}

function runtimeHarness(handler: RuntimeHandler): {
  runtime: TopologyQuickActionTemplateRuntime
  calls: RuntimeCall[]
} {
  const calls: RuntimeCall[] = []
  return {
    calls,
    runtime: {
      async execute(templateId, params = {}, options = {}) {
        calls.push({ templateId, params, options })
        return handler(templateId, params, options)
      },
    },
  }
}

function nodes(layerId = 'A_1F'): readonly TopologySceneSessionNode[] {
  return Object.freeze([
    Object.freeze({ id: 'start', layerId, label: 'Start' }),
    Object.freeze({ id: 'goal', layerId, label: 'Goal' }),
    Object.freeze({ id: 'alternate', layerId, label: 'Alternate' }),
  ])
}

function sessionHarness(
  graphIdValue = 'graph-a',
  layerId = 'A_1F',
): TopologyQuickActionSession & {
  status: Ref<TopologySceneSessionStatus>
  graphId: Ref<string | null>
  nodes: Ref<readonly TopologySceneSessionNode[]>
  diagnostic: Ref<TopologySidecarDiagnostic | null>
} {
  return {
    status: ref<TopologySceneSessionStatus>('ready'),
    graphId: ref<string | null>(graphIdValue),
    nodes: ref<readonly TopologySceneSessionNode[]>(nodes(layerId)),
    diagnostic: ref<TopologySidecarDiagnostic | null>(null),
  }
}

function routeFixture(
  graphId = 'graph-a',
  startNodeId = 'start',
  goalNodeId = 'goal',
  layerId = 'A_1F',
): Record<string, unknown> {
  const points = [
    { x: 0, y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
  ]
  return {
    graphId,
    graphRoutingRevision: 0,
    startNodeId,
    goalNodeId,
    selectedRequirementNodeIds: [],
    nodeIds: [startNodeId, goalNodeId],
    layerIds: [layerId],
    steps: [{
      edgeId: 'edge-1',
      fromNodeId: startNodeId,
      toNodeId: goalNodeId,
      fromLayerId: layerId,
      toLayerId: layerId,
      relation: 'LINK',
      traversalDirection: 'FORWARD',
      points,
      length: 2,
      weight: 2,
    }],
    flattenedPoints: points,
    totalLength: 2,
    totalWeight: 2,
  }
}

function routeWithPointBudget(
  stepCount: number,
  pointsPerStep: number,
  flattenedPointCount: number,
): Record<string, unknown> {
  const sharedPoint = Object.freeze({ x: 0, y: 0, z: 0 })
  const steps = Array.from({ length: stepCount }, (_, index) => ({
    edgeId: `edge-${String(index)}`,
    fromNodeId: 'start',
    toNodeId: 'goal',
    fromLayerId: 'A_1F',
    toLayerId: 'A_1F',
    relation: 'LINK',
    traversalDirection: 'FORWARD',
    points: Array.from({ length: pointsPerStep }, () => sharedPoint),
    length: 1,
    weight: 1,
  }))
  return {
    ...routeFixture(),
    steps,
    flattenedPoints: Array.from({ length: flattenedPointCount }, () => sharedPoint),
    totalLength: stepCount,
    totalWeight: stepCount,
  }
}

function findSuccess(
  graphId = 'graph-a',
  startNodeId = 'start',
  goalNodeId = 'goal',
  layerId = 'A_1F',
): Record<string, unknown> {
  return {
    ok: true,
    route: routeFixture(graphId, startNodeId, goalNodeId, layerId),
    stats: {
      algorithm: 'CONSTRAINED_DIJKSTRA',
      visitedStateCount: 2,
      durationMs: 0.25,
    },
  }
}

function renderSuccess(
  routeId = 'topology_route_1',
  graphId = 'graph-a',
  startNodeId = 'start',
  goalNodeId = 'goal',
  layerId = 'A_1F',
): Record<string, unknown> {
  return {
    rendered: true,
    id: routeId,
    status: 'ACTIVE',
    graphId,
    graphRoutingRevision: 0,
    nodeIds: [startNodeId, goalNodeId],
    layerIds: [layerId],
    edgeIds: ['edge-1'],
    totalLength: 2,
    totalWeight: 2,
  }
}

function mountController(
  session: TopologyQuickActionSession,
  runtime: TopologyQuickActionTemplateRuntime,
): { scope: EffectScope; controller: UseTopologyQuickActionReturn } {
  const scope = effectScope()
  const controller = scope.run(() => createTopologyQuickAction(
    session,
    createTopologyQuickActionFacade(runtime),
  ))
  assert(controller, 'controller must be created inside the effect scope')
  return { scope, controller }
}

function selectEndpoints(controller: UseTopologyQuickActionReturn): void {
  controller.startNodeId.value = 'start'
  controller.goalNodeId.value = 'goal'
}

const tests: TestCase[] = [
  {
    name: 'facade uses fixed template ids, exact params, fixed style, flow, and trusted options',
    run: async () => {
      const harness = runtimeHarness((templateId, params) => {
        if (templateId === 'findPath') return findSuccess()
        if (templateId === 'renderRoute') return renderSuccess()
        if (templateId === 'removeRoute') {
          return { id: params.routeId, removed: true }
        }
        throw new Error('unexpected template id')
      })
      const facade = createTopologyQuickActionFacade(harness.runtime)
      const found = await facade.findPath({
        graphId: 'graph-a',
        startNodeId: 'start',
        goalNodeId: 'goal',
      })
      assert(found.kind === 'path', 'path receipt expected')
      const rendered = await facade.renderRoute(found)
      assert(rendered.kind === 'rendered', 'rendered receipt expected')
      await facade.removeRoute(rendered.routeId)

      deepEqual(
        harness.calls.map((call) => call.templateId),
        ['findPath', 'renderRoute', 'removeRoute'],
        'fixed template order',
      )
      deepEqual(harness.calls[0]?.params, {
        query: { graphId: 'graph-a', startNodeId: 'start', goalNodeId: 'goal' },
      }, 'findPath params')
      deepEqual(harness.calls[1]?.params, {
        options: {
          route: routeFixture(),
          visible: true,
          style: { color: '#FF5A36', width: 0.16, opacity: 0.95, depthTest: false },
          flow: { active: true, speed: 2, spacing: 1.4, color: '#FFF176', size: 0.14 },
        },
      }, 'renderRoute params')
      deepEqual(harness.calls[2]?.params, { routeId: 'topology_route_1' }, 'removeRoute params')
      harness.calls.forEach((call) => {
        deepEqual(call.options, { aiOnly: false, validateParams: true }, `${call.templateId} options`)
      })
    },
  },
  {
    name: 'empty endpoints never execute a template and facade rejects empty ids before runtime',
    run: async () => {
      const harness = runtimeHarness(() => {
        throw new Error('runtime must not be called')
      })
      const facade = createTopologyQuickActionFacade(harness.runtime)
      await expectRejects(
        () => facade.findPath({ graphId: 'graph-a', startNodeId: '', goalNodeId: 'goal' }),
        '路径操作参数无效',
        'empty facade endpoint',
      )
      const session = sessionHarness()
      const { scope, controller } = mountController(session, harness.runtime)
      await controller.execute()
      equal(harness.calls.length, 0, 'empty selection runtime calls')
      equal(controller.canExecute.value, false, 'empty selection execute gate')
      scope.stop()
    },
  },
  {
    name: 'session diagnostics expose only structured code and phase in unavailable UI',
    run: () => {
      const harness = runtimeHarness(() => {
        throw new Error('runtime must not be called')
      })
      const session = sessionHarness()
      const { scope, controller } = mountController(session, harness.runtime)
      session.diagnostic.value = {
        code: 'SIDECAR_NOT_FOUND',
        phase: 'DISCOVER',
        message: 'raw discovery detail must stay private',
        path: '/private/path',
        sidecarUri: 'https://space.test/private.topology.v1.json?token=secret',
        assetId: null,
        entityId: null,
        details: { authorization: 'secret' },
      }
      session.status.value = 'unavailable'
      equal(
        controller.statusMessage.value,
        '当前场景没有可用拓扑（SIDECAR_NOT_FOUND / DISCOVER）。',
        'safe unavailable diagnostic',
      )
      assert(
        !controller.statusMessage.value.includes('private') &&
          !controller.statusMessage.value.includes('secret'),
        'raw diagnostic fields must not reach unavailable UI',
      )

      session.diagnostic.value = {
        ...session.diagnostic.value,
        code: 'SIDECAR_JSON_INVALID',
        phase: 'PARSE',
      }
      session.status.value = 'error'
      equal(
        controller.statusMessage.value,
        '拓扑会话不可用（SIDECAR_JSON_INVALID / PARSE）。',
        'safe error diagnostic',
      )
      equal(harness.calls.length, 0, 'diagnostic projection runtime calls')
      scope.stop()
    },
  },
  {
    name: 'facade rejects a structurally valid but unissued path receipt before runtime',
    run: async () => {
      const harness = runtimeHarness(() => {
        throw new Error('runtime must not be called')
      })
      const facade = createTopologyQuickActionFacade(harness.runtime)
      const raw = findSuccess()
      const forged = {
        kind: 'path',
        graphId: 'graph-a',
        startNodeId: 'start',
        goalNodeId: 'goal',
        route: raw.route,
        stats: raw.stats,
      } as unknown as TopologyPathReceipt
      await expectRejects(
        () => facade.renderRoute(forged),
        '路径操作参数无效',
        'forged path receipt',
      )
      await expectRejects(
        () => facade.removeRoute('unissued-route'),
        '路径操作参数无效',
        'unissued route id',
      )
      equal(harness.calls.length, 0, 'forged receipt runtime calls')
    },
  },
  {
    name: 'route point aggregate accepts its boundary and rejects excess before renderRoute',
    run: async () => {
      const stats = {
        algorithm: 'CONSTRAINED_DIJKSTRA',
        visitedStateCount: 2,
        durationMs: 0.25,
      }
      const boundaryHarness = runtimeHarness((templateId) => {
        if (templateId === 'findPath') {
          return {
            ok: true,
            route: routeWithPointBudget(757, 66, 38),
            stats,
          }
        }
        throw new Error(`unexpected template ${templateId}`)
      })
      const boundaryFacade = createTopologyQuickActionFacade(boundaryHarness.runtime)
      const boundaryResult = await boundaryFacade.findPath({
        graphId: 'graph-a',
        startNodeId: 'start',
        goalNodeId: 'goal',
      })
      equal(boundaryResult.kind, 'path', 'aggregate point boundary')
      deepEqual(
        boundaryHarness.calls.map((call) => call.templateId),
        ['findPath'],
        'boundary runtime calls',
      )

      const excessHarness = runtimeHarness((templateId) => {
        if (templateId === 'findPath') {
          return {
            ok: true,
            route: routeWithPointBudget(758, 66, 1),
            stats,
          }
        }
        throw new Error(`unexpected template ${templateId}`)
      })
      const excessFacade = createTopologyQuickActionFacade(excessHarness.runtime)
      await expectRejects(
        () => excessFacade.findPath({
          graphId: 'graph-a',
          startNodeId: 'start',
          goalNodeId: 'goal',
        }),
        '路径模板返回了无效结果',
        'aggregate point excess',
      )
      deepEqual(
        excessHarness.calls.map((call) => call.templateId),
        ['findPath'],
        'excess must not call renderRoute',
      )
    },
  },
  {
    name: 'explicit ready-session endpoints execute find then render and own the returned route',
    run: async () => {
      const harness = runtimeHarness((templateId) => {
        if (templateId === 'findPath') return findSuccess()
        if (templateId === 'renderRoute') return renderSuccess('route-success')
        if (templateId === 'removeRoute') return { id: 'route-success', removed: true }
        throw new Error('unexpected template')
      })
      const { scope, controller } = mountController(sessionHarness(), harness.runtime)
      selectEndpoints(controller)
      await controller.execute()
      deepEqual(harness.calls.slice(0, 2).map((call) => call.templateId), ['findPath', 'renderRoute'], 'success order')
      equal(controller.status.value, 'success', 'success status')
      equal(controller.currentRouteId.value, 'route-success', 'owned route id')
      equal(controller.result.value?.code, 'ROUTE_RENDERED', 'success result code')
      scope.stop()
    },
  },
  {
    name: 'NO_PATH is a sanitized structured result and never calls renderRoute',
    run: async () => {
      const harness = runtimeHarness((templateId) => {
        if (templateId === 'findPath') {
          return { ok: false, code: 'NO_PATH', message: 'raw internal no-path detail' }
        }
        throw new Error(`unexpected template ${templateId}`)
      })
      const { scope, controller } = mountController(sessionHarness('graph-a', 'A_2F'), harness.runtime)
      selectEndpoints(controller)
      await controller.execute()
      deepEqual(harness.calls.map((call) => call.templateId), ['findPath'], 'NO_PATH calls')
      equal(controller.status.value, 'no-path', 'NO_PATH status')
      equal(controller.result.value?.code, 'NO_PATH', 'NO_PATH result code')
      assert(
        !controller.statusMessage.value.includes('raw internal'),
        'raw template message must not reach the UI',
      )
      equal(controller.currentRouteId.value, null, 'NO_PATH route id')
      scope.stop()
    },
  },
  {
    name: 'other findPath failures stay structured and never call renderRoute',
    run: async () => {
      const harness = runtimeHarness((templateId) => {
        if (templateId === 'findPath') {
          return { ok: false, code: 'START_NOT_FOUND', message: 'untrusted start detail' }
        }
        throw new Error(`unexpected template ${templateId}`)
      })
      const { scope, controller } = mountController(sessionHarness(), harness.runtime)
      selectEndpoints(controller)
      await controller.execute()
      deepEqual(harness.calls.map((call) => call.templateId), ['findPath'], 'failed path calls')
      equal(controller.status.value, 'error', 'failed path status')
      equal(controller.result.value?.code, 'START_NOT_FOUND', 'failed path code')
      equal(controller.currentRouteId.value, null, 'failed path route id')
      scope.stop()
    },
  },
  {
    name: 'rendered false is not success and never stores a route id',
    run: async () => {
      for (const code of ['STALE_ROUTE', 'GRAPH_NOT_FOUND'] as const) {
        const harness = runtimeHarness((templateId) => {
          if (templateId === 'findPath') return findSuccess()
          if (templateId === 'renderRoute') return { rendered: false, code }
          throw new Error(`unexpected template ${templateId}`)
        })
        const { scope, controller } = mountController(sessionHarness(), harness.runtime)
        selectEndpoints(controller)
        await controller.execute()
        equal(controller.status.value, 'error', `${code} status`)
        equal(controller.result.value?.code, code, `${code} result`)
        equal(controller.currentRouteId.value, null, `${code} route ownership`)
        scope.stop()
      }
    },
  },
  {
    name: 'session change after findPath makes the result stale and prevents renderRoute',
    run: async () => {
      const findGate = deferred<unknown>()
      const harness = runtimeHarness((templateId) => {
        if (templateId === 'findPath') return findGate.promise
        throw new Error(`unexpected template ${templateId}`)
      })
      const session = sessionHarness()
      const { scope, controller } = mountController(session, harness.runtime)
      selectEndpoints(controller)
      const execution = controller.execute()
      await until(() => harness.calls.length === 1, 'findPath did not start')
      session.status.value = 'loading'
      findGate.resolve(findSuccess())
      await execution
      deepEqual(harness.calls.map((call) => call.templateId), ['findPath'], 'stale find calls')
      equal(controller.currentRouteId.value, null, 'stale find route id')
      equal(controller.result.value, null, 'stale find result')
      equal(controller.startNodeId.value, '', 'stale find start reset')
      equal(controller.goalNodeId.value, '', 'stale find goal reset')
      scope.stop()
    },
  },
  {
    name: 'session change after render side effect compensates the exact stale route id',
    run: async () => {
      const renderGate = deferred<unknown>()
      const harness = runtimeHarness((templateId, params) => {
        if (templateId === 'findPath') return findSuccess()
        if (templateId === 'renderRoute') return renderGate.promise
        if (templateId === 'removeRoute') return { id: params.routeId, removed: false }
        throw new Error(`unexpected template ${templateId}`)
      })
      const session = sessionHarness()
      const { scope, controller } = mountController(session, harness.runtime)
      selectEndpoints(controller)
      const execution = controller.execute()
      await until(
        () => harness.calls.some((call) => call.templateId === 'renderRoute'),
        'renderRoute did not start',
      )
      session.status.value = 'loading'
      renderGate.resolve(renderSuccess('route-stale'))
      await execution
      deepEqual(
        harness.calls.map((call) => call.templateId),
        ['findPath', 'renderRoute', 'removeRoute'],
        'stale render compensation order',
      )
      deepEqual(harness.calls[2]?.params, { routeId: 'route-stale' }, 'stale route compensation id')
      equal(controller.currentRouteId.value, null, 'stale render route ownership')
      equal(controller.result.value, null, 'stale render result')
      scope.stop()
    },
  },
  {
    name: 'clear cancels inflight render and cleanup only targets the rendered controlled id',
    run: async () => {
      const renderGate = deferred<unknown>()
      const harness = runtimeHarness((templateId, params) => {
        if (templateId === 'findPath') return findSuccess()
        if (templateId === 'renderRoute') return renderGate.promise
        if (templateId === 'removeRoute') return { id: params.routeId, removed: false }
        throw new Error(`unexpected template ${templateId}`)
      })
      const { scope, controller } = mountController(sessionHarness(), harness.runtime)
      selectEndpoints(controller)
      const execution = controller.execute()
      await until(
        () => harness.calls.some((call) => call.templateId === 'renderRoute'),
        'renderRoute did not start before clear',
      )
      await controller.clear()
      renderGate.resolve(renderSuccess('route-after-clear'))
      await execution
      const removals = harness.calls.filter((call) => call.templateId === 'removeRoute')
      equal(removals.length, 1, 'clear compensation count')
      deepEqual(removals[0]?.params, { routeId: 'route-after-clear' }, 'clear compensation target')
      equal(controller.currentRouteId.value, null, 'clear inflight route ownership')
      scope.stop()
    },
  },
  {
    name: 'explicit clear removes only the currently owned route and is idempotent in UI state',
    run: async () => {
      const harness = runtimeHarness((templateId, params) => {
        if (templateId === 'findPath') return findSuccess()
        if (templateId === 'renderRoute') return renderSuccess('route-owned')
        if (templateId === 'removeRoute') return { id: params.routeId, removed: false }
        throw new Error(`unexpected template ${templateId}`)
      })
      const { scope, controller } = mountController(sessionHarness(), harness.runtime)
      selectEndpoints(controller)
      await controller.execute()
      await controller.clear()
      await controller.clear()
      const removals = harness.calls.filter((call) => call.templateId === 'removeRoute')
      equal(removals.length, 1, 'owned route removal count')
      deepEqual(removals[0]?.params, { routeId: 'route-owned' }, 'owned route removal target')
      equal(controller.currentRouteId.value, null, 'cleared route ownership')
      scope.stop()
    },
  },
  {
    name: 're-execution removes the previous owned route before a new no-path result',
    run: async () => {
      let findCount = 0
      const harness = runtimeHarness((templateId, params) => {
        if (templateId === 'findPath') {
          findCount++
          return findCount === 1
            ? findSuccess()
            : { ok: false, code: 'NO_PATH', message: 'no replacement' }
        }
        if (templateId === 'renderRoute') return renderSuccess('route-previous')
        if (templateId === 'removeRoute') return { id: params.routeId, removed: true }
        throw new Error(`unexpected template ${templateId}`)
      })
      const { scope, controller } = mountController(sessionHarness(), harness.runtime)
      selectEndpoints(controller)
      await controller.execute()
      await controller.execute()
      deepEqual(
        harness.calls.map((call) => call.templateId),
        ['findPath', 'renderRoute', 'removeRoute', 'findPath'],
        'replacement order',
      )
      deepEqual(harness.calls[2]?.params, { routeId: 'route-previous' }, 'replaced route id')
      equal(controller.status.value, 'no-path', 'replacement no-path status')
      equal(controller.currentRouteId.value, null, 'replacement route ownership')
      scope.stop()
    },
  },
  {
    name: 'malformed template output and thrown errors become stable sanitized UI errors',
    run: async () => {
      const malformedHarness = runtimeHarness((templateId) => {
        if (templateId === 'findPath') return { ok: true, route: {}, stats: {} }
        throw new Error(`unexpected template ${templateId}`)
      })
      const malformedMount = mountController(sessionHarness(), malformedHarness.runtime)
      selectEndpoints(malformedMount.controller)
      await malformedMount.controller.execute()
      equal(malformedMount.controller.result.value?.code, 'MALFORMED_TEMPLATE_OUTPUT', 'malformed code')
      equal(
        malformedMount.controller.statusMessage.value,
        '路径模板返回了无效结果。',
        'malformed message',
      )
      malformedMount.scope.stop()

      const thrownHarness = runtimeHarness(() => {
        throw new Error('sensitive runtime detail')
      })
      const thrownMount = mountController(sessionHarness(), thrownHarness.runtime)
      selectEndpoints(thrownMount.controller)
      await thrownMount.controller.execute()
      equal(thrownMount.controller.result.value?.code, 'TEMPLATE_EXECUTION_FAILED', 'thrown code')
      assert(
        !thrownMount.controller.statusMessage.value.includes('sensitive runtime detail'),
        'thrown detail must not reach the UI',
      )
      thrownMount.scope.stop()
    },
  },
  {
    name: 'same graph id lifecycle reload invalidates old work and resets endpoints and results',
    run: async () => {
      const findGate = deferred<unknown>()
      const harness = runtimeHarness((templateId) => {
        if (templateId === 'findPath') return findGate.promise
        throw new Error(`unexpected template ${templateId}`)
      })
      const session = sessionHarness('graph-reused')
      const { scope, controller } = mountController(session, harness.runtime)
      selectEndpoints(controller)
      const execution = controller.execute()
      await until(() => harness.calls.length === 1, 'same-id findPath did not start')
      session.status.value = 'loading'
      session.nodes.value = Object.freeze([])
      session.graphId.value = null
      session.graphId.value = 'graph-reused'
      session.nodes.value = nodes()
      session.status.value = 'ready'
      findGate.resolve(findSuccess('graph-reused'))
      await execution
      deepEqual(harness.calls.map((call) => call.templateId), ['findPath'], 'same-id reload calls')
      equal(controller.startNodeId.value, '', 'same-id start reset')
      equal(controller.goalNodeId.value, '', 'same-id goal reset')
      equal(controller.result.value, null, 'same-id result reset')
      equal(controller.currentRouteId.value, null, 'same-id route reset')
      equal(controller.status.value, 'idle', 'same-id ready state')
      scope.stop()
    },
  },
  {
    name: 'endpoint change cancels inflight work and leaving ready clears all controlled UI state',
    run: async () => {
      const findGate = deferred<unknown>()
      const harness = runtimeHarness((templateId) => {
        if (templateId === 'findPath') return findGate.promise
        throw new Error(`unexpected template ${templateId}`)
      })
      const session = sessionHarness()
      const { scope, controller } = mountController(session, harness.runtime)
      selectEndpoints(controller)
      const execution = controller.execute()
      await until(() => harness.calls.length === 1, 'endpoint-change findPath did not start')
      controller.startNodeId.value = 'alternate'
      findGate.resolve(findSuccess())
      await execution
      deepEqual(harness.calls.map((call) => call.templateId), ['findPath'], 'endpoint change calls')
      equal(controller.result.value, null, 'endpoint change result')
      equal(controller.phase.value, 'idle', 'endpoint change phase')

      session.status.value = 'loading'
      equal(controller.startNodeId.value, '', 'leave-ready start reset')
      equal(controller.goalNodeId.value, '', 'leave-ready goal reset')
      equal(controller.result.value, null, 'leave-ready result reset')
      equal(controller.currentRouteId.value, null, 'leave-ready route reset')
      equal(controller.status.value, 'unavailable', 'leave-ready status')
      scope.stop()
    },
  },
  {
    name: 'session replacement compensates the previously owned route before forgetting it',
    run: async () => {
      const harness = runtimeHarness((templateId, params) => {
        if (templateId === 'findPath') return findSuccess()
        if (templateId === 'renderRoute') return renderSuccess('route-before-session-change')
        if (templateId === 'removeRoute') return { id: params.routeId, removed: true }
        throw new Error(`unexpected template ${templateId}`)
      })
      const session = sessionHarness()
      const { scope, controller } = mountController(session, harness.runtime)
      selectEndpoints(controller)
      await controller.execute()

      session.status.value = 'loading'
      await until(
        () => harness.calls.some((call) => call.templateId === 'removeRoute'),
        'session replacement did not compensate its owned route',
      )
      const removals = harness.calls.filter((call) => call.templateId === 'removeRoute')
      equal(removals.length, 1, 'session replacement removal count')
      deepEqual(
        removals[0]?.params,
        { routeId: 'route-before-session-change' },
        'session replacement removal target',
      )
      equal(controller.currentRouteId.value, null, 'session replacement route ownership')
      scope.stop()
    },
  },
  {
    name: 'effect-scope disposal stops watchers, invalidates work, and clears the owned route',
    run: async () => {
      const harness = runtimeHarness((templateId, params) => {
        if (templateId === 'findPath') return findSuccess()
        if (templateId === 'renderRoute') return renderSuccess('route-dispose')
        if (templateId === 'removeRoute') return { id: params.routeId, removed: true }
        throw new Error(`unexpected template ${templateId}`)
      })
      const session = sessionHarness()
      const { scope, controller } = mountController(session, harness.runtime)
      selectEndpoints(controller)
      await controller.execute()
      scope.stop()

      equal(controller.phase.value, 'unavailable', 'disposed phase')
      equal(controller.startNodeId.value, '', 'disposed start')
      equal(controller.goalNodeId.value, '', 'disposed goal')
      equal(controller.currentRouteId.value, null, 'disposed route ownership')
      const removals = harness.calls.filter((call) => call.templateId === 'removeRoute')
      equal(removals.length, 1, 'disposed removal count')
      deepEqual(removals[0]?.params, { routeId: 'route-dispose' }, 'disposed removal target')

      session.graphId.value = 'graph-after-dispose'
      session.nodes.value = nodes('A_2F')
      session.status.value = 'ready'
      equal(controller.phase.value, 'unavailable', 'stopped session watcher')
    },
  },
  {
    name: 'default facade executes the registered find render remove templates end to end',
    run: async () => {
      const graphId = 'quick-action-runtime-integration'
      const scene = new THREE.Scene()
      ssp.setContext({
        scene,
        camera: new THREE.PerspectiveCamera(),
        renderer: {} as THREE.WebGLRenderer,
        domElement: {} as HTMLElement,
      })
      try {
        ssp.topologyTool.removeAllRoutes()
        ssp.topologyTool.removeAllGraphs()
        ssp.topologyTool.createGraph({
          id: graphId,
          layers: [{ id: 'L1' }],
          nodes: [
            { id: 'start', layerId: 'L1', position: { x: 0, y: 0, z: 0 } },
            { id: 'goal', layerId: 'L1', position: { x: 4, y: 0, z: 0 } },
          ],
          edges: [{
            id: 'edge',
            source: 'start',
            target: 'goal',
            relation: 'LINK',
            direction: 'BIDIRECTIONAL',
          }],
        })

        const found = await topologyQuickActionFacade.findPath({
          graphId,
          startNodeId: 'start',
          goalNodeId: 'goal',
        })
        assert(found.kind === 'path', 'real runtime path receipt expected')
        const rendered = await topologyQuickActionFacade.renderRoute(found)
        assert(rendered.kind === 'rendered', 'real runtime rendered receipt expected')
        assert(ssp.topologyTool.getRouteById(rendered.routeId), 'real runtime route handle expected')
        assert(scene.children.length > 0, 'real runtime route should attach to the scene')

        const removed = await topologyQuickActionFacade.removeRoute(rendered.routeId)
        assert(!('kind' in removed), 'real runtime route removal receipt expected')
        equal(removed.removed, true, 'real runtime route removal')
        equal(ssp.topologyTool.getRouteById(rendered.routeId), null, 'real runtime route disposal')
      } finally {
        ssp.topologyTool.removeAllRoutes()
        ssp.topologyTool.removeAllGraphs()
        ssp.clearContext()
      }
    },
  },
]

export async function runTopologyQuickActionSuite(): Promise<TopologyQuickActionSuiteResult> {
  const startedAt = performance.now()
  const names: string[] = []
  for (const test of tests) {
    try {
      await test.run()
      names.push(test.name)
      console.log(`[topology-quick-action:test] PASS ${test.name}`)
    } catch (error) {
      const detail = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)
      throw new Error(`[topology-quick-action:test] FAIL ${test.name}\n${detail}`)
    }
  }
  return {
    passed: names.length,
    names,
    durationMs: performance.now() - startedAt,
  }
}
