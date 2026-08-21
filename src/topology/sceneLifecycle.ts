import * as THREE from 'three'
import {
  compileTopologySidecarV1,
  parseTopologySidecarV1,
  type TopologyAssetProof,
  type TopologyJsonObject,
  type TopologyJsonValue,
  type TopologyLoadedAsset,
  type TopologySidecarCompileContext,
  type TopologySidecarCompileResult,
  type TopologySidecarDiagnostic,
} from '@/adapters/topology'
import type { ModelRecord } from '@/composables/useModelLibrary'
import {
  TopologyError,
  type TopologyGraphInput,
  type TopologyGraphSnapshot,
} from '@/ssp/topology/types'

const GLB_MAGIC = 0x46546c67
const GLB_JSON_CHUNK = 0x4e4f534a
const GLB_VERSION = 2
const DEFAULT_ASSET_CONCURRENCY = 3
const SAFE_ERROR_DETAIL_DEPTH = 6
const SAFE_ERROR_DETAIL_NODES = 256
const SAFE_ERROR_CONTAINER_ITEMS = 64
const SAFE_ERROR_STRING_LENGTH = 4096
const SENSITIVE_DIAGNOSTIC_KEY = /(?:api.?key|authorization|cause|cookie|credential|message|password|secret|signature|signed|stack|token)/i

export type TopologySceneSessionStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'unavailable'
  | 'error'

export interface TopologySceneSessionNode {
  id: string
  layerId: string
  label?: string
  kind?: string
  subtype?: string
}

export interface TopologySceneSessionSnapshot {
  status: TopologySceneSessionStatus
  graphId: string | null
  nodes: readonly TopologySceneSessionNode[]
  diagnostic: TopologySidecarDiagnostic | null
}

export interface TopologyFloorInfo {
  floorName: string
  url: string
  root: THREE.Object3D
}

export interface TopologyFetchResponse {
  ok: boolean
  status: number
  redirected: boolean
  url: string
  arrayBuffer(): Promise<ArrayBuffer>
  text(): Promise<string>
}

export interface TopologyCachePort {
  enabled: boolean
  readonly files: Record<string, unknown>
  add(key: string, value: unknown): void
}

export interface TopologySceneLifecyclePorts {
  origin: string
  fetch(
    url: string,
    init: {
      signal: AbortSignal
      credentials: 'same-origin'
      redirect: 'error'
    },
  ): Promise<TopologyFetchResponse>
  digestSha256(bytes: ArrayBuffer): Promise<string>
  cache: TopologyCachePort
  resolveLoaderUrl(url: string): string
  loadFloor(url: string): Promise<TopologyFloorInfo>
  getScene(): THREE.Scene
  compileSidecar(
    jsonText: string,
    context: TopologySidecarCompileContext,
  ): TopologySidecarCompileResult
  createGraph(input: TopologyGraphInput): TopologyGraphSnapshot
  getGraph(id: string): TopologyGraphSnapshot | null
  removeGraph(id: string): boolean
  removeAllRoutes(): number
  removeAllGraphs(): number
  removeAllLegacyTopologies(): number
  unloadAllModels(): void
  assetConcurrency?: number
}

export interface TopologySelectionPlan {
  selection: ModelRecord
  assets: readonly ModelRecord[]
  sidecarUri: string
}

export type TopologyModelSelectionResult =
  | { kind: 'empty'; generation: number }
  | { kind: 'loaded'; generation: number; assetCount: number }
  | { kind: 'model-error'; generation: number; message: string }
  | { kind: 'stale'; generation: number }

interface SelectionTicket {
  generation: number
  controller: AbortController
}

interface SelectionAssets {
  loadedAssets: readonly TopologyLoadedAsset[]
  assetProofs: readonly TopologyAssetProof[]
  visualFailures: readonly TopologySidecarDiagnostic[]
  proofFailures: readonly TopologySidecarDiagnostic[]
}

interface SelectionAssetOutcome {
  loaded: TopologyLoadedAsset | null
  proof: TopologyAssetProof | null
  visualFailure: TopologySidecarDiagnostic | null
  proofFailure: TopologySidecarDiagnostic | null
}

class StaleSelectionError extends Error {
  constructor() {
    super('selection is stale')
    this.name = 'StaleSelectionError'
  }
}

class SelectionFailure extends Error {
  constructor(
    readonly diagnostic: TopologySidecarDiagnostic,
    readonly modelMessage: string,
  ) {
    super(diagnostic.message)
    this.name = 'SelectionFailure'
  }
}

class AssetAuthorizationError extends SelectionFailure {}

class LoaderResolvedUrlMismatchError extends Error {
  constructor(
    readonly expectedCanonicalUri: string,
    readonly resolvedUri: string,
  ) {
    super('model loader URL resolution escaped the authorized asset URI')
    this.name = 'LoaderResolvedUrlMismatchError'
  }
}

function redactedUri(uri: string): string {
  try {
    const value = new URL(uri)
    value.username = ''
    value.password = ''
    value.search = ''
    value.hash = ''
    return value.href
  } catch {
    return ''
  }
}

function diagnostic(
  sidecarUri: string,
  code: TopologySidecarDiagnostic['code'],
  phase: TopologySidecarDiagnostic['phase'],
  message: string,
  options: {
    path?: string
    assetId?: string | null
    entityId?: string | null
    details?: TopologyJsonObject
  } = {},
): TopologySidecarDiagnostic {
  return {
    code,
    phase,
    message,
    path: options.path ?? '',
    sidecarUri: redactedUri(sidecarUri),
    assetId: options.assetId ?? null,
    entityId: options.entityId ?? null,
    details: options.details ?? {},
  }
}

function failSelection(
  sidecarUri: string,
  code: TopologySidecarDiagnostic['code'],
  phase: TopologySidecarDiagnostic['phase'],
  message: string,
  modelMessage: string,
  options: {
    path?: string
    assetId?: string | null
    entityId?: string | null
    details?: TopologyJsonObject
  } = {},
): never {
  throw new SelectionFailure(
    diagnostic(sidecarUri, code, phase, message, options),
    modelMessage,
  )
}

function canonicalOrigin(origin: string): URL {
  const parsed = new URL(origin)
  if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('application origin must be credential-free HTTP(S)')
  }
  return parsed
}

function canonicalManifestAsset(record: ModelRecord, origin: string, sidecarUri: string): string {
  if (record.kind !== 'file') {
    failSelection(
      sidecarUri,
      'SIDECAR_FIELD_INVALID',
      'DISCOVER',
      'only manifest file records can be loaded as topology assets',
      '模型清单包含非法资产记录',
    )
  }
  if (record.url.includes('\\')) {
    failSelection(
      sidecarUri,
      'SIDECAR_FIELD_INVALID',
      'DISCOVER',
      'manifest asset URL cannot contain backslashes',
      '模型资产 URL 非法',
    )
  }
  if (
    !record.url.startsWith('/') &&
    !record.url.startsWith('http://') &&
    !record.url.startsWith('https://')
  ) {
    failSelection(
      sidecarUri,
      'SIDECAR_FIELD_INVALID',
      'DISCOVER',
      'manifest GLB URL must use the exact URL forms supported by modelTool.loadFloor',
      '模型资产 URL 无法安全交接给模型加载器',
      { details: { requirement: 'EXACT_MODEL_TOOL_URL' } },
    )
  }
  const appOrigin = canonicalOrigin(origin)
  let canonical: URL
  try {
    canonical = new URL(record.url, appOrigin)
  } catch {
    failSelection(
      sidecarUri,
      'SIDECAR_FIELD_INVALID',
      'DISCOVER',
      'manifest asset URL cannot be normalized',
      '模型资产 URL 非法',
    )
  }
  if (
    canonical.origin !== appOrigin.origin ||
    canonical.username ||
    canonical.password ||
    canonical.search ||
    canonical.hash ||
    !/\.glb$/i.test(canonical.pathname)
  ) {
    failSelection(
      sidecarUri,
      'SIDECAR_FIELD_INVALID',
      'DISCOVER',
      'manifest asset must be a same-origin GLB URL without credentials, query, or fragment',
      '仅支持当前模型清单授权的同源 GLB',
      { details: { field: 'assetUrl' } },
    )
  }
  return canonical.href
}

function loaderFloorKey(record: ModelRecord): string {
  const filename = record.url.split('/').pop() ?? ''
  return filename.replace(/\.glb$/i, '')
}

export function resolveTopologySelectionPlan(
  selectedUrl: string,
  manifest: readonly ModelRecord[],
  origin: string,
): TopologySelectionPlan {
  const matches = manifest.filter((record) => record.url === selectedUrl)
  if (matches.length !== 1) {
    const placeholderSidecar = new URL('/topology.v1.json', canonicalOrigin(origin)).href
    failSelection(
      placeholderSidecar,
      'SIDECAR_FIELD_INVALID',
      'DISCOVER',
      'selection must match exactly one current manifest record',
      '模型不在当前清单中',
      { details: { manifestMatches: matches.length } },
    )
  }
  const selection = matches[0]!
  const appOrigin = canonicalOrigin(origin)
  let selectionUrl: URL
  try {
    selectionUrl = new URL(selection.url, appOrigin)
  } catch {
    throw new Error('selection URL cannot be normalized')
  }
  if (
    selectionUrl.origin !== appOrigin.origin ||
    selectionUrl.username ||
    selectionUrl.password ||
    selectionUrl.search ||
    selectionUrl.hash
  ) {
    throw new Error('selection URL must be same-origin without credentials, query, or fragment')
  }

  let sidecarUrl: URL
  let assets: ModelRecord[]
  if (selection.kind === 'scene') {
    const directoryPath = selectionUrl.pathname.endsWith('/')
      ? selectionUrl.pathname
      : `${selectionUrl.pathname}/`
    sidecarUrl = new URL(`${directoryPath}topology.v1.json`, appOrigin)
    assets = manifest.filter(
      (record) => record.kind === 'file' && record.subcategory === selection.filename,
    )
    if (assets.length === 0) {
      failSelection(
        sidecarUrl.href,
        'SIDECAR_PARTIAL_SCENE',
        'DISCOVER',
        'scene selection has no authorized GLB records in the current manifest',
        '场景在当前模型清单中没有 GLB 资产',
      )
    }
    for (const asset of assets) {
      const canonical = new URL(canonicalManifestAsset(asset, origin, sidecarUrl.href))
      if (!canonical.pathname.startsWith(directoryPath)) {
        failSelection(
          sidecarUrl.href,
          'SIDECAR_FIELD_INVALID',
          'DISCOVER',
          'scene asset must remain inside the selected manifest scene directory',
          '场景资产目录与当前选择不一致',
        )
      }
    }
  } else {
    if (!/\.glb$/i.test(selectionUrl.pathname)) {
      throw new Error('file selection must be a GLB')
    }
    sidecarUrl = new URL(selectionUrl.href)
    sidecarUrl.pathname = sidecarUrl.pathname.replace(/\.glb$/i, '.topology.v1.json')
    assets = [selection]
    canonicalManifestAsset(selection, origin, sidecarUrl.href)
  }

  const canonicalUris = new Set<string>()
  const floorKeys = new Set<string>()
  for (const asset of assets) {
    const canonicalUri = canonicalManifestAsset(asset, origin, sidecarUrl.href)
    if (canonicalUris.has(canonicalUri)) {
      failSelection(
        sidecarUrl.href,
        'SIDECAR_FIELD_INVALID',
        'DISCOVER',
        'manifest selection contains duplicate canonical asset URLs',
        '模型清单包含重复资产 URL',
      )
    }
    canonicalUris.add(canonicalUri)
    const floorKey = loaderFloorKey(asset)
    if (!floorKey || floorKeys.has(floorKey)) {
      failSelection(
        sidecarUrl.href,
        'SIDECAR_FIELD_INVALID',
        'DISCOVER',
        'manifest selection contains duplicate model loader keys',
        '当前场景包含无法由模型加载器区分的同名 GLB',
      )
    }
    floorKeys.add(floorKey)
  }

  return { selection, assets, sidecarUri: sidecarUrl.href }
}

function glbJson(bytes: ArrayBuffer): Record<string, unknown> {
  if (bytes.byteLength < 20) throw new Error('GLB is too short')
  const view = new DataView(bytes)
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error('GLB magic is invalid')
  if (view.getUint32(4, true) !== GLB_VERSION) throw new Error('GLB version is unsupported')
  if (view.getUint32(8, true) !== bytes.byteLength) throw new Error('GLB length is inconsistent')
  const chunkLength = view.getUint32(12, true)
  const chunkType = view.getUint32(16, true)
  if (chunkType !== GLB_JSON_CHUNK || chunkLength === 0 || 20 + chunkLength > bytes.byteLength) {
    throw new Error('GLB JSON chunk is invalid')
  }
  const jsonBytes = new Uint8Array(bytes, 20, chunkLength)
  const jsonText = new TextDecoder('utf-8', { fatal: true })
    .decode(jsonBytes)
    .replace(/\u0000+$/u, '')
    .trimEnd()
  const parsed = JSON.parse(jsonText) as unknown
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('GLB JSON chunk must be an object')
  }
  return parsed as Record<string, unknown>
}

function assertEmbeddedUris(values: unknown, collection: 'buffers' | 'images'): void {
  if (values === undefined) return
  if (!Array.isArray(values)) throw new Error(`GLB ${collection} must be an array`)
  values.forEach((value, index) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error(`GLB ${collection}[${String(index)}] must be an object`)
    }
    const uri = (value as Record<string, unknown>).uri
    if (uri === undefined) return
    if (typeof uri !== 'string' || !/^data:/i.test(uri)) {
      throw new Error(`GLB ${collection}[${String(index)}] references an external URI`)
    }
  })
}

export function assertSelfContainedGlb(
  bytes: ArrayBuffer,
  sidecarUri: string,
  canonicalAssetUri: string,
): void {
  try {
    const json = glbJson(bytes)
    assertEmbeddedUris(json.buffers, 'buffers')
    assertEmbeddedUris(json.images, 'images')
  } catch {
    failSelection(
      sidecarUri,
      'SIDECAR_ASSET_BINDING_UNVERIFIABLE',
      'BIND',
      'R1 SAME_RESPONSE_BYTES requires a valid self-contained GLB without external buffer or image URIs',
      '当前 R1 加载链路仅支持自包含 GLB',
      { details: { assetUri: redactedUri(canonicalAssetUri), requirement: 'SELF_CONTAINED_GLB' } },
    )
  }
}

export async function computeSha256Hex(
  bytes: ArrayBuffer,
  subtle: SubtleCrypto | undefined = globalThis.crypto?.subtle,
): Promise<string> {
  if (!subtle) throw new Error('WebCrypto SubtleCrypto is unavailable')
  const digestBytes = await subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digestBytes), (value) => value.toString(16).padStart(2, '0')).join('')
}

export function loadFloorWithSynchronousCacheLease<T>(options: {
  url: string
  canonicalUrl: string
  bytes: ArrayBuffer
  cache: TopologyCachePort
  resolveLoaderUrl(url: string): string
  assertCurrent(): void
  loadFloor(url: string): Promise<T>
}): Promise<T> {
  const resolvedKey = assertAuthorizedLoaderResolution(
    options.url,
    options.canonicalUrl,
    options.resolveLoaderUrl,
  )
  options.assertCurrent()
  const files = options.cache.files
  const hadKey = Object.prototype.hasOwnProperty.call(files, resolvedKey)
  const previousValue = files[resolvedKey]
  const previousEnabled = options.cache.enabled
  let loadPromise!: Promise<T>
  try {
    options.cache.enabled = true
    options.cache.add(resolvedKey, options.bytes)
    loadPromise = Promise.resolve(options.loadFloor(options.url))
  } finally {
    if (hadKey) files[resolvedKey] = previousValue
    else delete files[resolvedKey]
    options.cache.enabled = previousEnabled
  }
  return loadPromise
}

function assertAuthorizedLoaderResolution(
  url: string,
  canonicalUrl: string,
  resolveLoaderUrl: (url: string) => string,
): string {
  const resolvedKey = resolveLoaderUrl(url)
  if (typeof resolvedKey !== 'string' || resolvedKey.length === 0) {
    throw new Error('model loader resolved an empty cache key')
  }
  let normalizedResolvedUrl: string
  try {
    normalizedResolvedUrl = new URL(resolvedKey, canonicalUrl).href
  } catch {
    throw new LoaderResolvedUrlMismatchError(canonicalUrl, '')
  }
  if (normalizedResolvedUrl !== canonicalUrl) {
    throw new LoaderResolvedUrlMismatchError(canonicalUrl, normalizedResolvedUrl)
  }
  return resolvedKey
}

function owningScene(root: THREE.Object3D): THREE.Scene | null {
  let current: THREE.Object3D | null = root
  while (current !== null) {
    if ((current as THREE.Scene).isScene === true) return current as THREE.Scene
    current = current.parent
  }
  return null
}

function isVisibleInScene(root: THREE.Object3D, scene: THREE.Scene): boolean {
  return (root as { isObject3D?: boolean }).isObject3D === true && owningScene(root) === scene
}

function safeErrorName(error: unknown): string {
  let name = ''
  try {
    name = error instanceof Error ? error.name : ''
  } catch {
    // Hostile/custom Error subclasses must not break diagnostic fallback.
  }
  return /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(name) ? name : 'UnknownError'
}

function safeDiagnosticString(value: string): string {
  const bounded = value.slice(0, SAFE_ERROR_STRING_LENGTH)
  try {
    const parsed = new URL(bounded)
    if (parsed.protocol === 'file:') return '[redacted-local-path]'
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return redactedUri(parsed.href)
  } catch {
    // Non-URL strings remain valid bounded topology metadata.
  }

  const remoteUrls: string[] = []
  const withoutRemoteUrls = bounded.replace(/https?:\/\/[^\s"'<>]+/gi, (candidate) => {
    const marker = `\u0000safe-url-${String(remoteUrls.length)}\u0000`
    remoteUrls.push(redactedUri(candidate) || '[redacted-uri]')
    return marker
  })
  if (
    /file:\/\//i.test(withoutRemoteUrls) ||
    /(?:^|[^A-Za-z0-9._-])\/(?!\/)[^\s"'<>]+/.test(withoutRemoteUrls) ||
    /[A-Za-z]:[\\/]/.test(withoutRemoteUrls)
  ) {
    return '[redacted-local-path]'
  }
  return withoutRemoteUrls.replace(/\u0000safe-url-(\d+)\u0000/g, (_marker, index: string) => (
    remoteUrls[Number(index)] ?? '[redacted-uri]'
  ))
}

function safeTopologyErrorPath(value: string): string {
  const bounded = value.slice(0, SAFE_ERROR_STRING_LENGTH)
  if (
    /^[A-Za-z][A-Za-z0-9_.\[\]-]*$/.test(bounded) ||
    /^\/(?:assets|blockers|connectors|edges|graph|id|layers|nodes|options|patch|query|route|selector)(?:\/|$)[A-Za-z0-9_./\[\]-]*$/.test(bounded)
  ) {
    return bounded
  }
  return safeDiagnosticString(bounded)
}

function safeJsonValue(
  value: unknown,
  depth = 0,
  budget: { nodes: number } = { nodes: 0 },
  ancestors: ReadonlySet<object> = new Set(),
): TopologyJsonValue | undefined {
  if (budget.nodes >= SAFE_ERROR_DETAIL_NODES || depth > SAFE_ERROR_DETAIL_DEPTH) return undefined
  budget.nodes += 1
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string') return safeDiagnosticString(value)
  if (typeof value !== 'object' || ancestors.has(value)) return undefined

  const nextAncestors = new Set(ancestors)
  nextAncestors.add(value)
  if (Array.isArray(value)) {
    const items: TopologyJsonValue[] = []
    for (const item of value.slice(0, SAFE_ERROR_CONTAINER_ITEMS)) {
      const safe = safeJsonValue(item, depth + 1, budget, nextAncestors)
      if (safe !== undefined) items.push(safe)
    }
    return items
  }

  let prototype: object | null
  let descriptors: Record<string, PropertyDescriptor>
  try {
    prototype = Object.getPrototypeOf(value) as object | null
    if (prototype !== Object.prototype && prototype !== null) return undefined
    descriptors = Object.getOwnPropertyDescriptors(value)
  } catch {
    return undefined
  }
  const output: Record<string, TopologyJsonValue> = {}
  for (const key of Object.keys(descriptors).slice(0, SAFE_ERROR_CONTAINER_ITEMS)) {
    if (
      /^(?:__proto__|prototype|constructor)$/i.test(key) ||
      SENSITIVE_DIAGNOSTIC_KEY.test(key)
    ) continue
    const descriptor = descriptors[key]!
    if (!('value' in descriptor)) continue
    const safe = safeJsonValue(descriptor.value, depth + 1, budget, nextAncestors)
    if (safe !== undefined) output[key.slice(0, SAFE_ERROR_STRING_LENGTH)] = safe
  }
  return output
}

function safeCaughtErrorDetails(error: unknown): TopologyJsonObject {
  const output: Record<string, TopologyJsonValue> = { cause: safeErrorName(error) }
  if (!(error instanceof TopologyError)) return output

  let code: unknown
  let path: unknown
  let details: unknown
  try {
    code = error.code
    path = error.path
    details = error.details
  } catch {
    return output
  }
  if (
    code !== 'INVALID_ARGUMENT' &&
    code !== 'DUPLICATE_ID' &&
    code !== 'BROKEN_REFERENCE' &&
    code !== 'INVALID_GRAPH' &&
    code !== 'LIMIT_EXCEEDED' &&
    code !== 'CONTEXT_UNAVAILABLE' &&
    code !== 'RENDER_FAILED'
  ) return output

  const topologyError: Record<string, TopologyJsonValue> = { code }
  if (typeof path === 'string') topologyError.path = safeTopologyErrorPath(path)
  const safeDetails = safeJsonValue(details)
  if (safeDetails !== undefined && !Array.isArray(safeDetails) && safeDetails !== null) {
    topologyError.details = safeDetails
  }
  output.topologyError = topologyError
  return output
}

function proofFailureFromUnknown(
  sidecarUri: string,
  canonicalAssetUri: string,
  error: unknown,
): TopologySidecarDiagnostic {
  if (error instanceof SelectionFailure) return error.diagnostic
  if (error instanceof LoaderResolvedUrlMismatchError) {
    return diagnostic(
      sidecarUri,
      'SIDECAR_ASSET_BINDING_MISMATCH',
      'BIND',
      'model loader URL resolution does not match the authorized manifest asset',
      {
        details: {
          requirement: 'RESOLVED_URL_MATCH',
          expectedAssetUri: redactedUri(error.expectedCanonicalUri),
          resolvedAssetUri: redactedUri(error.resolvedUri),
        },
      },
    )
  }
  return diagnostic(
    sidecarUri,
    'SIDECAR_ASSET_BINDING_UNVERIFIABLE',
    'BIND',
    'SAME_RESPONSE_BYTES proof could not be completed for the current asset',
    {
      details: {
        assetUri: redactedUri(canonicalAssetUri),
        cause: safeErrorName(error),
      },
    },
  )
}

function visualFailureDiagnostic(
  sidecarUri: string,
  canonicalAssetUri: string,
  selectedAssetCount: number,
  proofFailure: TopologySidecarDiagnostic,
  error: unknown,
): TopologySidecarDiagnostic {
  return diagnostic(
    sidecarUri,
    selectedAssetCount > 1 ? 'SIDECAR_PARTIAL_SCENE' : 'SIDECAR_ASSET_NOT_LOADED',
    'BIND',
    'the selected manifest asset could not be loaded for visual display',
    {
      details: {
        assetUri: redactedUri(canonicalAssetUri),
        proofFailureCode: proofFailure.code,
        loaderCause: safeErrorName(error),
      },
    },
  )
}

function modelFailureFromUnknown(sidecarUri: string, error: unknown): SelectionFailure {
  if (error instanceof SelectionFailure) return error
  return new SelectionFailure(
    diagnostic(
      sidecarUri,
      'SIDECAR_ASSET_BINDING_UNVERIFIABLE',
      'BIND',
      'current manifest asset could not be loaded and strongly bound',
      { details: { cause: safeErrorName(error) } },
    ),
    '模型资产加载或校验失败',
  )
}

function freezeJsonValue(value: TopologyJsonObject[string]): TopologyJsonObject[string] {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => freezeJsonValue(item)))
  }
  if (typeof value === 'object' && value !== null) {
    const clone: Record<string, TopologyJsonObject[string]> = {}
    for (const [key, item] of Object.entries(value)) clone[key] = freezeJsonValue(item)
    return Object.freeze(clone)
  }
  return value
}

function freezeDiagnostic(value: TopologySidecarDiagnostic): TopologySidecarDiagnostic {
  return Object.freeze({
    ...value,
    details: freezeJsonValue(value.details) as TopologyJsonObject,
  })
}

export class TopologySceneLifecycle {
  private generation = 0
  private active: SelectionTicket | null = null
  private state: TopologySceneSessionSnapshot = {
    status: 'idle',
    graphId: null,
    nodes: [],
    diagnostic: null,
  }

  constructor(
    private readonly ports: TopologySceneLifecyclePorts,
    private readonly onStateChange: (state: TopologySceneSessionSnapshot) => void = () => undefined,
  ) {
    this.publish(this.state)
  }

  get snapshot(): TopologySceneSessionSnapshot {
    return this.state
  }

  isGenerationCurrent(generation: number): boolean {
    return this.generation === generation
  }

  invalidate(): number {
    const generation = ++this.generation
    this.active?.controller.abort()
    this.active = null
    this.publish({ status: 'idle', graphId: null, nodes: [], diagnostic: null })
    return generation
  }

  invalidateAndCleanup(): number {
    const generation = ++this.generation
    this.active?.controller.abort()
    this.active = null
    const cleanupErrors = this.cleanupResources()
    if (cleanupErrors.length > 0) {
      this.publish({
        status: 'error',
        graphId: null,
        nodes: [],
        diagnostic: diagnostic(
          new URL('/topology.v1.json', canonicalOrigin(this.ports.origin)).href,
          'SIDECAR_GRAPH_COMMIT_FAILED',
          'LIFECYCLE',
          'one or more model-session resources could not be released',
          { details: { failedStages: cleanupErrors.map((item) => item.stage) } },
        ),
      })
    } else {
      this.publish({ status: 'idle', graphId: null, nodes: [], diagnostic: null })
    }
    return generation
  }

  async select(
    selectedUrl: string,
    manifest: readonly ModelRecord[],
  ): Promise<TopologyModelSelectionResult> {
    const generation = ++this.generation
    this.active?.controller.abort()
    this.active = null
    const cleanupErrors = this.cleanupResources()
    if (cleanupErrors.length > 0) {
      const sidecarUri = new URL('/topology.v1.json', canonicalOrigin(this.ports.origin)).href
      const failure = diagnostic(
        sidecarUri,
        'SIDECAR_GRAPH_COMMIT_FAILED',
        'LIFECYCLE',
        'old model-session resources could not be fully released',
        { details: { failedStages: cleanupErrors.map((item) => item.stage) } },
      )
      this.publish({ status: 'error', graphId: null, nodes: [], diagnostic: failure })
      return { kind: 'model-error', generation, message: '旧模型资源清理失败' }
    }
    if (!selectedUrl) {
      this.publish({ status: 'idle', graphId: null, nodes: [], diagnostic: null })
      return { kind: 'empty', generation }
    }

    const controller = new AbortController()
    const ticket: SelectionTicket = { generation, controller }
    this.active = ticket
    this.publish({ status: 'loading', graphId: null, nodes: [], diagnostic: null })

    let plan: TopologySelectionPlan
    try {
      plan = resolveTopologySelectionPlan(selectedUrl, manifest, this.ports.origin)
    } catch (error) {
      if (!this.ownsGeneration(ticket)) return { kind: 'stale', generation }
      const sidecarUri = new URL('/topology.v1.json', canonicalOrigin(this.ports.origin)).href
      const failure = modelFailureFromUnknown(sidecarUri, error)
      controller.abort()
      this.publish({ status: 'error', graphId: null, nodes: [], diagnostic: failure.diagnostic })
      return { kind: 'model-error', generation, message: failure.modelMessage }
    }

    let assets: SelectionAssets
    try {
      assets = await this.loadSelectionAssets(plan, ticket)
    } catch (error) {
      if (!this.ownsGeneration(ticket)) return { kind: 'stale', generation }
      const failure = modelFailureFromUnknown(plan.sidecarUri, error)
      this.publish({
        status: 'error',
        graphId: null,
        nodes: [],
        diagnostic: failure.diagnostic,
      })
      return { kind: 'model-error', generation, message: failure.modelMessage }
    }

    if (!this.isTicketCurrent(ticket)) return { kind: 'stale', generation }
    const visibleAssetCount = assets.loadedAssets.length
    const modelResult = (): TopologyModelSelectionResult => visibleAssetCount === 0
      ? { kind: 'model-error', generation, message: '模型资产加载失败' }
      : { kind: 'loaded', generation, assetCount: visibleAssetCount }

    const sidecar = await this.loadSidecar(plan.sidecarUri, ticket)
    if (!this.ownsGeneration(ticket)) return { kind: 'stale', generation }
    if (sidecar.kind === 'stale') return { kind: 'stale', generation }
    if (sidecar.kind === 'unavailable') {
      this.publish({ status: 'unavailable', graphId: null, nodes: [], diagnostic: sidecar.diagnostic })
      return modelResult()
    }
    if (sidecar.kind === 'error') {
      this.publish({ status: 'error', graphId: null, nodes: [], diagnostic: sidecar.diagnostic })
      return modelResult()
    }

    if (visibleAssetCount === 0) {
      const parsed = parseTopologySidecarV1(sidecar.text, plan.sidecarUri)
      const noVisualFailure = assets.visualFailures[0] ?? diagnostic(
        plan.sidecarUri,
        'SIDECAR_ASSET_NOT_LOADED',
        'BIND',
        'no selected manifest asset produced a visible THREE.Scene root',
      )
      const failure = !parsed.ok
        ? parsed.diagnostics[0] ?? noVisualFailure
        : noVisualFailure
      this.publish({ status: 'error', graphId: null, nodes: [], diagnostic: failure })
      return modelResult()
    }

    const scene = this.ports.getScene()
    const context: TopologySidecarCompileContext = {
      sidecarUri: plan.sidecarUri,
      scene,
      selectionGeneration: generation,
      isSelectionCurrent: (candidate) => candidate === generation && this.isTicketCurrent(ticket),
      loadedAssets: assets.loadedAssets,
      assetProofs: assets.assetProofs,
    }

    let compiled: TopologySidecarCompileResult
    try {
      compiled = this.ports.compileSidecar(sidecar.text, context)
    } catch (error) {
      compiled = {
        ok: false,
        diagnostics: [diagnostic(
          plan.sidecarUri,
          'SIDECAR_FIELD_INVALID',
          'COMPILE',
          'topology sidecar compiler failed unexpectedly',
          { details: safeCaughtErrorDetails(error) },
        )],
      }
    }
    if (!this.isTicketCurrent(ticket)) return { kind: 'stale', generation }
    if (!compiled.ok) {
      this.publish({ status: 'error', graphId: null, nodes: [], diagnostic: compiled.diagnostics[0] ?? null })
      return modelResult()
    }

    const commit = this.commitGraph(compiled.input, plan.sidecarUri, ticket)
    if (commit.kind === 'stale') return { kind: 'stale', generation }
    if (commit.kind === 'error') {
      this.publish({ status: 'error', graphId: null, nodes: [], diagnostic: commit.diagnostic })
      return modelResult()
    }
    this.publish({
      status: 'ready',
      graphId: commit.snapshot.id,
      nodes: compiled.input.nodes.map((node) => ({
        id: node.id,
        layerId: node.layerId,
        ...(node.label === undefined ? {} : { label: node.label }),
        ...(node.kind === undefined ? {} : { kind: node.kind }),
        ...(node.subtype === undefined ? {} : { subtype: node.subtype }),
      })),
      diagnostic: null,
    })
    return { kind: 'loaded', generation, assetCount: visibleAssetCount }
  }

  private publish(state: TopologySceneSessionSnapshot): void {
    const nodes = Object.freeze(state.nodes.map((node) => Object.freeze({ ...node })))
    this.state = Object.freeze({
      status: state.status,
      graphId: state.graphId,
      nodes,
      diagnostic: state.diagnostic === null
        ? null
        : freezeDiagnostic(state.diagnostic),
    })
    this.onStateChange(this.state)
  }

  private ownsGeneration(ticket: SelectionTicket): boolean {
    return this.generation === ticket.generation
  }

  private isTicketCurrent(ticket: SelectionTicket): boolean {
    return (
      this.ownsGeneration(ticket) &&
      this.active === ticket &&
      !ticket.controller.signal.aborted
    )
  }

  private assertTicketCurrent(ticket: SelectionTicket): void {
    if (!this.isTicketCurrent(ticket)) throw new StaleSelectionError()
  }

  private cleanupResources(): Array<{ stage: string; error: unknown }> {
    const errors: Array<{ stage: string; error: unknown }> = []
    const stages: ReadonlyArray<readonly [string, () => unknown]> = [
      ['removeAllRoutes', () => this.ports.removeAllRoutes()],
      ['removeAllGraphs', () => this.ports.removeAllGraphs()],
      ['removeAllLegacyTopologies', () => this.ports.removeAllLegacyTopologies()],
      ['unloadAllModels', () => this.ports.unloadAllModels()],
    ]
    for (const [stage, run] of stages) {
      try {
        run()
      } catch (error) {
        errors.push({ stage, error })
      }
    }
    return errors
  }

  private async loadSelectionAssets(
    plan: TopologySelectionPlan,
    ticket: SelectionTicket,
  ): Promise<SelectionAssets> {
    const outcomes = new Array<SelectionAssetOutcome>(plan.assets.length)
    const concurrency = Math.min(4, Math.max(2, this.ports.assetConcurrency ?? DEFAULT_ASSET_CONCURRENCY))
    let cursor = 0
    let stale = false

    const worker = async (): Promise<void> => {
      while (true) {
        if (!this.isTicketCurrent(ticket)) {
          stale = true
          return
        }
        const index = cursor++
        if (index >= plan.assets.length) return
        const asset = plan.assets[index]!
        try {
          const result = await this.loadSelectionAsset(
            asset,
            plan.sidecarUri,
            plan.assets.length,
            ticket,
          )
          this.assertTicketCurrent(ticket)
          outcomes[index] = result
        } catch (error) {
          if (!this.isTicketCurrent(ticket) || error instanceof StaleSelectionError) {
            stale = true
            return
          }
          const canonicalUri = canonicalManifestAsset(asset, this.ports.origin, plan.sidecarUri)
          const proofFailure = proofFailureFromUnknown(plan.sidecarUri, canonicalUri, error)
          outcomes[index] = {
            loaded: null,
            proof: null,
            proofFailure,
            visualFailure: visualFailureDiagnostic(
              plan.sidecarUri,
              canonicalUri,
              plan.assets.length,
              proofFailure,
              error,
            ),
          }
        }
      }
    }

    const workers = Array.from(
      { length: Math.min(concurrency, plan.assets.length) },
      () => worker(),
    )
    await Promise.allSettled(workers)
    if (stale) throw new StaleSelectionError()
    this.assertTicketCurrent(ticket)
    if (outcomes.some((asset) => asset === undefined)) {
      throw new Error('asset worker completed without a selection outcome')
    }
    return {
      loadedAssets: outcomes.flatMap((outcome) => outcome.loaded === null ? [] : [outcome.loaded]),
      assetProofs: outcomes.flatMap((outcome) => outcome.proof === null ? [] : [outcome.proof]),
      visualFailures: outcomes.flatMap(
        (outcome) => outcome.visualFailure === null ? [] : [outcome.visualFailure],
      ),
      proofFailures: outcomes.flatMap(
        (outcome) => outcome.proofFailure === null ? [] : [outcome.proofFailure],
      ),
    }
  }

  private async loadSelectionAsset(
    record: ModelRecord,
    sidecarUri: string,
    selectedAssetCount: number,
    ticket: SelectionTicket,
  ): Promise<SelectionAssetOutcome> {
    this.assertTicketCurrent(ticket)
    const canonicalUri = canonicalManifestAsset(record, this.ports.origin, sidecarUri)
    const visualFallback = async (
      proofFailure: TopologySidecarDiagnostic,
    ): Promise<SelectionAssetOutcome> => {
      try {
        assertAuthorizedLoaderResolution(
          record.url,
          canonicalUri,
          this.ports.resolveLoaderUrl,
        )
        this.assertTicketCurrent(ticket)
        const info = await this.ports.loadFloor(record.url)
        this.assertTicketCurrent(ticket)
        if (!isVisibleInScene(info.root, this.ports.getScene())) {
          const rootFailure = diagnostic(
            sidecarUri,
            'SIDECAR_ASSET_NOT_LOADED',
            'BIND',
            'ordinary model loader did not attach a valid root to the current THREE.Scene',
            { details: { requirement: 'SAME_THREE_SCENE' } },
          )
          return {
            loaded: null,
            proof: null,
            proofFailure,
            visualFailure: rootFailure,
          }
        }
        const loaded: TopologyLoadedAsset = {
          canonicalUri,
          root: info.root,
          selectionGeneration: ticket.generation,
        }
        if (info.url !== record.url) {
          return {
            loaded,
            proof: null,
            visualFailure: null,
            proofFailure: diagnostic(
              sidecarUri,
              'SIDECAR_ASSET_BINDING_MISMATCH',
              'BIND',
              'ordinary model loader result does not match the selected manifest asset',
              { details: { field: 'url' } },
            ),
          }
        }
        return {
          loaded,
          proof: null,
          visualFailure: null,
          proofFailure,
        }
      } catch (visualError) {
        if (!this.isTicketCurrent(ticket) || visualError instanceof StaleSelectionError) {
          throw new StaleSelectionError()
        }
        const effectiveProofFailure = visualError instanceof LoaderResolvedUrlMismatchError ||
          visualError instanceof SelectionFailure
          ? proofFailureFromUnknown(sidecarUri, canonicalUri, visualError)
          : proofFailure
        return {
          loaded: null,
          proof: null,
          proofFailure: effectiveProofFailure,
          visualFailure: visualFailureDiagnostic(
            sidecarUri,
            canonicalUri,
            selectedAssetCount,
            effectiveProofFailure,
            visualError,
          ),
        }
      }
    }

    let response: TopologyFetchResponse
    try {
      response = await this.ports.fetch(record.url, {
        signal: ticket.controller.signal,
        credentials: 'same-origin',
        redirect: 'error',
      })
      this.assertTicketCurrent(ticket)
    } catch (error) {
      if (!this.isTicketCurrent(ticket) || error instanceof StaleSelectionError) {
        throw new StaleSelectionError()
      }
      const proofFailure = proofFailureFromUnknown(sidecarUri, canonicalUri, error)
      return visualFallback(proofFailure)
    }

    if (response.redirected) {
      const error = new AssetAuthorizationError(
        diagnostic(
          sidecarUri,
          'SIDECAR_ASSET_BINDING_MISMATCH',
          'BIND',
          'authorized manifest GLB request was redirected',
          { details: { redirected: true } },
        ),
        '模型资产请求发生未授权重定向',
      )
      return {
        loaded: null,
        proof: null,
        proofFailure: error.diagnostic,
        visualFailure: visualFailureDiagnostic(
          sidecarUri,
          canonicalUri,
          selectedAssetCount,
          error.diagnostic,
          error,
        ),
      }
    }
    if (response.url !== '') {
      let responseUri: string
      try {
        responseUri = new URL(response.url, this.ports.origin).href
      } catch {
        responseUri = ''
      }
      if (responseUri !== canonicalUri) {
        const error = new AssetAuthorizationError(
          diagnostic(
            sidecarUri,
            'SIDECAR_ASSET_BINDING_MISMATCH',
            'BIND',
            'authorized manifest GLB response URL does not match the requested asset',
            {
              details: {
                requirement: 'RESPONSE_URL_MATCH',
                expectedAssetUri: redactedUri(canonicalUri),
                responseAssetUri: redactedUri(responseUri),
              },
            },
          ),
          '模型资产响应与当前选择不一致',
        )
        return {
          loaded: null,
          proof: null,
          proofFailure: error.diagnostic,
          visualFailure: visualFailureDiagnostic(
            sidecarUri,
            canonicalUri,
            selectedAssetCount,
            error.diagnostic,
            error,
          ),
        }
      }
    }
    if (!response.ok) {
      const proofFailure = diagnostic(
        sidecarUri,
        'SIDECAR_ASSET_BINDING_UNVERIFIABLE',
        'BIND',
        'authorized manifest GLB response is unavailable for SAME_RESPONSE_BYTES proof',
        { details: { status: response.status } },
      )
      return visualFallback(proofFailure)
    }

    let bytes: ArrayBuffer
    try {
      bytes = await response.arrayBuffer()
      this.assertTicketCurrent(ticket)
    } catch (error) {
      if (!this.isTicketCurrent(ticket) || error instanceof StaleSelectionError) {
        throw new StaleSelectionError()
      }
      const proofFailure = proofFailureFromUnknown(sidecarUri, canonicalUri, error)
      return visualFallback(proofFailure)
    }

    let loadPromise: Promise<TopologyFloorInfo>
    try {
      loadPromise = loadFloorWithSynchronousCacheLease({
        url: record.url,
        canonicalUrl: canonicalUri,
        bytes,
        cache: this.ports.cache,
        resolveLoaderUrl: this.ports.resolveLoaderUrl,
        assertCurrent: () => this.assertTicketCurrent(ticket),
        loadFloor: this.ports.loadFloor,
      })
    } catch (error) {
      const proofFailure = proofFailureFromUnknown(sidecarUri, canonicalUri, error)
      return {
        loaded: null,
        proof: null,
        proofFailure,
        visualFailure: visualFailureDiagnostic(
          sidecarUri,
          canonicalUri,
          selectedAssetCount,
          proofFailure,
          error,
        ),
      }
    }

    const proofPromise = this.proveAssetBytes(bytes, sidecarUri, canonicalUri, ticket)
    const [loadResult, proofResult] = await Promise.allSettled([loadPromise, proofPromise])
    this.assertTicketCurrent(ticket)
    if (loadResult.status === 'rejected') {
      const proofFailure = proofResult.status === 'rejected'
        ? proofFailureFromUnknown(sidecarUri, canonicalUri, proofResult.reason)
        : diagnostic(
            sidecarUri,
            'SIDECAR_ASSET_BINDING_UNVERIFIABLE',
            'BIND',
            'the GLB response bytes could not be parsed into a visible asset root',
            { details: { cause: safeErrorName(loadResult.reason) } },
          )
      return {
        loaded: null,
        proof: null,
        proofFailure,
        visualFailure: visualFailureDiagnostic(
          sidecarUri,
          canonicalUri,
          selectedAssetCount,
          proofFailure,
          loadResult.reason,
        ),
      }
    }

    const info = loadResult.value
    if (!isVisibleInScene(info.root, this.ports.getScene())) {
      const proofFailure = proofResult.status === 'rejected'
        ? proofFailureFromUnknown(sidecarUri, canonicalUri, proofResult.reason)
        : diagnostic(
            sidecarUri,
            'SIDECAR_ASSET_BINDING_UNVERIFIABLE',
            'BIND',
            'model loader did not attach a valid root to the current THREE.Scene',
            { details: { requirement: 'SAME_THREE_SCENE' } },
          )
      return {
        loaded: null,
        proof: null,
        proofFailure,
        visualFailure: visualFailureDiagnostic(
          sidecarUri,
          canonicalUri,
          selectedAssetCount,
          proofFailure,
          new Error('DetachedModelRoot'),
        ),
      }
    }

    const loaded: TopologyLoadedAsset = {
      canonicalUri,
      root: info.root,
      selectionGeneration: ticket.generation,
    }
    if (info.url !== record.url) {
      const error = new AssetAuthorizationError(
        diagnostic(
          sidecarUri,
          'SIDECAR_ASSET_BINDING_MISMATCH',
          'BIND',
          'model loader result does not match the exact authorized manifest URL',
          { details: { field: info.url !== record.url ? 'url' : 'root' } },
        ),
        '模型加载结果与当前选择不一致',
      )
      return {
        loaded,
        proof: null,
        proofFailure: error.diagnostic,
        visualFailure: null,
      }
    }
    if (proofResult.status === 'rejected') {
      return {
        loaded,
        proof: null,
        visualFailure: null,
        proofFailure: proofFailureFromUnknown(sidecarUri, canonicalUri, proofResult.reason),
      }
    }
    return {
      loaded,
      proof: {
        canonicalUri,
        root: info.root,
        selectionGeneration: ticket.generation,
        digest: { algorithm: 'SHA-256', value: proofResult.value },
        provenance: 'SAME_RESPONSE_BYTES',
      },
      visualFailure: null,
      proofFailure: null,
    }
  }

  private async proveAssetBytes(
    bytes: ArrayBuffer,
    sidecarUri: string,
    canonicalUri: string,
    ticket: SelectionTicket,
  ): Promise<string> {
    assertSelfContainedGlb(bytes, sidecarUri, canonicalUri)
    this.assertTicketCurrent(ticket)
    let digestValue: string
    try {
      digestValue = await this.ports.digestSha256(bytes)
    } catch (error) {
      failSelection(
        sidecarUri,
        'SIDECAR_ASSET_BINDING_UNVERIFIABLE',
        'BIND',
        'WebCrypto SHA-256 proof could not be produced',
        '当前环境无法生成可信模型摘要',
        { details: { cause: safeErrorName(error) } },
      )
    }
    this.assertTicketCurrent(ticket)
    if (!/^[0-9a-f]{64}$/.test(digestValue)) {
      failSelection(
        sidecarUri,
        'SIDECAR_ASSET_BINDING_UNVERIFIABLE',
        'BIND',
        'SHA-256 implementation returned a non-canonical digest',
        '模型摘要格式无效',
      )
    }
    return digestValue
  }

  private async loadSidecar(
    sidecarUri: string,
    ticket: SelectionTicket,
  ): Promise<
    | { kind: 'ok'; text: string }
    | { kind: 'unavailable'; diagnostic: TopologySidecarDiagnostic }
    | { kind: 'error'; diagnostic: TopologySidecarDiagnostic }
    | { kind: 'stale' }
  > {
    try {
      this.assertTicketCurrent(ticket)
      const response = await this.ports.fetch(sidecarUri, {
        signal: ticket.controller.signal,
        credentials: 'same-origin',
        redirect: 'error',
      })
      this.assertTicketCurrent(ticket)
      if (response.status === 404 && !response.redirected) {
        return {
          kind: 'unavailable',
          diagnostic: diagnostic(
            sidecarUri,
            'SIDECAR_NOT_FOUND',
            'DISCOVER',
            'current model selection has no topology.v1.json sidecar',
          ),
        }
      }
      if (
        !response.ok ||
        response.redirected ||
        (response.url !== '' && new URL(response.url, this.ports.origin).href !== sidecarUri)
      ) {
        return {
          kind: 'error',
          diagnostic: diagnostic(
            sidecarUri,
            'SIDECAR_FIELD_INVALID',
            'DISCOVER',
            'topology sidecar request failed or redirected',
            { details: { status: response.status, redirected: response.redirected } },
          ),
        }
      }
      const text = await response.text()
      this.assertTicketCurrent(ticket)
      return { kind: 'ok', text }
    } catch (error) {
      if (!this.ownsGeneration(ticket) || error instanceof StaleSelectionError) return { kind: 'stale' }
      return {
        kind: 'error',
        diagnostic: diagnostic(
          sidecarUri,
          'SIDECAR_FIELD_INVALID',
          'DISCOVER',
          'topology sidecar could not be read',
          { details: { cause: safeErrorName(error) } },
        ),
      }
    }
  }

  private commitGraph(
    input: TopologyGraphInput,
    sidecarUri: string,
    ticket: SelectionTicket,
  ):
    | { kind: 'ready'; snapshot: TopologyGraphSnapshot }
    | { kind: 'error'; diagnostic: TopologySidecarDiagnostic }
    | { kind: 'stale' } {
    if (!this.isTicketCurrent(ticket)) return { kind: 'stale' }
    let snapshot: TopologyGraphSnapshot
    try {
      snapshot = this.ports.createGraph(input)
    } catch (error) {
      const compensation = this.compensateGraphs([input.id ?? ''])
      if (!this.ownsGeneration(ticket)) return { kind: 'stale' }
      return {
        kind: 'error',
        diagnostic: diagnostic(
          sidecarUri,
          'SIDECAR_GRAPH_COMMIT_FAILED',
          'COMMIT',
          'topology graph commit failed',
          {
            details: {
              ...safeCaughtErrorDetails(error),
              compensationFailed: compensation.failed,
              compensationFallbackUsed: compensation.fallbackUsed,
            },
          },
        ),
      }
    }

    if (!this.isTicketCurrent(ticket)) {
      this.compensateGraphs([input.id ?? ''])
      return { kind: 'stale' }
    }
    const actualId = typeof snapshot?.id === 'string'
      ? snapshot.id.slice(0, SAFE_ERROR_STRING_LENGTH)
      : null
    const actualSchemaVersion = typeof snapshot?.schemaVersion === 'number' &&
      Number.isFinite(snapshot.schemaVersion)
      ? snapshot.schemaVersion
      : null
    if (actualId !== input.id || actualSchemaVersion !== 2) {
      const compensation = this.compensateGraphs([input.id ?? ''])
      return {
        kind: 'error',
        diagnostic: diagnostic(
          sidecarUri,
          'SIDECAR_GRAPH_COMMIT_FAILED',
          'COMMIT',
          'topology graph snapshot does not match the compiled commit contract',
          {
            details: {
              expectedId: input.id ?? null,
              actualId,
              expectedSchemaVersion: 2,
              actualSchemaVersion,
              compensationFailed: compensation.failed,
              compensationFallbackUsed: compensation.fallbackUsed,
            },
          },
        ),
      }
    }
    return { kind: 'ready', snapshot }
  }

  private compensateGraphs(ids: readonly string[]): { failed: boolean; fallbackUsed: boolean } {
    const uniqueIds = [...new Set(ids.filter((candidate) => candidate.length > 0))]
    let preciseFailed = false
    for (const id of uniqueIds) {
      try {
        // createGraph can throw after mutating its manager. Always issue the
        // precise id-scoped removal, then verify that no committed graph remains.
        this.ports.removeGraph(id)
        if (this.ports.getGraph(id) !== null) preciseFailed = true
      } catch {
        preciseFailed = true
      }
    }
    if (!preciseFailed) return { failed: false, fallbackUsed: false }

    // The exact removal is the primary contract. If its port fails, fail closed
    // while still in the same synchronous commit stack: no newer generation can
    // have reached its own commit yet, so clearing routes/graphs cannot erase a
    // subsequently committed session.
    let fallbackFailed = false
    try {
      this.ports.removeAllRoutes()
    } catch {
      fallbackFailed = true
    }
    try {
      this.ports.removeAllGraphs()
    } catch {
      fallbackFailed = true
    }
    for (const id of uniqueIds) {
      try {
        if (this.ports.getGraph(id) !== null) fallbackFailed = true
      } catch {
        fallbackFailed = true
      }
    }
    return { failed: fallbackFailed, fallbackUsed: true }
  }
}

export function createTopologySceneLifecycle(
  ports: Omit<TopologySceneLifecyclePorts, 'compileSidecar'> & {
    compileSidecar?: TopologySceneLifecyclePorts['compileSidecar']
  },
  onStateChange?: (state: TopologySceneSessionSnapshot) => void,
): TopologySceneLifecycle {
  return new TopologySceneLifecycle(
    { ...ports, compileSidecar: ports.compileSidecar ?? compileTopologySidecarV1 },
    onStateChange,
  )
}
