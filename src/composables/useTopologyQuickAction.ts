import {
  computed,
  onScopeDispose,
  ref,
  watch,
  type ComputedRef,
  type Ref,
  type WatchStopHandle,
} from 'vue'
import { useTopologySceneLifecycle } from '@/composables/useTopologySceneLifecycle'
import type { TopologySidecarDiagnostic } from '@/adapters/topology'
import {
  normalizeTopologyQuickActionError,
  topologyQuickActionFacade,
  type TopologyPathFailureCode,
  type TopologyQuickActionErrorCode,
  type TopologyQuickActionFacade,
  type TopologyRenderFailureCode,
  type TopologyCapabilityUnavailable,
} from '@/templates/topologyQuickAction'
import type {
  TopologySceneSessionNode,
  TopologySceneSessionStatus,
} from '@/topology'

export type TopologyQuickActionPhase =
  | 'unavailable'
  | 'idle'
  | 'clearing'
  | 'finding'
  | 'rendering'

export type TopologyQuickActionStatus =
  | TopologyQuickActionPhase
  | 'success'
  | 'no-path'
  | 'error'
  | 'cleared'

export type TopologyQuickActionResult =
  | Readonly<{
      kind: 'success'
      code: 'ROUTE_RENDERED'
      message: string
      routeId: string
      graphId: string
      totalLength: number
      totalWeight: number
    }>
  | Readonly<{
      kind: 'path-failure'
      code: TopologyPathFailureCode
      message: string
    }>
  | Readonly<{
      kind: 'render-failure'
      code: TopologyRenderFailureCode
      message: string
    }>
  | TopologyCapabilityUnavailable
  | Readonly<{
      kind: 'error'
      code: TopologyQuickActionErrorCode
      message: string
    }>
  | Readonly<{
      kind: 'cleared'
      code: 'ROUTE_CLEARED'
      message: string
    }>

export interface TopologyQuickActionSession {
  status: Readonly<Ref<TopologySceneSessionStatus>>
  graphId: Readonly<Ref<string | null>>
  nodes: Readonly<Ref<readonly TopologySceneSessionNode[]>>
  diagnostic: Readonly<Ref<TopologySidecarDiagnostic | null>>
}

export interface UseTopologyQuickActionReturn {
  startNodeId: Ref<string>
  goalNodeId: Ref<string>
  nodes: ComputedRef<readonly TopologySceneSessionNode[]>
  graphId: ComputedRef<string | null>
  phase: ComputedRef<TopologyQuickActionPhase>
  status: ComputedRef<TopologyQuickActionStatus>
  statusMessage: ComputedRef<string>
  result: ComputedRef<TopologyQuickActionResult | null>
  currentRouteId: ComputedRef<string | null>
  busy: ComputedRef<boolean>
  sessionReady: ComputedRef<boolean>
  canExecute: ComputedRef<boolean>
  canClear: ComputedRef<boolean>
  execute(): Promise<void>
  clear(): Promise<void>
}

function isNonEmpty(value: string | null): value is string {
  return typeof value === 'string' && value.length > 0
}

function diagnosticLabel(diagnostic: TopologySidecarDiagnostic | null): string {
  return diagnostic === null ? '' : `（${diagnostic.code} / ${diagnostic.phase}）`
}

export function createTopologyQuickAction(
  session: TopologyQuickActionSession,
  facade: TopologyQuickActionFacade = topologyQuickActionFacade,
): UseTopologyQuickActionReturn {
  const startNodeId = ref('')
  const goalNodeId = ref('')
  const activePhase = ref<TopologyQuickActionPhase>('unavailable')
  const activeResult = ref<TopologyQuickActionResult | null>(null)
  const ownedRouteId = ref<string | null>(null)
  let sceneEpoch = 0
  let operationToken = 0
  let disposed = false

  const nodes = computed(() => session.nodes.value)
  const graphId = computed(() => session.graphId.value)
  const sessionReady = computed(() => (
    session.status.value === 'ready' &&
    isNonEmpty(session.graphId.value) &&
    session.nodes.value.length > 0
  ))
  const busy = computed(() => (
    activePhase.value === 'clearing' ||
    activePhase.value === 'finding' ||
    activePhase.value === 'rendering'
  ))
  const selectedEndpointsValid = computed(() => {
    if (!sessionReady.value || startNodeId.value.length === 0 || goalNodeId.value.length === 0) {
      return false
    }
    if (startNodeId.value === goalNodeId.value) return false
    const nodeIds = new Set(session.nodes.value.map((node) => node.id))
    return nodeIds.has(startNodeId.value) && nodeIds.has(goalNodeId.value)
  })
  const canExecute = computed(() => selectedEndpointsValid.value && !busy.value)
  const canClear = computed(() => (
    sessionReady.value && ownedRouteId.value !== null && !busy.value
  ))

  const status = computed<TopologyQuickActionStatus>(() => {
    if (busy.value || activePhase.value === 'unavailable') return activePhase.value
    if (activeResult.value?.kind === 'success') return 'success'
    if (activeResult.value?.kind === 'path-failure') {
      return activeResult.value.code === 'NO_PATH' ? 'no-path' : 'error'
    }
    if (
      activeResult.value?.kind === 'render-failure' ||
      activeResult.value?.kind === 'capability-unavailable' ||
      activeResult.value?.kind === 'error'
    ) {
      return 'error'
    }
    if (activeResult.value?.kind === 'cleared') return 'cleared'
    return 'idle'
  })

  const statusMessage = computed(() => {
    if (activePhase.value === 'clearing') return '正在清除当前路线…'
    if (activePhase.value === 'finding') return '正在查找路径…'
    if (activePhase.value === 'rendering') return '正在显示路线…'
    if (activeResult.value !== null) return activeResult.value.message
    if (session.status.value === 'loading') return '拓扑会话加载中。'
    if (session.status.value === 'unavailable') {
      return `当前场景没有可用拓扑${diagnosticLabel(session.diagnostic.value)}。`
    }
    if (session.status.value === 'error') {
      return `拓扑会话不可用${diagnosticLabel(session.diagnostic.value)}。`
    }
    if (!sessionReady.value) return '请选择包含显式拓扑节点的场景。'
    if (session.nodes.value.length < 2) return '当前拓扑不足两个显式节点。'
    if (startNodeId.value.length === 0 || goalNodeId.value.length === 0) {
      return '请显式选择起点和终点。'
    }
    if (startNodeId.value === goalNodeId.value) return '起点和终点必须不同。'
    if (!selectedEndpointsValid.value) return '所选端点不属于当前拓扑会话。'
    if (ownedRouteId.value !== null) return '当前路线仍受控；重新执行会先清除它。'
    return '可以执行路径 Quick Action。'
  })

  function isSceneCurrent(epoch: number, expectedGraphId: string): boolean {
    return (
      !disposed &&
      sceneEpoch === epoch &&
      session.status.value === 'ready' &&
      session.graphId.value === expectedGraphId
    )
  }

  function isOperationCurrent(
    token: number,
    epoch: number,
    expectedGraphId: string,
    expectedStartNodeId: string,
    expectedGoalNodeId: string,
  ): boolean {
    if (
      operationToken !== token ||
      !isSceneCurrent(epoch, expectedGraphId) ||
      startNodeId.value !== expectedStartNodeId ||
      goalNodeId.value !== expectedGoalNodeId
    ) {
      return false
    }
    const nodeIds = new Set(session.nodes.value.map((node) => node.id))
    return nodeIds.has(expectedStartNodeId) && nodeIds.has(expectedGoalNodeId)
  }

  async function compensateRoute(routeId: string): Promise<void> {
    try {
      await facade.removeRoute(routeId)
    } catch {
      // Session lifecycle cleanup remains authoritative; compensation is best effort.
    }
  }

  async function execute(): Promise<void> {
    if (!canExecute.value) return

    const token = ++operationToken
    const epoch = sceneEpoch
    const expectedGraphId = session.graphId.value as string
    const expectedStartNodeId = startNodeId.value
    const expectedGoalNodeId = goalNodeId.value
    activeResult.value = null

    try {
      const previousRouteId = ownedRouteId.value
      if (previousRouteId !== null) {
        activePhase.value = 'clearing'
        const removed = await facade.removeRoute(previousRouteId)
        if (!isOperationCurrent(
          token,
          epoch,
          expectedGraphId,
          expectedStartNodeId,
          expectedGoalNodeId,
        )) return
        if ('kind' in removed && removed.kind === 'capability-unavailable') {
          activePhase.value = 'idle'
          activeResult.value = removed
          return
        }
        ownedRouteId.value = null
      }

      activePhase.value = 'finding'
      const path = await facade.findPath({
        graphId: expectedGraphId,
        startNodeId: expectedStartNodeId,
        goalNodeId: expectedGoalNodeId,
      })
      if (!isOperationCurrent(
        token,
        epoch,
        expectedGraphId,
        expectedStartNodeId,
        expectedGoalNodeId,
      )) return

      if (path.kind === 'path-failure') {
        activePhase.value = 'idle'
        activeResult.value = Object.freeze({
          kind: 'path-failure',
          code: path.code,
          message: path.message,
        })
        return
      }
      if (path.kind === 'capability-unavailable') {
        activePhase.value = 'idle'
        activeResult.value = path
        return
      }

      activePhase.value = 'rendering'
      const rendered = await facade.renderRoute(path)
      if (!isOperationCurrent(
        token,
        epoch,
        expectedGraphId,
        expectedStartNodeId,
        expectedGoalNodeId,
      )) {
        if (rendered.kind === 'rendered') await compensateRoute(rendered.routeId)
        return
      }

      activePhase.value = 'idle'
      if (rendered.kind === 'render-failure') {
        activeResult.value = Object.freeze({
          kind: 'render-failure',
          code: rendered.code,
          message: rendered.message,
        })
        return
      }
      if (rendered.kind === 'capability-unavailable') {
        activeResult.value = rendered
        return
      }

      ownedRouteId.value = rendered.routeId
      activeResult.value = Object.freeze({
        kind: 'success',
        code: 'ROUTE_RENDERED',
        message: '路线已显示。',
        routeId: rendered.routeId,
        graphId: rendered.graphId,
        totalLength: rendered.totalLength,
        totalWeight: rendered.totalWeight,
      })
    } catch (error) {
      if (!isOperationCurrent(
        token,
        epoch,
        expectedGraphId,
        expectedStartNodeId,
        expectedGoalNodeId,
      )) return
      const normalized = normalizeTopologyQuickActionError(error)
      activePhase.value = 'idle'
      activeResult.value = Object.freeze({
        kind: 'error',
        code: normalized.code,
        message: normalized.message,
      })
    }
  }

  async function clear(): Promise<void> {
    const token = ++operationToken
    const epoch = sceneEpoch
    const expectedGraphId = session.graphId.value
    const routeId = ownedRouteId.value
    activeResult.value = null

    if (!isNonEmpty(expectedGraphId) || routeId === null || !sessionReady.value) {
      activePhase.value = sessionReady.value ? 'idle' : 'unavailable'
      return
    }

    activePhase.value = 'clearing'
    try {
      const removed = await facade.removeRoute(routeId)
      if (
        operationToken !== token ||
        !isSceneCurrent(epoch, expectedGraphId) ||
        ownedRouteId.value !== routeId
      ) return
      if ('kind' in removed && removed.kind === 'capability-unavailable') {
        activePhase.value = 'idle'
        activeResult.value = removed
        return
      }
      ownedRouteId.value = null
      activePhase.value = 'idle'
      activeResult.value = Object.freeze({
        kind: 'cleared',
        code: 'ROUTE_CLEARED',
        message: '当前路线已清除。',
      })
    } catch (error) {
      if (
        operationToken !== token ||
        !isSceneCurrent(epoch, expectedGraphId) ||
        ownedRouteId.value !== routeId
      ) return
      const normalized = normalizeTopologyQuickActionError(error)
      activePhase.value = 'idle'
      activeResult.value = Object.freeze({
        kind: 'error',
        code: normalized.code,
        message: normalized.message,
      })
    }
  }

  const stopSessionWatch: WatchStopHandle = watch(
    () => [
      session.status.value,
      session.graphId.value,
      session.nodes.value,
      session.diagnostic.value,
    ] as const,
    () => {
      sceneEpoch++
      operationToken++
      const routeId = ownedRouteId.value
      activeResult.value = null
      ownedRouteId.value = null
      startNodeId.value = ''
      goalNodeId.value = ''
      activePhase.value = sessionReady.value ? 'idle' : 'unavailable'
      if (routeId !== null) void compensateRoute(routeId)
    },
    { immediate: true, flush: 'sync' },
  )

  const stopEndpointWatch: WatchStopHandle = watch(
    [startNodeId, goalNodeId],
    () => {
      operationToken++
      activeResult.value = null
      activePhase.value = sessionReady.value ? 'idle' : 'unavailable'
    },
    { flush: 'sync' },
  )

  onScopeDispose(() => {
    disposed = true
    operationToken++
    stopEndpointWatch()
    stopSessionWatch()
    const routeId = ownedRouteId.value
    ownedRouteId.value = null
    activeResult.value = null
    startNodeId.value = ''
    goalNodeId.value = ''
    activePhase.value = 'unavailable'
    if (routeId !== null) void compensateRoute(routeId)
  })

  return {
    startNodeId,
    goalNodeId,
    nodes,
    graphId,
    phase: computed(() => activePhase.value),
    status,
    statusMessage,
    result: computed(() => activeResult.value),
    currentRouteId: computed(() => ownedRouteId.value),
    busy,
    sessionReady,
    canExecute,
    canClear,
    execute,
    clear,
  }
}

export function useTopologyQuickAction(): UseTopologyQuickActionReturn {
  const lifecycle = useTopologySceneLifecycle()
  return createTopologyQuickAction(lifecycle.session)
}
