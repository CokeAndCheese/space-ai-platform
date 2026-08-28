import { readonly, shallowReactive } from 'vue'
import {
  DEFAULT_PACKAGE_ZIP_LIMITS,
  type PackageDiagnostic,
} from '@/adapters/package'
import type { TopologySidecarDiagnostic } from '@/adapters/topology'
import type { ModelRecord } from '@/composables/useModelLibrary'
import type {
  TopologyAbsentPackageSessionSnapshotV2,
  TopologyModelSelectionResult,
  TopologyPackageSessionSnapshot,
  TopologyPackageSessionState,
  TopologySceneSessionStatus,
} from '@/topology'

export const STANDARD_MODEL_PACKAGE_INPUT_ACCEPT = '.zip,application/zip'
export const STANDARD_MODEL_PACKAGE_MAX_BYTES = DEFAULT_PACKAGE_ZIP_LIMITS.maxArchiveBytes

export type HomeSceneSource = 'empty' | 'legacy' | 'package'
export type HomePackageKind = 'v1' | 'v2'
export type HomeScenePhase =
  | 'idle'
  | 'reading'
  | 'processing'
  | 'finalizing'
  | 'ready'
  | 'error'

export interface HomePackageFile {
  readonly name: string
  readonly size: number
  readonly type?: string
  arrayBuffer(): Promise<ArrayBuffer>
}

export interface HomePackageSummary {
  readonly fileName: string
  readonly kind: HomePackageKind
  readonly packageId: string
  readonly revision: string
  readonly floorCount: number
  readonly readiness: 'graph-ready' | 'scene-metadata-ready'
  readonly graphId: string | null
  readonly topologyCapability: Readonly<{
    readonly code: 'TOPOLOGY_UNAVAILABLE'
    readonly reasonCode: 'PACKAGE_DECLARED_ABSENT'
  }> | null
}

export interface HomeSceneSelectionState {
  source: HomeSceneSource
  phase: HomeScenePhase
  loading: boolean
  hasVisibleScene: boolean
  visibleAssetCount: number
  selectionLabel: string
  packageKind: HomePackageKind | null
  errorText: string
  packageSummary: HomePackageSummary | null
}

interface ReadonlyValue<T> {
  readonly value: T
}

export interface HomeSceneLifecyclePort {
  readonly session: {
    readonly status: ReadonlyValue<TopologySceneSessionStatus>
    readonly graphId: ReadonlyValue<string | null>
    readonly diagnostic: ReadonlyValue<TopologySidecarDiagnostic | null>
    readonly packageDiagnostic: ReadonlyValue<PackageDiagnostic | null>
    readonly packageSession: ReadonlyValue<TopologyPackageSessionState | null>
  }
  select(
    selectedUrl: string,
    manifest: readonly ModelRecord[],
  ): Promise<TopologyModelSelectionResult>
  selectPackage(packageBytes: Uint8Array): Promise<TopologyModelSelectionResult>
  selectPackageV2(packageBytes: Uint8Array): Promise<TopologyModelSelectionResult>
  isGenerationCurrent(generation: number): boolean
  invalidateAndCleanup(): number
}

export interface HomeSceneSelectionOptions {
  readonly lifecycle: HomeSceneLifecyclePort
  readonly getManifest: () => readonly ModelRecord[]
  readonly getLegacyLabel: (url: string) => string
  readonly invalidateVisibilityUndo: () => void
  readonly fitScene: () => Promise<void>
  readonly captureMainViewpoint: () => Promise<void>
  readonly maxPackageBytes?: number
}

export interface HomeSceneSelectionController {
  readonly state: Readonly<HomeSceneSelectionState>
  readonly statusText: () => string
  selectLegacy(url: string): Promise<void>
  selectPackageFile(file: HomePackageFile, kind?: HomePackageKind): Promise<void>
  invalidateAndCleanup(dispose?: boolean): void
}

interface DiagnosticLike {
  readonly code: string
  readonly phase: string
  readonly path: string
}

const LOCAL_DIAGNOSTICS = Object.freeze({
  invalidFile: Object.freeze({ code: 'PACKAGE_FIELD_INVALID', phase: 'ARCHIVE', path: '/' }),
  oversizedFile: Object.freeze({ code: 'PACKAGE_LIMIT_EXCEEDED', phase: 'ARCHIVE', path: '/' }),
  readFailure: Object.freeze({ code: 'PACKAGE_RESOURCE_NOT_FOUND', phase: 'ARCHIVE', path: '/' }),
  lifecycleFailure: Object.freeze({ code: 'PACKAGE_FIELD_INVALID', phase: 'LIFECYCLE', path: '/' }),
})

function safeDiagnosticPart(value: string, fallback: string, pattern: RegExp): string {
  return pattern.test(value) ? value : fallback
}

function safeDiagnosticPath(path: string): string {
  if (
    !path.startsWith('/') ||
    path.length > 256 ||
    path.includes('.transport') ||
    /(?:https?:\/\/|[?#])/i.test(path)
  ) {
    return '/'
  }
  return path
}

export function formatHomeSceneDiagnostic(
  headline: string,
  diagnostic: DiagnosticLike,
): string {
  const code = safeDiagnosticPart(
    diagnostic.code,
    'PACKAGE_FIELD_INVALID',
    /^(?:PACKAGE|SIDECAR)_[A-Z0-9_]{1,80}$/,
  )
  const phase = safeDiagnosticPart(diagnostic.phase, 'LIFECYCLE', /^[A-Z][A-Z0-9_]{0,31}$/)
  return `${headline}\n${code} · ${phase} · ${safeDiagnosticPath(diagnostic.path)}`
}

export function isStandardModelPackageFile(file: HomePackageFile): boolean {
  return /\.zip$/i.test(file.name.trim())
}

function v1PackageSummary(
  fileName: string,
  session: TopologyPackageSessionSnapshot,
  graphId: string,
): HomePackageSummary {
  return Object.freeze({
    fileName,
    kind: 'v1',
    packageId: session.packageId,
    revision: session.revision,
    floorCount: session.assets.length,
    readiness: 'graph-ready',
    graphId,
    topologyCapability: null,
  })
}

function isV2PackageSession(
  session: TopologyPackageSessionState | null,
): session is TopologyAbsentPackageSessionSnapshotV2 {
  if (session === null || !('schemaVersion' in session)) return false
  const capability = session.topologyCapability
  return (
    session.schemaVersion === 2 &&
    session.profile === 'TOPOLOGY_ABSENT_TRANSITION' &&
    capability.capability === 'topology' &&
    capability.status === 'UNAVAILABLE' &&
    capability.code === 'TOPOLOGY_UNAVAILABLE' &&
    capability.reasonCode === 'PACKAGE_DECLARED_ABSENT' &&
    capability.packageSchemaVersion === 2
  )
}

function isV1PackageSession(
  session: TopologyPackageSessionState | null,
): session is TopologyPackageSessionSnapshot {
  return session !== null && !('schemaVersion' in session)
}

function v2PackageSummary(
  fileName: string,
  session: TopologyAbsentPackageSessionSnapshotV2,
): HomePackageSummary {
  return Object.freeze({
    fileName,
    kind: 'v2',
    packageId: session.packageId,
    revision: session.revision,
    floorCount: session.assets.length,
    readiness: 'scene-metadata-ready',
    graphId: null,
    topologyCapability: Object.freeze({
      code: session.topologyCapability.code,
      reasonCode: session.topologyCapability.reasonCode,
    }),
  })
}

export function createHomeSceneSelectionController(
  options: HomeSceneSelectionOptions,
): HomeSceneSelectionController {
  const maxPackageBytes = options.maxPackageBytes ?? STANDARD_MODEL_PACKAGE_MAX_BYTES
  const state = shallowReactive<HomeSceneSelectionState>({
    source: 'empty',
    phase: 'idle',
    loading: false,
    hasVisibleScene: false,
    visibleAssetCount: 0,
    selectionLabel: '',
    packageKind: null,
    errorText: '',
    packageSummary: null,
  })

  let requestGeneration = 0
  let disposed = false
  let lifecycleResourcesClean = false
  let finalizerQueue: Promise<void> = Promise.resolve()

  const cleanupLifecycleResources = (): void => {
    if (lifecycleResourcesClean) return
    options.lifecycle.invalidateAndCleanup()
    lifecycleResourcesClean = true
  }

  const resetSelection = (): void => {
    state.source = 'empty'
    state.phase = 'idle'
    state.loading = false
    state.hasVisibleScene = false
    state.visibleAssetCount = 0
    state.selectionLabel = ''
    state.packageKind = null
    state.errorText = ''
    state.packageSummary = null
  }

  const beginSelection = (
    source: Exclude<HomeSceneSource, 'empty'>,
    label: string,
    packageKind: HomePackageKind | null = null,
  ): number => {
    const request = ++requestGeneration
    lifecycleResourcesClean = false
    options.invalidateVisibilityUndo()
    state.source = source
    state.phase = source === 'package' ? 'reading' : 'processing'
    state.loading = true
    state.hasVisibleScene = false
    state.visibleAssetCount = 0
    state.selectionLabel = label
    state.packageKind = packageKind
    state.errorText = ''
    state.packageSummary = null
    return request
  }

  const ownsRequest = (request: number): boolean => !disposed && request === requestGeneration

  const ownsResult = (request: number, result: TopologyModelSelectionResult): boolean => (
    ownsRequest(request) &&
    result.kind !== 'stale' &&
    options.lifecycle.isGenerationCurrent(result.generation)
  )

  const enqueueSceneFinalizer = (
    request: number,
    lifecycleGeneration: number,
  ): Promise<boolean> => {
    let completed = false
    const job = finalizerQueue.then(async () => {
      const isCurrent = () => (
        ownsRequest(request) &&
        options.lifecycle.isGenerationCurrent(lifecycleGeneration)
      )
      if (!isCurrent()) return
      await options.fitScene()
      if (!isCurrent()) return
      await options.captureMainViewpoint()
      completed = isCurrent()
    })
    finalizerQueue = job.then(() => undefined, () => undefined)
    return job.then(() => completed)
  }

  const lifecycleDiagnostic = (): DiagnosticLike => (
    options.lifecycle.session.packageDiagnostic.value ??
    options.lifecycle.session.diagnostic.value ??
    LOCAL_DIAGNOSTICS.lifecycleFailure
  )

  const failPackage = (
    request: number,
    headline: string,
    diagnostic: DiagnosticLike,
    cleanup: boolean,
  ): void => {
    if (!ownsRequest(request)) return
    if (cleanup) {
      try {
        cleanupLifecycleResources()
      } catch {
        // Preserve the safe UI diagnostic even if a defensive cleanup port
        // reports an unexpected failure. The lifecycle owns detailed logging.
      }
    }
    state.phase = 'error'
    state.loading = false
    state.hasVisibleScene = false
    state.visibleAssetCount = 0
    state.errorText = formatHomeSceneDiagnostic(headline, diagnostic)
    state.packageSummary = null
  }

  const selectLegacy = async (url: string): Promise<void> => {
    if (disposed) return
    const label = url ? options.getLegacyLabel(url) : ''
    const request = beginSelection('legacy', label)
    if (!url) state.loading = false
    try {
      const result = await options.lifecycle.select(url, options.getManifest())
      if (!ownsResult(request, result)) return
      if (result.kind === 'stale') return
      if (result.kind === 'empty') {
        resetSelection()
        return
      }
      if (result.kind === 'model-error') {
        state.phase = 'error'
        state.errorText = result.message
        return
      }

      state.hasVisibleScene = result.assetCount > 0
      state.visibleAssetCount = result.assetCount
      state.phase = 'finalizing'
      const finalized = await enqueueSceneFinalizer(request, result.generation)
      if (!ownsRequest(request) || !finalized) return
      state.phase = 'ready'
    } catch (error) {
      if (!ownsRequest(request)) return
      state.phase = 'error'
      state.errorText = error instanceof Error ? error.message : String(error)
    } finally {
      if (ownsRequest(request)) state.loading = false
    }
  }

  const selectPackageFile = async (
    file: HomePackageFile,
    kind: HomePackageKind = 'v1',
  ): Promise<void> => {
    if (disposed) return
    const request = beginSelection('package', file.name, kind)
    try {
      // File reading has no AbortSignal. Invalidate the active lifecycle first,
      // then use the UI request generation to discard a late File read.
      cleanupLifecycleResources()
    } catch {
      failPackage(request, '旧场景资源清理失败', LOCAL_DIAGNOSTICS.lifecycleFailure, false)
      return
    }

    if (!isStandardModelPackageFile(file) || !Number.isSafeInteger(file.size) || file.size < 0) {
      failPackage(request, '请选择 Studio 导出的标准模型包 .zip 文件', LOCAL_DIAGNOSTICS.invalidFile, false)
      return
    }
    if (file.size > maxPackageBytes) {
      failPackage(
        request,
        `ZIP 文件过大（上限 ${Math.floor(maxPackageBytes / 1024 / 1024)} MiB）`,
        LOCAL_DIAGNOSTICS.oversizedFile,
        false,
      )
      return
    }

    let buffer: ArrayBuffer
    try {
      buffer = await file.arrayBuffer()
    } catch {
      failPackage(request, '无法读取所选 ZIP 文件', LOCAL_DIAGNOSTICS.readFailure, false)
      return
    }
    if (!ownsRequest(request)) return
    if (buffer.byteLength > maxPackageBytes) {
      failPackage(
        request,
        `ZIP 文件过大（上限 ${Math.floor(maxPackageBytes / 1024 / 1024)} MiB）`,
        LOCAL_DIAGNOSTICS.oversizedFile,
        false,
      )
      return
    }

    state.phase = 'processing'
    try {
      // This is the exact byte range returned by File.arrayBuffer(). Package
      // parsing, digest verification, Metadata 3.3 validation, cache leases,
      // and the version-specific topology policy remain lifecycle responsibilities.
      // The explicit UI choice is the only dispatcher; a v1 failure never retries v2.
      lifecycleResourcesClean = false
      const packageBytes = new Uint8Array(buffer)
      const result = kind === 'v2'
        ? await options.lifecycle.selectPackageV2(packageBytes)
        : await options.lifecycle.selectPackage(packageBytes)
      if (!ownsResult(request, result)) return
      if (result.kind !== 'loaded') {
        const headline = result.kind === 'model-error'
          ? result.message
          : '标准模型包导入失败'
        failPackage(request, headline, lifecycleDiagnostic(), false)
        return
      }

      const session = options.lifecycle.session.packageSession.value
      const graphId = options.lifecycle.session.graphId.value
      const assetSessionComplete = (
        session !== null &&
        result.assetCount > 0 &&
        session.assets.length === result.assetCount
      )
      const v2Session = isV2PackageSession(session) ? session : null
      const sessionReady = kind === 'v2'
        ? (
            options.lifecycle.session.status.value === 'scene-ready' &&
            v2Session !== null &&
            graphId === null &&
            assetSessionComplete
          )
        : (
            options.lifecycle.session.status.value === 'ready' &&
            isV1PackageSession(session) &&
            graphId !== null &&
            assetSessionComplete
          )
      if (!sessionReady) {
        failPackage(
          request,
          kind === 'v2'
            ? 'Standard Model Package v2 未形成完整 Scene/Metadata 会话'
            : '标准模型包 v1 未形成完整可用会话',
          LOCAL_DIAGNOSTICS.lifecycleFailure,
          true,
        )
        return
      }

      state.hasVisibleScene = true
      state.visibleAssetCount = result.assetCount
      state.phase = 'finalizing'
      const finalized = await enqueueSceneFinalizer(request, result.generation)
      if (!ownsRequest(request) || !finalized) return
      state.packageSummary = kind === 'v2'
        ? v2PackageSummary(file.name, v2Session as TopologyAbsentPackageSessionSnapshotV2)
        : v1PackageSummary(file.name, session as TopologyPackageSessionSnapshot, graphId as string)
      state.phase = 'ready'
    } catch {
      if (!ownsRequest(request)) return
      failPackage(
        request,
        '标准模型包加载后的场景初始化失败',
        LOCAL_DIAGNOSTICS.lifecycleFailure,
        true,
      )
    } finally {
      if (ownsRequest(request)) state.loading = false
    }
  }

  const invalidateAndCleanup = (dispose = false): void => {
    if (disposed) return
    requestGeneration++
    if (dispose) disposed = true
    options.invalidateVisibilityUndo()
    cleanupLifecycleResources()
    resetSelection()
  }

  const statusText = (): string => {
    if (state.phase === 'reading') return '正在读取 ZIP 原始字节…'
    if (state.phase === 'processing' && state.source === 'package') {
      return state.packageKind === 'v2'
        ? '正在解析 v2 ZIP、校验摘要与 Metadata，并逐楼层加载…'
        : '正在解析 v1 ZIP、校验摘要与 Metadata，并逐楼层加载…'
    }
    if (state.phase === 'processing') return '正在加载清单模型…'
    if (state.phase === 'finalizing') {
      return state.packageKind === 'v2'
        ? 'Scene/Metadata 已就绪，正在调整主视角…'
        : 'Topology 图已就绪，正在调整主视角…'
    }
    if (state.phase === 'ready' && state.source === 'package') {
      return state.packageKind === 'v2'
        ? 'Scene/Metadata ready / Topology 未提供'
        : 'Topology 图就绪'
    }
    if (state.phase === 'ready') return '模型已加载'
    if (state.phase === 'error') return '加载失败'
    return '等待选择模型'
  }

  return {
    state: readonly(state) as Readonly<HomeSceneSelectionState>,
    statusText,
    selectLegacy,
    selectPackageFile,
    invalidateAndCleanup,
  }
}
