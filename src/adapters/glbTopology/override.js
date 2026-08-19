/**
 * Topology Override V1 compatibility and V2 operation-log application.
 *
 * This file deliberately has no Node, DOM, Three.js, or application imports so
 * it can be used by the browser adapter and the offline compiler/CLIs.
 */

export const TOPOLOGY_OVERRIDE_SCHEMA_VERSION = 1
export const TOPOLOGY_OVERRIDE_V2_SCHEMA_VERSION = 2
export const TOPOLOGY_OVERRIDE_COORDINATE_SPACE = 'MODEL_LOCAL'
export const TOPOLOGY_OVERRIDE_MAX_VIA_POINTS = 64
export const TOPOLOGY_OVERRIDE_MIN_SEGMENT_LENGTH = 1e-6

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone)
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]))
  }
  return value
}

function nonEmptyString(value, path, errors) {
  if (typeof value !== 'string' || value.length === 0) {
    errors.push(`${path} must be a non-empty string`)
    return false
  }
  return true
}

function finitePoint(value, path, errors) {
  if (!isRecord(value)) {
    errors.push(`${path} must be a point object`)
    return false
  }
  let valid = true
  for (const axis of ['x', 'y', 'z']) {
    if (typeof value[axis] !== 'number' || !Number.isFinite(value[axis])) {
      errors.push(`${path}.${axis} must be finite`)
      valid = false
    }
  }
  return valid
}

function validateOverrideEntry(value, path, errors) {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`)
    return
  }
  nonEmptyString(value.edgeId, `${path}.edgeId`, errors)
  if (!isRecord(value.expect)) {
    errors.push(`${path}.expect must be an object`)
  } else {
    nonEmptyString(value.expect.source, `${path}.expect.source`, errors)
    nonEmptyString(value.expect.target, `${path}.expect.target`, errors)
  }
  if (!isRecord(value.path) || value.path.type !== 'POLYLINE' || !Array.isArray(value.path.via)) {
    errors.push(`${path}.path must be a POLYLINE`)
    return
  }
  if (value.path.via.length > TOPOLOGY_OVERRIDE_MAX_VIA_POINTS) {
    errors.push(`${path}.path.via must contain at most ${TOPOLOGY_OVERRIDE_MAX_VIA_POINTS} points`)
  }
  value.path.via.forEach((point, index) => finitePoint(point, `${path}.path.via[${index}]`, errors))
}

/** Return all structural errors in an override document without mutating it. */
function validateV1TopologyOverrideDocument(value) {
  const errors = []
  if (!isRecord(value)) return ['topology override must be an object']
  if (value.overrideSchemaVersion !== TOPOLOGY_OVERRIDE_SCHEMA_VERSION) {
    errors.push(`overrideSchemaVersion must be ${TOPOLOGY_OVERRIDE_SCHEMA_VERSION}`)
  }
  if (value.coordinateSpace !== TOPOLOGY_OVERRIDE_COORDINATE_SPACE) {
    errors.push(`coordinateSpace must be ${TOPOLOGY_OVERRIDE_COORDINATE_SPACE}`)
  }
  if (!isRecord(value.target)) {
    errors.push('target must be an object')
  } else {
    nonEmptyString(value.target.graphId, 'target.graphId', errors)
    if (value.target.sourceAsset !== undefined) {
      nonEmptyString(value.target.sourceAsset, 'target.sourceAsset', errors)
    }
  }
  if (!Array.isArray(value.edgeOverrides)) {
    errors.push('edgeOverrides must be an array')
  } else {
    const edgeIds = new Set()
    value.edgeOverrides.forEach((entry, index) => {
      validateOverrideEntry(entry, `edgeOverrides[${index}]`, errors)
      if (isRecord(entry) && typeof entry.edgeId === 'string' && edgeIds.has(entry.edgeId)) {
        errors.push(`edgeOverrides[${index}].edgeId duplicates edge "${entry.edgeId}"`)
      }
      if (isRecord(entry) && typeof entry.edgeId === 'string') edgeIds.add(entry.edgeId)
    })
  }
  return errors
}

function throwIfInvalidOverride(value) {
  const errors = validateTopologyOverrideDocument(value)
  if (errors.length > 0) throw new Error(`[glbTopologyOverride] invalid document:\n${errors.join('\n')}`)
}

function graphSourceAssets(topology, graph) {
  const values = [
    graph?.data?.sourceAsset,
    topology?.diagnostics?.source?.asset,
    topology?.sourceAsset,
  ]
  return values.filter((value) => typeof value === 'string')
}

function distance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z)
}

function validateAppliedEntry(entry, graph, index) {
  const path = `edgeOverrides[${index}]`
  const edge = graph.edges.find((candidate) => candidate.id === entry.edgeId)
  if (!edge) throw new Error(`[glbTopologyOverride] ${path}.edgeId "${entry.edgeId}" is unknown in graph "${graph.id}"`)
  if (edge.source !== entry.expect.source || edge.target !== entry.expect.target) {
    throw new Error(
      `[glbTopologyOverride] ${path} endpoint expectation is stale for edge "${entry.edgeId}": `
      + `expected ${entry.expect.source}->${entry.expect.target}, got ${edge.source}->${edge.target}`,
    )
  }
  const sourceNode = graph.nodes.find((node) => node.id === edge.source)
  const targetNode = graph.nodes.find((node) => node.id === edge.target)
  if (!sourceNode || !targetNode) {
    throw new Error(`[glbTopologyOverride] ${path} edge "${entry.edgeId}" has an unknown endpoint node`)
  }
  const points = [sourceNode.position, ...entry.path.via, targetNode.position]
  let totalLength = 0
  for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
    const segmentLength = distance(points[pointIndex - 1], points[pointIndex])
    if (!(segmentLength > TOPOLOGY_OVERRIDE_MIN_SEGMENT_LENGTH)) {
      throw new Error(
        `[glbTopologyOverride] ${path}.path.via creates an adjacent segment of length ${segmentLength}; `
        + `each segment must be > ${TOPOLOGY_OVERRIDE_MIN_SEGMENT_LENGTH}`,
      )
    }
    totalLength += segmentLength
  }
  if (!(totalLength > TOPOLOGY_OVERRIDE_MIN_SEGMENT_LENGTH)) {
    throw new Error(
      `[glbTopologyOverride] ${path}.path total segment length must be > ${TOPOLOGY_OVERRIDE_MIN_SEGMENT_LENGTH}`,
    )
  }
  return edge
}

function sortedOverrides(overrides) {
  return [...overrides].sort((left, right) => (
    left.edgeId.localeCompare(right.edgeId)
    || left.expect.source.localeCompare(right.expect.source)
    || left.expect.target.localeCompare(right.expect.target)
  ))
}

/**
 * Apply all overrides atomically to one graph in an embedded topology
 * document. The input topology and override document are never mutated.
 */
function applyV1TopologyOverrideDocument(topology, overrideDocument) {
  throwIfInvalidOverride(overrideDocument)
  if (!isRecord(topology) || !Array.isArray(topology.graphs)) {
    throw new Error('[glbTopologyOverride] topology must contain a graphs array')
  }
  const target = overrideDocument.target
  const graph = topology.graphs.find((candidate) => candidate?.id === target.graphId)
  if (!graph) throw new Error(`[glbTopologyOverride] target graph "${target.graphId}" was not found`)
  if (target.sourceAsset !== undefined && !graphSourceAssets(topology, graph).includes(target.sourceAsset)) {
    throw new Error(
      `[glbTopologyOverride] target sourceAsset "${target.sourceAsset}" does not match graph "${target.graphId}"`,
    )
  }
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new Error(`[glbTopologyOverride] target graph "${target.graphId}" is missing nodes or edges`)
  }

  const overrides = sortedOverrides(overrideDocument.edgeOverrides)
  const edges = new Map()
  for (const entry of overrides) {
    const edge = validateAppliedEntry(entry, graph, overrideDocument.edgeOverrides.indexOf(entry))
    if (edges.has(edge.id)) throw new Error(`[glbTopologyOverride] duplicate edge "${edge.id}"`)
    edges.set(edge.id, entry)
  }

  const result = clone(topology)
  const resultGraph = result.graphs.find((candidate) => candidate?.id === target.graphId)
  const appliedById = new Map(overrides.map((entry) => [entry.edgeId, entry]))
  resultGraph.edges = resultGraph.edges.map((edge) => {
    const entry = appliedById.get(edge.id)
    if (!entry) return edge
    const tags = [...new Set([...(Array.isArray(edge.tags) ? edge.tags : []), 'topology-override'])]
      .sort((left, right) => left.localeCompare(right))
    const data = {
      ...(isRecord(edge.data) ? edge.data : {}),
      topologyOverride: true,
    }
    const next = { ...edge, path: clone(entry.path), tags, data }
    delete next.weight
    return next
  })
  const priorDiagnostics = isRecord(result.diagnostics) ? result.diagnostics : {}
  const priorSummary = isRecord(priorDiagnostics.overrideSummary) ? priorDiagnostics.overrideSummary : {}
  result.diagnostics = {
    ...priorDiagnostics,
    overrideSummary: {
      ...priorSummary,
      graphId: target.graphId,
      sourceAsset: target.sourceAsset ?? graphSourceAssets(topology, graph)[0] ?? null,
      count: overrides.length,
      edgeIds: overrides.map((entry) => entry.edgeId),
    },
  }
  return result
}

/** Add or replace one edge override and return a sorted, detached document. */
export function upsertTopologyEdgePathOverride(document, entry) {
  throwIfInvalidOverride(document)
  const entryErrors = []
  validateOverrideEntry(entry, 'edgeOverride', entryErrors)
  if (entryErrors.length > 0) throw new Error(`[glbTopologyOverride] invalid edge override:\n${entryErrors.join('\n')}`)
  const result = clone(document)
  const index = result.edgeOverrides.findIndex((candidate) => candidate.edgeId === entry.edgeId)
  if (index === -1) result.edgeOverrides.push(clone(entry))
  else result.edgeOverrides[index] = clone(entry)
  result.edgeOverrides = sortedOverrides(result.edgeOverrides)
  return result
}

/** Remove one edge override and return a sorted, detached document. */
export function removeTopologyEdgePathOverride(document, edgeId) {
  throwIfInvalidOverride(document)
  if (typeof edgeId !== 'string' || edgeId.length === 0) {
    throw new Error('[glbTopologyOverride] edgeId must be a non-empty string')
  }
  const result = clone(document)
  result.edgeOverrides = sortedOverrides(result.edgeOverrides.filter((entry) => entry.edgeId !== edgeId))
  return result
}

const TOPOLOGY_OVERRIDE_V2_OPERATION_TYPES = new Set([
  'ADD_NODE',
  'REMOVE_NODE',
  'RESTORE_NODE',
  'ADD_EDGE',
  'REMOVE_EDGE',
  'RESTORE_EDGE',
  'OVERRIDE_EDGE_PATH',
])

function validateOptionalTags(value, path, errors) {
  if (value === undefined) return
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`)
    return
  }
  value.forEach((tag, index) => nonEmptyString(tag, `${path}[${index}]`, errors))
}

function validateV2Node(value, path, errors) {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`)
    return
  }
  nonEmptyString(value.id, `${path}.id`, errors)
  nonEmptyString(value.layerId, `${path}.layerId`, errors)
  if (!finitePoint(value.position, `${path}.position`, errors)) return
  for (const key of ['connectorId', 'label', 'kind', 'subtype']) {
    if (value[key] !== undefined) nonEmptyString(value[key], `${path}.${key}`, errors)
  }
  validateOptionalTags(value.tags, `${path}.tags`, errors)
  if (value.data !== undefined && !isRecord(value.data)) errors.push(`${path}.data must be an object`)
}

function validateStandardPolyline(value, path, errors) {
  if (!isRecord(value) || value.type !== 'POLYLINE' || !Array.isArray(value.via)) {
    errors.push(`${path} must be a POLYLINE with via points`)
    return
  }
  if (value.via.length > TOPOLOGY_OVERRIDE_MAX_VIA_POINTS) {
    errors.push(`${path}.via must contain at most ${TOPOLOGY_OVERRIDE_MAX_VIA_POINTS} points`)
  }
  value.via.forEach((point, index) => finitePoint(point, `${path}.via[${index}]`, errors))
}

function validateV2Edge(value, path, errors) {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`)
    return
  }
  nonEmptyString(value.id, `${path}.id`, errors)
  nonEmptyString(value.source, `${path}.source`, errors)
  nonEmptyString(value.target, `${path}.target`, errors)
  if (value.source === value.target) errors.push(`${path} cannot be a self-loop`)
  if (value.relation !== 'LINK' && value.relation !== 'CONNECTOR') {
    errors.push(`${path}.relation must be LINK or CONNECTOR`)
  }
  if (value.direction !== 'FORWARD' && value.direction !== 'BIDIRECTIONAL') {
    errors.push(`${path}.direction must be FORWARD or BIDIRECTIONAL`)
  }
  if (value.weight !== undefined && (
    typeof value.weight !== 'number' || !Number.isFinite(value.weight) || value.weight < 0
  )) errors.push(`${path}.weight must be a non-negative finite number`)
  if (value.initialState !== undefined) {
    if (!isRecord(value.initialState)) {
      errors.push(`${path}.initialState must be an object`)
    } else {
      if (value.initialState.enabled !== undefined && typeof value.initialState.enabled !== 'boolean') {
        errors.push(`${path}.initialState.enabled must be a boolean`)
      }
      if (value.initialState.weightOverride !== undefined && value.initialState.weightOverride !== null && (
        typeof value.initialState.weightOverride !== 'number'
        || !Number.isFinite(value.initialState.weightOverride)
        || value.initialState.weightOverride < 0
      )) errors.push(`${path}.initialState.weightOverride must be null or a non-negative finite number`)
      validateOptionalTags(value.initialState.blockerIds, `${path}.initialState.blockerIds`, errors)
    }
  }
  if (value.mode !== undefined) nonEmptyString(value.mode, `${path}.mode`, errors)
  if (value.path !== undefined) validateStandardPolyline(value.path, `${path}.path`, errors)
  validateOptionalTags(value.tags, `${path}.tags`, errors)
  if (value.data !== undefined && !isRecord(value.data)) errors.push(`${path}.data must be an object`)
}

function validateV2EndpointExpectation(value, path, errors) {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`)
    return
  }
  nonEmptyString(value.source, `${path}.source`, errors)
  nonEmptyString(value.target, `${path}.target`, errors)
}

function validateV2LayerExpectation(value, path, errors) {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`)
    return
  }
  nonEmptyString(value.layerId, `${path}.layerId`, errors)
}

function validateV2Operation(value, path, errors) {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`)
    return
  }
  if (!Number.isInteger(value.seq) || value.seq < 1) errors.push(`${path}.seq must be a positive integer`)
  if (typeof value.type !== 'string' || !TOPOLOGY_OVERRIDE_V2_OPERATION_TYPES.has(value.type)) {
    errors.push(`${path}.type must be a supported operation type`)
    return
  }
  if (value.type === 'ADD_NODE') validateV2Node(value.node, `${path}.node`, errors)
  if (value.type === 'ADD_EDGE') validateV2Edge(value.edge, `${path}.edge`, errors)
  if (value.type === 'REMOVE_NODE' || value.type === 'RESTORE_NODE') {
    nonEmptyString(value.nodeId, `${path}.nodeId`, errors)
    validateV2LayerExpectation(value.expect, `${path}.expect`, errors)
  }
  if (value.type === 'REMOVE_EDGE' || value.type === 'RESTORE_EDGE') {
    nonEmptyString(value.edgeId, `${path}.edgeId`, errors)
    validateV2EndpointExpectation(value.expect, `${path}.expect`, errors)
  }
  if (value.type === 'OVERRIDE_EDGE_PATH') {
    nonEmptyString(value.edgeId, `${path}.edgeId`, errors)
    validateV2EndpointExpectation(value.expect, `${path}.expect`, errors)
    validateStandardPolyline(value.path, `${path}.path`, errors)
  }
}

function validateV2TopologyOverrideDocument(value) {
  const errors = []
  if (!isRecord(value)) return ['topology override must be an object']
  if (value.overrideSchemaVersion !== TOPOLOGY_OVERRIDE_V2_SCHEMA_VERSION) {
    errors.push(`overrideSchemaVersion must be ${TOPOLOGY_OVERRIDE_V2_SCHEMA_VERSION}`)
  }
  if (value.coordinateSpace !== TOPOLOGY_OVERRIDE_COORDINATE_SPACE) {
    errors.push(`coordinateSpace must be ${TOPOLOGY_OVERRIDE_COORDINATE_SPACE}`)
  }
  if (!isRecord(value.target)) {
    errors.push('target must be an object')
  } else {
    nonEmptyString(value.target.graphId, 'target.graphId', errors)
    if (value.target.sourceAsset !== undefined) {
      nonEmptyString(value.target.sourceAsset, 'target.sourceAsset', errors)
    }
  }
  if (!Array.isArray(value.operations)) {
    errors.push('operations must be an array')
    return errors
  }
  const seqs = new Set()
  value.operations.forEach((operation, index) => {
    validateV2Operation(operation, `operations[${index}]`, errors)
    if (isRecord(operation) && Number.isInteger(operation.seq) && operation.seq > 0) {
      if (seqs.has(operation.seq)) errors.push(`operations[${index}].seq duplicates ${operation.seq}`)
      seqs.add(operation.seq)
    }
  })
  const sortedSeqs = [...seqs].sort((left, right) => left - right)
  sortedSeqs.forEach((seq, index) => {
    if (seq !== index + 1) errors.push(`operations.seq must be continuous starting at 1; missing ${index + 1}`)
  })
  return errors
}

/** Validate either the existing V1 document or the operation-log V2 document. */
export function validateTopologyOverrideDocument(value) {
  if (isRecord(value) && value.overrideSchemaVersion === TOPOLOGY_OVERRIDE_V2_SCHEMA_VERSION) {
    return validateV2TopologyOverrideDocument(value)
  }
  return validateV1TopologyOverrideDocument(value)
}

function throwIfInvalidV2Override(value) {
  const errors = validateV2TopologyOverrideDocument(value)
  if (errors.length > 0) throw new Error(`[glbTopologyOverride] invalid V2 document:\n${errors.join('\n')}`)
}

function sortedIds(values) {
  return [...values].sort((left, right) => left.localeCompare(right))
}

function markedManual(value, extraData = {}) {
  const tags = sortedIds(new Set([
    ...(Array.isArray(value.tags) ? value.tags : []),
    'manual',
    'topology-override',
  ]))
  return {
    ...clone(value),
    tags,
    data: {
      ...(isRecord(value.data) ? clone(value.data) : {}),
      origin: 'manual',
      topologyOverride: true,
      ...extraData,
    },
  }
}

function validateGraphForV2(graph) {
  if (
    !isRecord(graph)
    || !Array.isArray(graph.layers)
    || !Array.isArray(graph.nodes)
    || !Array.isArray(graph.edges)
  ) {
    throw new Error('[glbTopologyOverride] target graph is missing layers, nodes, or edges')
  }
  if (graph.layers.length === 0) throw new Error('[glbTopologyOverride] target graph has no layers')
  const layerIds = new Set()
  graph.layers.forEach((layer, index) => {
    if (!isRecord(layer) || typeof layer.id !== 'string' || layer.id.length === 0) {
      throw new Error(`[glbTopologyOverride] graphs[0].layers[${index}].id must be a non-empty string`)
    }
    if (layerIds.has(layer.id)) throw new Error(`[glbTopologyOverride] duplicate baseline layer "${layer.id}"`)
    layerIds.add(layer.id)
  })
  const nodes = new Map()
  for (const [index, node] of graph.nodes.entries()) {
    const errors = []
    validateV2Node(node, `graphs[0].nodes[${index}]`, errors)
    if (errors.length > 0) throw new Error(`[glbTopologyOverride] invalid baseline node:\n${errors.join('\n')}`)
    if (nodes.has(node.id)) throw new Error(`[glbTopologyOverride] duplicate baseline node "${node.id}"`)
    if (!layerIds.has(node.layerId)) {
      throw new Error(`[glbTopologyOverride] baseline node "${node.id}" references unknown layer "${node.layerId}"`)
    }
    nodes.set(node.id, clone(node))
  }
  const edges = new Map()
  for (const [index, edge] of graph.edges.entries()) {
    const errors = []
    validateV2Edge(edge, `graphs[0].edges[${index}]`, errors)
    if (errors.length > 0) throw new Error(`[glbTopologyOverride] invalid baseline edge:\n${errors.join('\n')}`)
    if (edges.has(edge.id)) throw new Error(`[glbTopologyOverride] duplicate baseline edge "${edge.id}"`)
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) {
      throw new Error(`[glbTopologyOverride] baseline edge "${edge.id}" has an unknown endpoint node`)
    }
    edges.set(edge.id, clone(edge))
  }
  return { layerIds, nodes, edges }
}

function validateEffectiveV2Graph(baseline, nodes, edges) {
  if (nodes.size === 0) {
    throw new Error('[glbTopologyOverride] effective graph must contain at least one node')
  }
  for (const node of nodes.values()) {
    if (!baseline.layerIds.has(node.layerId)) {
      throw new Error(`[glbTopologyOverride] node "${node.id}" references unknown layer "${node.layerId}"`)
    }
  }
  for (const edge of edges.values()) {
    const source = nodes.get(edge.source)
    const target = nodes.get(edge.target)
    if (!source || !target) {
      throw new Error(`[glbTopologyOverride] edge "${edge.id}" has an unknown endpoint node`)
    }
    if (edge.source === edge.target) {
      throw new Error(`[glbTopologyOverride] edge "${edge.id}" cannot be a self-loop`)
    }
    const crossesLayer = source.layerId !== target.layerId
    if (!crossesLayer && edge.relation !== 'LINK') {
      throw new Error(`[glbTopologyOverride] same-layer edge "${edge.id}" must use relation LINK`)
    }
    if (crossesLayer && edge.relation !== 'CONNECTOR') {
      throw new Error(`[glbTopologyOverride] cross-layer edge "${edge.id}" must use relation CONNECTOR`)
    }
    if (crossesLayer && (!source.connectorId || source.connectorId !== target.connectorId)) {
      throw new Error(
        `[glbTopologyOverride] cross-layer edge "${edge.id}" endpoints must share a non-empty connectorId`,
      )
    }
    validatePathGeometry(edge.path ?? { type: 'POLYLINE', via: [] }, nodes, edge, `edge[${edge.id}]`)
  }
}

function requireCurrentNode(nodes, nodeId, path) {
  const node = nodes.get(nodeId)
  if (!node) throw new Error(`[glbTopologyOverride] ${path} node "${nodeId}" is not active`)
  return node
}

function requireCurrentEdge(edges, edgeId, path) {
  const edge = edges.get(edgeId)
  if (!edge) throw new Error(`[glbTopologyOverride] ${path} edge "${edgeId}" is not active`)
  return edge
}

function requireLayerExpectation(node, expect, path) {
  if (node.layerId !== expect.layerId) {
    throw new Error(
      `[glbTopologyOverride] ${path} layer expectation is stale for node "${node.id}": `
      + `expected ${expect.layerId}, got ${node.layerId}`,
    )
  }
}

function requireEndpointExpectation(edge, expect, path) {
  if (edge.source !== expect.source || edge.target !== expect.target) {
    throw new Error(
      `[glbTopologyOverride] ${path} endpoint expectation is stale for edge "${edge.id}": `
      + `expected ${expect.source}->${expect.target}, got ${edge.source}->${edge.target}`,
    )
  }
}

function validatePathGeometry(path, nodes, edgeId, operationPath) {
  const errors = []
  validateStandardPolyline(path, `${operationPath}.path`, errors)
  if (errors.length > 0) throw new Error(`[glbTopologyOverride] invalid path for edge "${edgeId}":\n${errors.join('\n')}`)
  const source = nodes.get(edgeId.source)
  const target = nodes.get(edgeId.target)
  const points = [source.position, ...path.via, target.position]
  for (let index = 1; index < points.length; index += 1) {
    const segmentLength = distance(points[index - 1], points[index])
    if (!(segmentLength > TOPOLOGY_OVERRIDE_MIN_SEGMENT_LENGTH)) {
      throw new Error(
        `[glbTopologyOverride] ${operationPath}.path creates an adjacent segment of length ${segmentLength}; `
        + `each segment must be > ${TOPOLOGY_OVERRIDE_MIN_SEGMENT_LENGTH}`,
      )
    }
  }
}

function applyV2TopologyOverrideDocument(topology, overrideDocument) {
  throwIfInvalidV2Override(overrideDocument)
  if (!isRecord(topology) || !Array.isArray(topology.graphs)) {
    throw new Error('[glbTopologyOverride] topology must contain a graphs array')
  }
  const target = overrideDocument.target
  const graph = topology.graphs.find((candidate) => candidate?.id === target.graphId)
  if (!graph) throw new Error(`[glbTopologyOverride] target graph "${target.graphId}" was not found`)
  if (target.sourceAsset !== undefined && !graphSourceAssets(topology, graph).includes(target.sourceAsset)) {
    throw new Error(
      `[glbTopologyOverride] target sourceAsset "${target.sourceAsset}" does not match graph "${target.graphId}"`,
    )
  }

  const baseline = validateGraphForV2(graph)
  const nodes = new Map([...baseline.nodes].map(([id, node]) => [id, clone(node)]))
  const edges = new Map([...baseline.edges].map(([id, edge]) => [id, clone(edge)]))
  const baselineNodeIds = new Set(baseline.nodes.keys())
  const baselineEdgeIds = new Set(baseline.edges.keys())
  const summarySets = {
    addedNodeIds: new Set(),
    addedEdgeIds: new Set(),
    removedNodeIds: new Set(),
    removedEdgeIds: new Set(),
    restoredNodeIds: new Set(),
    restoredEdgeIds: new Set(),
    pathOverriddenEdgeIds: new Set(),
  }
  const operations = [...overrideDocument.operations].sort((left, right) => left.seq - right.seq)

  for (const operation of operations) {
    const operationPath = `operations[seq=${operation.seq}]`
    if (operation.type === 'ADD_NODE') {
      const node = operation.node
      if (baselineNodeIds.has(node.id)) {
        throw new Error(`[glbTopologyOverride] ${operationPath} cannot ADD baseline node "${node.id}"; use RESTORE_NODE`)
      }
      if (nodes.has(node.id)) throw new Error(`[glbTopologyOverride] duplicate active node "${node.id}"`)
      if (!baseline.layerIds.has(node.layerId)) {
        throw new Error(`[glbTopologyOverride] ${operationPath} node "${node.id}" references unknown layer "${node.layerId}"`)
      }
      nodes.set(node.id, markedManual(node))
      summarySets.addedNodeIds.add(node.id)
      continue
    }
    if (operation.type === 'REMOVE_NODE') {
      const node = requireCurrentNode(nodes, operation.nodeId, operationPath)
      requireLayerExpectation(node, operation.expect, operationPath)
      nodes.delete(operation.nodeId)
      summarySets.removedNodeIds.add(operation.nodeId)
      for (const [edgeId, edge] of [...edges]) {
        if (edge.source === operation.nodeId || edge.target === operation.nodeId) {
          edges.delete(edgeId)
          summarySets.removedEdgeIds.add(edgeId)
        }
      }
      continue
    }
    if (operation.type === 'RESTORE_NODE') {
      const baselineNode = baseline.nodes.get(operation.nodeId)
      if (!baselineNode) throw new Error(`[glbTopologyOverride] ${operationPath} can only restore a baseline node`)
      if (nodes.has(operation.nodeId)) throw new Error(`[glbTopologyOverride] node "${operation.nodeId}" is already active`)
      requireLayerExpectation(baselineNode, operation.expect, operationPath)
      nodes.set(operation.nodeId, clone(baselineNode))
      summarySets.restoredNodeIds.add(operation.nodeId)
      continue
    }
    if (operation.type === 'ADD_EDGE') {
      const edge = operation.edge
      if (baselineEdgeIds.has(edge.id)) {
        throw new Error(`[glbTopologyOverride] ${operationPath} cannot ADD baseline edge "${edge.id}"; use RESTORE_EDGE`)
      }
      if (edges.has(edge.id)) throw new Error(`[glbTopologyOverride] duplicate active edge "${edge.id}"`)
      if (!nodes.has(edge.source) || !nodes.has(edge.target)) {
        throw new Error(`[glbTopologyOverride] ${operationPath} edge "${edge.id}" has an unknown endpoint node`)
      }
      if (edge.path !== undefined) validatePathGeometry(edge.path, nodes, { source: edge.source, target: edge.target }, operationPath)
      edges.set(edge.id, markedManual(edge))
      summarySets.addedEdgeIds.add(edge.id)
      continue
    }
    if (operation.type === 'REMOVE_EDGE') {
      const edge = requireCurrentEdge(edges, operation.edgeId, operationPath)
      requireEndpointExpectation(edge, operation.expect, operationPath)
      edges.delete(operation.edgeId)
      summarySets.removedEdgeIds.add(operation.edgeId)
      continue
    }
    if (operation.type === 'RESTORE_EDGE') {
      const baselineEdge = baseline.edges.get(operation.edgeId)
      if (!baselineEdge) throw new Error(`[glbTopologyOverride] ${operationPath} can only restore a baseline edge`)
      if (edges.has(operation.edgeId)) throw new Error(`[glbTopologyOverride] edge "${operation.edgeId}" is already active`)
      requireEndpointExpectation(baselineEdge, operation.expect, operationPath)
      if (!nodes.has(baselineEdge.source) || !nodes.has(baselineEdge.target)) {
        throw new Error(`[glbTopologyOverride] ${operationPath} edge "${operation.edgeId}" has an unknown endpoint node`)
      }
      edges.set(operation.edgeId, clone(baselineEdge))
      summarySets.restoredEdgeIds.add(operation.edgeId)
      continue
    }
    if (operation.type === 'OVERRIDE_EDGE_PATH') {
      const edge = requireCurrentEdge(edges, operation.edgeId, operationPath)
      requireEndpointExpectation(edge, operation.expect, operationPath)
      if (!nodes.has(edge.source) || !nodes.has(edge.target)) {
        throw new Error(`[glbTopologyOverride] ${operationPath} edge "${operation.edgeId}" has an unknown endpoint node`)
      }
      validatePathGeometry(operation.path, nodes, { source: edge.source, target: edge.target }, operationPath)
      const next = markedManual(edge)
      next.path = clone(operation.path)
      delete next.weight
      edges.set(operation.edgeId, next)
      summarySets.pathOverriddenEdgeIds.add(operation.edgeId)
    }
  }

  validateEffectiveV2Graph(baseline, nodes, edges)

  const summary = {
    graphId: target.graphId,
    sourceAsset: target.sourceAsset ?? graphSourceAssets(topology, graph)[0] ?? null,
    count: operations.length,
    addedNodeIds: sortedIds(summarySets.addedNodeIds),
    addedEdgeIds: sortedIds(summarySets.addedEdgeIds),
    removedNodeIds: sortedIds(summarySets.removedNodeIds),
    removedEdgeIds: sortedIds(summarySets.removedEdgeIds),
    restoredNodeIds: sortedIds(summarySets.restoredNodeIds),
    restoredEdgeIds: sortedIds(summarySets.restoredEdgeIds),
    pathOverriddenEdgeIds: sortedIds(summarySets.pathOverriddenEdgeIds),
  }
  const result = clone(topology)
  const resultGraph = result.graphs.find((candidate) => candidate?.id === target.graphId)
  resultGraph.nodes = [...nodes.values()].sort((left, right) => left.id.localeCompare(right.id))
  resultGraph.edges = [...edges.values()].sort((left, right) => left.id.localeCompare(right.id))
  const priorDiagnostics = isRecord(result.diagnostics) ? result.diagnostics : {}
  result.diagnostics = { ...priorDiagnostics, overrideSummary: summary }
  return result
}

/** Apply V1 or V2 without mutating the baseline or override document. */
export function applyTopologyOverrideDocument(topology, overrideDocument) {
  if (isRecord(overrideDocument) && overrideDocument.overrideSchemaVersion === TOPOLOGY_OVERRIDE_V2_SCHEMA_VERSION) {
    return applyV2TopologyOverrideDocument(topology, overrideDocument)
  }
  return applyV1TopologyOverrideDocument(topology, overrideDocument)
}

/** Return the V2 effective topology together with its detached summary. */
export function applyTopologyOverrideDocumentWithSummary(topology, overrideDocument) {
  const result = applyTopologyOverrideDocument(topology, overrideDocument)
  if (!isRecord(overrideDocument) || overrideDocument.overrideSchemaVersion !== TOPOLOGY_OVERRIDE_V2_SCHEMA_VERSION) {
    return { topology: result, summary: clone(result.diagnostics?.overrideSummary ?? {}) }
  }
  return { topology: result, summary: clone(result.diagnostics.overrideSummary) }
}

function requireV2Document(document) {
  throwIfInvalidV2Override(document)
  return document
}

/** Create a detached, empty V2 operation-log document. */
export function createEmptyTopologyOverrideV2Document(graphId = '', sourceAsset) {
  return {
    overrideSchemaVersion: TOPOLOGY_OVERRIDE_V2_SCHEMA_VERSION,
    coordinateSpace: TOPOLOGY_OVERRIDE_COORDINATE_SPACE,
    target: { graphId, ...(sourceAsset ? { sourceAsset } : {}) },
    operations: [],
  }
}

export const createTopologyOverrideV2Document = createEmptyTopologyOverrideV2Document
export const createEmptyTopologyOverrideDocumentV2 = createEmptyTopologyOverrideV2Document

/** Append an operation and assign the next continuous sequence number. */
export function appendTopologyOverrideOperation(document, operation) {
  requireV2Document(document)
  const nextSeq = document.operations.reduce((maximum, item) => Math.max(maximum, item.seq), 0) + 1
  const next = { ...clone(operation), seq: nextSeq }
  const errors = []
  validateV2Operation(next, 'operation', errors)
  if (errors.length > 0) throw new Error(`[glbTopologyOverride] invalid operation:\n${errors.join('\n')}`)
  return {
    ...clone(document),
    operations: [...document.operations.map(clone), next],
  }
}

/** Replace the complete V2 operation log, validating and sorting by seq. */
export function replaceTopologyOverrideOperations(document, operations) {
  requireV2Document(document)
  if (!Array.isArray(operations)) throw new Error('[glbTopologyOverride] operations must be an array')
  const result = { ...clone(document), operations: operations.map(clone) }
  const errors = validateV2TopologyOverrideDocument(result)
  if (errors.length > 0) throw new Error(`[glbTopologyOverride] invalid V2 document:\n${errors.join('\n')}`)
  result.operations.sort((left, right) => left.seq - right.seq)
  return result
}

/** Append a business action using the same operation shape as the V2 contract. */
export function updateTopologyOverrideDocument(document, operation) {
  return appendTopologyOverrideOperation(document, operation)
}

export function addTopologyOverrideNode(document, node) {
  return appendTopologyOverrideOperation(document, { type: 'ADD_NODE', node })
}

export function removeTopologyOverrideNode(document, nodeId, expect) {
  return appendTopologyOverrideOperation(document, {
    type: 'REMOVE_NODE',
    nodeId,
    expect: typeof expect === 'string' ? { layerId: expect } : expect,
  })
}

export function restoreTopologyOverrideNode(document, nodeId, expect) {
  return appendTopologyOverrideOperation(document, {
    type: 'RESTORE_NODE',
    nodeId,
    expect: typeof expect === 'string' ? { layerId: expect } : expect,
  })
}

export function addTopologyOverrideEdge(document, edge) {
  return appendTopologyOverrideOperation(document, { type: 'ADD_EDGE', edge })
}

export function removeTopologyOverrideEdge(document, edgeId, expect) {
  return appendTopologyOverrideOperation(document, { type: 'REMOVE_EDGE', edgeId, expect })
}

export function restoreTopologyOverrideEdge(document, edgeId, expect) {
  return appendTopologyOverrideOperation(document, { type: 'RESTORE_EDGE', edgeId, expect })
}

export function overrideTopologyEdgePath(document, edgeId, expect, path) {
  return appendTopologyOverrideOperation(document, {
    type: 'OVERRIDE_EDGE_PATH',
    edgeId,
    expect,
    path,
  })
}
