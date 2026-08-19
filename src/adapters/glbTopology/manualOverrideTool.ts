import { validateEmbeddedTopology } from './validation'
import type { GlbTopologyDocument } from './types'
import {
  applyTopologyOverrideDocument,
  applyTopologyOverrideDocumentWithSummary,
  createEmptyTopologyOverrideV2Document,
  replaceTopologyOverrideOperations,
} from './override.js'
import type {
  TopologyOverrideV2Document as SharedTopologyOverrideV2Document,
  TopologyOverrideV2Operation as SharedTopologyOverrideOperation,
} from './override.js'
import type {
  TopologyGraphEdgeInput,
  TopologyGraphInput,
  TopologyGraphNodeInput,
  TopologyPolylineInput,
} from '../../ssp/topology/types'

const V2 = 2 as const
const COORDINATE_SPACE = 'MODEL_LOCAL' as const
const MAX_VIA_POINTS = 64
export const TOPOLOGY_OVERRIDE_MAX_OPERATIONS = 128

type RecordValue = Record<string, unknown>

export interface TopologyOverrideTarget {
  assetId: string
  graphId: string
}

export interface TopologyOverrideTargetSelector {
  assetId?: string
  graphId?: string
}

export interface TopologyOverrideChangeEvent {
  type: 'replace' | 'mutate'
  target: TopologyOverrideTarget
  action?: TopologyOverrideAction
  document: ManualTopologyOverrideV2Document
  effectiveTopology: GlbTopologyDocument
  summary: TopologyOverrideSummary
}

export type TopologyOverrideChangeListener = (event: TopologyOverrideChangeEvent) => void

export interface RegisterTopologyAssetOptions {
  onChange?: TopologyOverrideChangeListener
}

export interface RegisterTopologyAssetResult {
  assetId: string
  targets: readonly TopologyOverrideTarget[]
}

export interface ManualTopologyOverrideV2Target {
  graphId: string
  sourceAsset?: string
}

export type ManualTopologyOverrideV2Document = SharedTopologyOverrideV2Document

interface PendingTopologyOverrideV2Document {
  overrideSchemaVersion: typeof V2
  coordinateSpace: typeof COORDINATE_SPACE
  target: ManualTopologyOverrideV2Target
  operations: readonly TopologyOverrideOperation[]
}

export interface TopologyOverrideNode extends TopologyGraphNodeInput {}

export interface TopologyOverrideEdge extends Omit<TopologyGraphEdgeInput, 'path'> {
  path?: TopologyPolylineInput
}

export type TopologyOverrideAction =
  | 'ADD_NODE'
  | 'REMOVE_NODE'
  | 'RESTORE_NODE'
  | 'ADD_EDGE'
  | 'REMOVE_EDGE'
  | 'RESTORE_EDGE'
  | 'OVERRIDE_EDGE_PATH'
  | 'RESET_EDGE_PATH'

export interface TopologyOverrideOperation {
  seq: number
  type: TopologyOverrideAction
  node?: TopologyOverrideNode
  nodeId?: string
  edge?: TopologyOverrideEdge
  edgeId?: string
  expect?: { layerId?: string; source?: string; target?: string }
  path?: TopologyPolylineInput
}

export type TopologyOverrideMutation =
  | { action: 'ADD_NODE'; target?: TopologyOverrideTargetSelector; node: TopologyOverrideNode }
  | { action: 'REMOVE_NODE' | 'RESTORE_NODE'; target?: TopologyOverrideTargetSelector; nodeId: string }
  | { action: 'ADD_EDGE'; target?: TopologyOverrideTargetSelector; edge: TopologyOverrideEdge }
  | { action: 'REMOVE_EDGE' | 'RESTORE_EDGE'; target?: TopologyOverrideTargetSelector; edgeId: string }
  | { action: 'OVERRIDE_EDGE_PATH'; target?: TopologyOverrideTargetSelector; edgeId: string; path: TopologyPolylineInput }
  | { action: 'RESET_EDGE_PATH'; target?: TopologyOverrideTargetSelector; edgeId: string }

export interface TopologyOverrideSummary {
  graphId: string
  sourceAsset: string | null
  count: number
  addedNodeIds: readonly string[]
  addedEdgeIds: readonly string[]
  removedNodeIds: readonly string[]
  removedEdgeIds: readonly string[]
  restoredNodeIds: readonly string[]
  restoredEdgeIds: readonly string[]
  pathOverriddenEdgeIds: readonly string[]
}

export type TopologyOverrideQuery =
  | { operation: 'listTargets' }
  | { operation: 'getDocument'; target?: TopologyOverrideTargetSelector }
  | { operation: 'getEffectiveGraph' | 'getEffectiveTopology'; target?: TopologyOverrideTargetSelector }

interface AssetRecord {
  target: TopologyOverrideTarget
  documentTarget: ManualTopologyOverrideV2Target
  baseline: GlbTopologyDocument
  document: ManualTopologyOverrideV2Document
  onChange?: TopologyOverrideChangeListener
}

interface Subscriber {
  target?: TopologyOverrideTargetSelector
  listener: TopologyOverrideChangeListener
}

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => clone(item)) as T
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) as T
  }
  return value
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`[glbTopologyOverrideTool] ${label} must be non-empty`)
  return value
}

function targetKey(target: TopologyOverrideTarget): string {
  return `${target.assetId}\u0000${target.graphId}`
}

function selectorMatches(target: TopologyOverrideTarget, selector?: TopologyOverrideTargetSelector): boolean {
  return (!selector?.assetId || selector.assetId === target.assetId)
    && (!selector?.graphId || selector.graphId === target.graphId)
}

function graphOf(topology: GlbTopologyDocument, graphId: string): TopologyGraphInput {
  const graph = topology.graphs.find((candidate) => candidate.id === graphId)
  if (!graph) throw new Error(`[glbTopologyOverrideTool] graph not found: ${graphId}`)
  return graph
}

function graphSourceAsset(topology: GlbTopologyDocument, graph: TopologyGraphInput): string | undefined {
  const candidates = [
    graph.data?.sourceAsset,
    topology.diagnostics?.source?.asset,
    (topology as unknown as RecordValue).sourceAsset,
  ]
  return candidates.find((value): value is string => typeof value === 'string' && value.length > 0)
}

function operationType(value: unknown): TopologyOverrideAction {
  if (!isRecord(value)) throw new Error('[glbTopologyOverrideTool] operation must be an object')
  const type = value.type
  const supported: readonly TopologyOverrideAction[] = [
    'ADD_NODE', 'REMOVE_NODE', 'RESTORE_NODE', 'ADD_EDGE', 'REMOVE_EDGE', 'RESTORE_EDGE',
    'OVERRIDE_EDGE_PATH', 'RESET_EDGE_PATH',
  ]
  if (typeof type !== 'string' || !supported.includes(type as TopologyOverrideAction)) {
    throw new Error(`[glbTopologyOverrideTool] unsupported operation: ${String(type)}`)
  }
  return type as TopologyOverrideAction
}

function validatePathShape(path: unknown, label: string): asserts path is TopologyPolylineInput {
  if (!isRecord(path) || path.type !== 'POLYLINE' || !Array.isArray(path.via) || path.via.length > MAX_VIA_POINTS) {
    throw new Error(`[glbTopologyOverrideTool] ${label} must be a POLYLINE with at most ${MAX_VIA_POINTS} via points`)
  }
  for (const [index, point] of path.via.entries()) {
    if (!isRecord(point) || !['x', 'y', 'z'].every((axis) => typeof point[axis] === 'number' && Number.isFinite(point[axis]))) {
      throw new Error(`[glbTopologyOverrideTool] ${label}.via[${index}] must contain finite x/y/z`)
    }
  }
}

function normalizeV2Operations(value: readonly unknown[]): TopologyOverrideOperation[] {
  if (value.length > TOPOLOGY_OVERRIDE_MAX_OPERATIONS) {
    throw new Error(
      `[glbTopologyOverrideTool] operations exceed the ${TOPOLOGY_OVERRIDE_MAX_OPERATIONS} operation limit`,
    )
  }
  const operations = value.map((operation, index) => {
    if (!isRecord(operation)) throw new Error(`[glbTopologyOverrideTool] operations[${index}] must be an object`)
    if (!Number.isInteger(operation.seq) || (operation.seq as number) < 1) {
      throw new Error(`[glbTopologyOverrideTool] operations[${index}].seq must be a positive integer`)
    }
    const type = operationType(operation)
    return { ...clone(operation), type } as TopologyOverrideOperation
  }).sort((left, right) => left.seq - right.seq)
  operations.forEach((operation, index) => {
    if (operation.seq !== index + 1) throw new Error('[glbTopologyOverrideTool] operation seq must be continuous from 1')
  })
  return operations
}

function canonicalTarget(
  document: unknown,
  target: TopologyOverrideTarget,
  baseline: GlbTopologyDocument,
): ManualTopologyOverrideV2Target {
  if (!isRecord(document) || !isRecord(document.target)) {
    throw new Error('[glbTopologyOverrideTool] override document target is required')
  }
  if (document.target.graphId !== target.graphId) {
    throw new Error(`[glbTopologyOverrideTool] document graphId must be ${target.graphId}`)
  }
  const expectedSourceAsset = graphSourceAsset(baseline, graphOf(baseline, target.graphId))
  if (document.target.sourceAsset !== undefined && document.target.sourceAsset !== expectedSourceAsset) {
    throw new Error(`[glbTopologyOverrideTool] document sourceAsset must match the baseline GLB source`)
  }
  return { graphId: target.graphId, ...(expectedSourceAsset ? { sourceAsset: expectedSourceAsset } : {}) }
}

function normalizeDocument(
  value: unknown,
  target: TopologyOverrideTarget,
  baseline: GlbTopologyDocument,
): PendingTopologyOverrideV2Document {
  if (!isRecord(value)) throw new Error('[glbTopologyOverrideTool] override document must be an object')
  const graph = graphOf(baseline, target.graphId)
  if (value.overrideSchemaVersion === 1) {
    if (value.coordinateSpace !== COORDINATE_SPACE || !Array.isArray(value.edgeOverrides)) {
      throw new Error('[glbTopologyOverrideTool] invalid V1 override document')
    }
    if (isRecord(value.target) && value.target.graphId !== target.graphId) {
      throw new Error(`[glbTopologyOverrideTool] V1 document graphId must be ${target.graphId}`)
    }
    if (value.edgeOverrides.length > TOPOLOGY_OVERRIDE_MAX_OPERATIONS) {
      throw new Error(
        `[glbTopologyOverrideTool] edgeOverrides exceed the ${TOPOLOGY_OVERRIDE_MAX_OPERATIONS} operation limit`,
      )
    }
    const edges = new Map(graph.edges.map((edge) => [edge.id, edge]))
    const operations = value.edgeOverrides.map((entry, index) => {
      if (!isRecord(entry)) throw new Error(`[glbTopologyOverrideTool] edgeOverrides[${index}] must be an object`)
      const edgeId = requiredString(entry.edgeId, `edgeOverrides[${index}].edgeId`)
      const edge = edges.get(edgeId)
      if (!edge) throw new Error(`[glbTopologyOverrideTool] V1 edge not found: ${edgeId}`)
      validatePathShape(entry.path, `edgeOverrides[${index}].path`)
      return {
        seq: index + 1,
        type: 'OVERRIDE_EDGE_PATH' as const,
        edgeId,
        expect: { source: edge.source, target: edge.target },
        path: clone(entry.path),
      }
    })
    return { overrideSchemaVersion: V2, coordinateSpace: COORDINATE_SPACE, target: canonicalTarget(value, target, baseline), operations }
  }
  if (value.overrideSchemaVersion !== V2 || value.coordinateSpace !== COORDINATE_SPACE || !Array.isArray(value.operations)) {
    throw new Error('[glbTopologyOverrideTool] invalid V2 override document')
  }
  return {
    overrideSchemaVersion: V2,
    coordinateSpace: COORDINATE_SPACE,
    target: canonicalTarget(value, target, baseline),
    operations: normalizeV2Operations(value.operations),
  }
}

function effectiveGraphFor(
  baseline: GlbTopologyDocument,
  document: SharedTopologyOverrideV2Document,
  graphId: string,
): TopologyGraphInput {
  const effective = applyTopologyOverrideDocument(baseline, document)
  return clone(graphOf(effective, graphId))
}

function deriveOperations(
  baseline: GlbTopologyDocument,
  target: TopologyOverrideTarget,
  documentTarget: ManualTopologyOverrideV2Target,
  document: PendingTopologyOverrideV2Document,
): SharedTopologyOverrideOperation[] {
  const baselineGraph = graphOf(baseline, target.graphId)
  const baselineNodes = new Map(baselineGraph.nodes.map((node) => [node.id, clone(node)]))
  const baselineEdges = new Map(baselineGraph.edges.map((edge) => [edge.id, clone(edge)]))
  const normalized: SharedTopologyOverrideOperation[] = []
  let nextSeq = 1
  for (const operation of document.operations) {
    const type = operationType(operation)
    const prefix = createEmptyTopologyOverrideV2Document(target.graphId, documentTarget.sourceAsset)
    const prior = replaceTopologyOverrideOperations(prefix, normalized)
    const current = effectiveGraphFor(baseline, prior, target.graphId)
    const nodeId = operation.nodeId!
    const edgeId = operation.edgeId!
    const currentNode = current.nodes.find((node) => node.id === nodeId)
    const currentEdge = current.edges.find((edge) => edge.id === edgeId)
    const baselineNode = baselineNodes.get(nodeId)
    const baselineEdge = baselineEdges.get(edgeId)
    if (type === 'RESET_EDGE_PATH') {
      if (!currentEdge) throw new Error(`[glbTopologyOverrideTool] RESET_EDGE_PATH edge is not active: ${edgeId}`)
      // RESET is a service-level action. The shared V2 helper intentionally
      // has no RESET operation: removing the edge's path overrides lets the
      // original ADD_EDGE payload (for a manual edge) or baseline edge shape
      // take effect naturally, without ever ADDing a baseline ID.
      const retained = normalized.filter((candidate) => (
        candidate.type !== 'OVERRIDE_EDGE_PATH' || candidate.edgeId !== edgeId
      )).map((candidate, index) => ({ ...candidate, seq: index + 1 }))
      normalized.splice(0, normalized.length, ...retained)
      nextSeq = normalized.length + 1
      continue
    }
    if (type === 'ADD_NODE') normalized.push({ seq: nextSeq++, type, node: clone(operation.node!) })
    else if (type === 'ADD_EDGE') normalized.push({ seq: nextSeq++, type, edge: clone(operation.edge!) })
    else if (type === 'REMOVE_NODE' || type === 'RESTORE_NODE') {
      const node = type === 'RESTORE_NODE' ? baselineNode : currentNode
      if (!node) throw new Error(`[glbTopologyOverrideTool] ${type} node is not available: ${nodeId}`)
      normalized.push({ seq: nextSeq++, type, nodeId, expect: { layerId: node.layerId } })
    } else {
      const edge = type === 'RESTORE_EDGE' ? baselineEdge : currentEdge
      if (!edge) throw new Error(`[glbTopologyOverrideTool] ${type} edge is not available: ${edgeId}`)
      const expect = { source: edge.source, target: edge.target }
      if (type === 'OVERRIDE_EDGE_PATH') {
        validatePathShape(operation.path!, `operations[seq=${operation.seq}].path`)
        normalized.push({ seq: nextSeq++, type, edgeId, expect, path: clone(operation.path!) })
      } else normalized.push({ seq: nextSeq++, type, edgeId, expect })
    }
  }
  return normalized
}

function applyOperations(
  baseline: GlbTopologyDocument,
  target: TopologyOverrideTarget,
  documentTarget: ManualTopologyOverrideV2Target,
  document: PendingTopologyOverrideV2Document | SharedTopologyOverrideV2Document,
): { document: ManualTopologyOverrideV2Document; topology: GlbTopologyDocument; summary: TopologyOverrideSummary } {
  const pending = document as unknown as PendingTopologyOverrideV2Document
  const normalizedOperations = deriveOperations(baseline, target, documentTarget, pending)
  return applyCanonicalOperations(baseline, target, documentTarget, normalizedOperations)
}

function applyCanonicalOperations(
  baseline: GlbTopologyDocument,
  target: TopologyOverrideTarget,
  documentTarget: ManualTopologyOverrideV2Target,
  normalizedOperations: readonly SharedTopologyOverrideOperation[],
): { document: ManualTopologyOverrideV2Document; topology: GlbTopologyDocument; summary: TopologyOverrideSummary } {
  if (normalizedOperations.length > TOPOLOGY_OVERRIDE_MAX_OPERATIONS) {
    throw new Error(
      `[glbTopologyOverrideTool] operations exceed the ${TOPOLOGY_OVERRIDE_MAX_OPERATIONS} operation limit`,
    )
  }
  const empty = createEmptyTopologyOverrideV2Document(target.graphId, documentTarget.sourceAsset)
  const normalizedShared = replaceTopologyOverrideOperations(empty, normalizedOperations)
  const applied = applyTopologyOverrideDocumentWithSummary(baseline, normalizedShared)
  const topology = validateEmbeddedTopology(applied.topology)
  const helperSummary = applied.summary as Readonly<Record<string, unknown>>
  const summary = {
    ...clone(helperSummary),
    sourceAsset: documentTarget.sourceAsset ?? null,
  } as TopologyOverrideSummary
  const canonicalDocument: ManualTopologyOverrideV2Document = {
    overrideSchemaVersion: V2,
    coordinateSpace: COORDINATE_SPACE,
    target: clone(documentTarget),
    operations: clone(normalizedShared.operations),
  }
  return {
    document: canonicalDocument,
    topology: clone(topology),
    summary: clone(summary),
  }
}

function mutationOperations(
  record: AssetRecord,
  request: TopologyOverrideMutation,
): SharedTopologyOverrideOperation[] {
  const currentOperations = record.document.operations
  const currentGraph = effectiveGraphFor(record.baseline, record.document, record.target.graphId)
  if (request.action === 'RESET_EDGE_PATH') {
    if (!currentGraph.edges.some((edge) => edge.id === request.edgeId)) {
      throw new Error(`[glbTopologyOverrideTool] RESET_EDGE_PATH edge is not active: ${request.edgeId}`)
    }
    return currentOperations
      .filter((operation) => (
        operation.type !== 'OVERRIDE_EDGE_PATH' || operation.edgeId !== request.edgeId
      ))
      .map((operation, index) => ({ ...clone(operation), seq: index + 1 }))
  }
  if (currentOperations.length >= TOPOLOGY_OVERRIDE_MAX_OPERATIONS) {
    throw new Error(
      `[glbTopologyOverrideTool] operations reached the ${TOPOLOGY_OVERRIDE_MAX_OPERATIONS} operation limit`,
    )
  }

  const baselineGraph = graphOf(record.baseline, record.target.graphId)
  const baselineNode = 'nodeId' in request
    ? baselineGraph.nodes.find((node) => node.id === request.nodeId)
    : undefined
  const baselineEdge = 'edgeId' in request
    ? baselineGraph.edges.find((edge) => edge.id === request.edgeId)
    : undefined
  const currentNode = 'nodeId' in request
    ? currentGraph.nodes.find((node) => node.id === request.nodeId)
    : undefined
  const currentEdge = 'edgeId' in request
    ? currentGraph.edges.find((edge) => edge.id === request.edgeId)
    : undefined
  const seq = currentOperations.length + 1
  let operation: SharedTopologyOverrideOperation
  if (request.action === 'ADD_NODE') {
    operation = { seq, type: 'ADD_NODE', node: clone(request.node) }
  } else if (request.action === 'REMOVE_NODE') {
    if (!currentNode) throw new Error(`[glbTopologyOverrideTool] REMOVE_NODE node is not active: ${request.nodeId}`)
    operation = { seq, type: 'REMOVE_NODE', nodeId: request.nodeId, expect: { layerId: currentNode.layerId } }
  } else if (request.action === 'RESTORE_NODE') {
    if (!baselineNode) throw new Error(`[glbTopologyOverrideTool] RESTORE_NODE baseline node not found: ${request.nodeId}`)
    operation = { seq, type: 'RESTORE_NODE', nodeId: request.nodeId, expect: { layerId: baselineNode.layerId } }
  } else if (request.action === 'ADD_EDGE') {
    operation = { seq, type: 'ADD_EDGE', edge: clone(request.edge) }
  } else if (request.action === 'REMOVE_EDGE') {
    if (!currentEdge) throw new Error(`[glbTopologyOverrideTool] REMOVE_EDGE edge is not active: ${request.edgeId}`)
    operation = {
      seq,
      type: 'REMOVE_EDGE',
      edgeId: request.edgeId,
      expect: { source: currentEdge.source, target: currentEdge.target },
    }
  } else if (request.action === 'RESTORE_EDGE') {
    if (!baselineEdge) throw new Error(`[glbTopologyOverrideTool] RESTORE_EDGE baseline edge not found: ${request.edgeId}`)
    operation = {
      seq,
      type: 'RESTORE_EDGE',
      edgeId: request.edgeId,
      expect: { source: baselineEdge.source, target: baselineEdge.target },
    }
  } else if (request.action === 'OVERRIDE_EDGE_PATH') {
    if (!currentEdge) throw new Error(`[glbTopologyOverrideTool] OVERRIDE_EDGE_PATH edge is not active: ${request.edgeId}`)
    validatePathShape(request.path, 'mutation.path')
    operation = {
      seq,
      type: 'OVERRIDE_EDGE_PATH',
      edgeId: request.edgeId,
      expect: { source: currentEdge.source, target: currentEdge.target },
      path: clone(request.path),
    }
  } else {
    throw new Error(`[glbTopologyOverrideTool] unsupported mutation: ${request.action}`)
  }
  return [...currentOperations.map(clone), operation]
}

class ManualTopologyOverrideTool {
  private readonly records = new Map<string, AssetRecord>()
  private readonly subscribers = new Set<Subscriber>()
  private readonly committingTargets = new Set<string>()

  registerAsset(assetIdOrOptions: string | { assetId: string; topology: unknown; onChange?: TopologyOverrideChangeListener }, topology?: unknown, options: RegisterTopologyAssetOptions = {}): RegisterTopologyAssetResult {
    const input = typeof assetIdOrOptions === 'string'
      ? { assetId: assetIdOrOptions, topology, onChange: options.onChange }
      : assetIdOrOptions
    const assetId = requiredString(input.assetId, 'assetId')
    const baseline = clone(validateEmbeddedTopology(input.topology))
    const existing = [...this.records.values()].filter((record) => record.target.assetId === assetId)
    if (existing.length > 0) throw new Error(`[glbTopologyOverrideTool] asset already registered: ${assetId}`)
    const targets = baseline.graphs.map((graph) => {
      const graphId = requiredString(graph.id, 'graph.id')
      const target = { assetId, graphId }
      const sourceAsset = graphSourceAsset(baseline, graph)
      const sharedDocument = createEmptyTopologyOverrideV2Document(graphId, sourceAsset)
      const document: ManualTopologyOverrideV2Document = {
        overrideSchemaVersion: V2,
        coordinateSpace: COORDINATE_SPACE,
        target: clone(sharedDocument.target),
        operations: [],
      }
      this.records.set(targetKey(target), {
        target,
        documentTarget: clone(document.target),
        baseline: clone(baseline),
        document,
        onChange: input.onChange,
      })
      return target
    })
    return { assetId, targets: clone(targets) }
  }

  unregisterAsset(assetId: string): boolean {
    const keys = [...this.records.entries()].filter(([, record]) => record.target.assetId === assetId).map(([key]) => key)
    keys.forEach((key) => this.records.delete(key))
    return keys.length > 0
  }

  clear(): number {
    const count = this.records.size
    this.records.clear()
    return count
  }

  listTargets(): readonly (TopologyOverrideTarget & { operationCount: number })[] {
    return clone([...this.records.values()]
      .sort((left, right) => targetKey(left.target).localeCompare(targetKey(right.target)))
      .map((record) => ({ ...record.target, operationCount: record.document.operations.length })))
  }

  getDocument(selector?: TopologyOverrideTargetSelector): ManualTopologyOverrideV2Document {
    return clone(this.resolve(selector).document)
  }

  getEffectiveTopology(selector?: TopologyOverrideTargetSelector): GlbTopologyDocument {
    const record = this.resolve(selector)
    return clone(applyCanonicalOperations(
      record.baseline,
      record.target,
      record.documentTarget,
      record.document.operations,
    ).topology)
  }

  getEffectiveGraph(selector?: TopologyOverrideTargetSelector): TopologyGraphInput {
    const record = this.resolve(selector)
    const topology = applyCanonicalOperations(
      record.baseline,
      record.target,
      record.documentTarget,
      record.document.operations,
    ).topology
    return clone(graphOf(topology, record.target.graphId))
  }

  getSummary(selector?: TopologyOverrideTargetSelector): TopologyOverrideSummary {
    const record = this.resolve(selector)
    return clone(applyCanonicalOperations(
      record.baseline,
      record.target,
      record.documentTarget,
      record.document.operations,
    ).summary)
  }

  replaceDocument(selector: TopologyOverrideTargetSelector | undefined, value: unknown): ManualTopologyOverrideV2Document {
    const record = this.resolve(selector)
    const normalized = normalizeDocument(value, record.target, record.baseline)
    const candidate = applyOperations(record.baseline, record.target, record.documentTarget, normalized)
    this.commit(record, 'replace', candidate)
    return clone(candidate.document)
  }

  mutate(request: TopologyOverrideMutation): { target: TopologyOverrideTarget; document: ManualTopologyOverrideV2Document; effectiveTopology: GlbTopologyDocument; summary: TopologyOverrideSummary } {
    const record = this.resolve(request.target)
    const operations = mutationOperations(record, request)
    const candidate = applyCanonicalOperations(record.baseline, record.target, record.documentTarget, operations)
    this.commit(record, 'mutate', candidate, request.action)
    return clone({ target: record.target, document: candidate.document, effectiveTopology: candidate.topology, summary: candidate.summary })
  }

  query(request: TopologyOverrideQuery): unknown {
    if (request.operation === 'listTargets') return this.listTargets()
    if (request.operation === 'getDocument') return this.getDocument(request.target)
    const record = this.resolve(request.target)
    const effective = applyCanonicalOperations(
      record.baseline,
      record.target,
      record.documentTarget,
      record.document.operations,
    )
    if (request.operation === 'getEffectiveGraph') return clone({
      target: record.target,
      graph: graphOf(effective.topology, record.target.graphId),
      summary: effective.summary,
    })
    return clone({ target: record.target, topology: effective.topology, summary: effective.summary })
  }

  subscribe(listener: TopologyOverrideChangeListener): () => void
  subscribe(selector: TopologyOverrideTargetSelector, listener: TopologyOverrideChangeListener): () => void
  subscribe(selectorOrListener: TopologyOverrideTargetSelector | TopologyOverrideChangeListener, maybeListener?: TopologyOverrideChangeListener): () => void {
    const subscriber = typeof selectorOrListener === 'function'
      ? { listener: selectorOrListener }
      : { target: clone(selectorOrListener), listener: maybeListener! }
    this.subscribers.add(subscriber)
    return () => this.subscribers.delete(subscriber)
  }

  private resolve(selector?: TopologyOverrideTargetSelector): AssetRecord {
    const matches = [...this.records.values()].filter((record) => selectorMatches(record.target, selector))
    if (matches.length === 1) return matches[0]
    if (matches.length === 0) throw new Error('[glbTopologyOverrideTool] target not found')
    const candidates = matches.map((record) => `${record.target.assetId}/${record.target.graphId}`).sort().join(', ')
    throw new Error(`[glbTopologyOverrideTool] target is ambiguous; specify assetId and graphId: ${candidates}`)
  }

  private commit(record: AssetRecord, type: 'replace' | 'mutate', candidate: { document: ManualTopologyOverrideV2Document; topology: GlbTopologyDocument; summary: TopologyOverrideSummary }, action?: TopologyOverrideAction): void {
    const key = targetKey(record.target)
    if (this.committingTargets.has(key)) {
      throw new Error(`[glbTopologyOverrideTool] reentrant commit is not allowed for ${record.target.assetId}/${record.target.graphId}`)
    }
    const event: TopologyOverrideChangeEvent = {
      type,
      action,
      target: clone(record.target),
      document: clone(candidate.document),
      effectiveTopology: clone(candidate.topology),
      summary: clone(candidate.summary),
    }
    this.committingTargets.add(key)
    try {
      record.onChange?.(clone(event))
      record.document = clone(candidate.document)
    } finally {
      this.committingTargets.delete(key)
    }
    for (const subscriber of this.subscribers) {
      if (subscriber.target && !selectorMatches(record.target, subscriber.target)) continue
      try {
        subscriber.listener(clone(event))
      } catch (error) {
        console.error('[glbTopologyOverrideTool] subscriber failed after commit', error)
      }
    }
  }
}

export const topologyOverrideTool = new ManualTopologyOverrideTool()

export type { ManualTopologyOverrideTool }
