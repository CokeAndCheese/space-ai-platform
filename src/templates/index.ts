export { templateRegistry } from './registry'
export { templateCatalog, resolveAiTemplateId } from './catalog'
export {
  createTemplateRuntime,
  executeTemplate,
  templateRuntime,
  type ExecuteTemplateOptions,
  type TemplateRuntime,
  type TemplateRuntimeDependencies,
} from './runtime'
export {
  currentTopologyUnavailableResult,
  isTemplateCapabilityAvailable,
  isTopologyDeclaredAbsentSession,
  parseTopologyUnavailableResult,
  readTopologyCapabilitySession,
  templateRequiresTopology,
  topologyTemplateUnavailableResult,
  TOPOLOGY_UNAVAILABLE_RESULT,
  type TopologyCapabilitySessionSnapshot,
  type TopologyUnavailableResult,
} from './topologyCapabilityGate'
export {
  executeHostTemplateAction,
  getVisibilityUndoState,
  invalidateVisibilityUndo,
  type HostTemplateAction,
} from './hostActions'
export { v3TemplateRegistry } from './v3/appRegistry'
export { v3TemplateRuntime } from './v3/appRuntime'
export type { AtomicTemplateDefinition, JsonSchema, JsonValue, ObjectRef } from './v3/types'
export type {
  TemplateCall,
  TemplateDefinition,
  TemplateParamDefinition,
  TemplateResult,
} from './types'
