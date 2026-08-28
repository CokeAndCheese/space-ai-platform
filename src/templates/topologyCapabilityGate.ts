import type { TopologySceneSessionStatus } from '@/topology'
import { templateRegistry } from './registry'
import { v3TemplateRegistry } from './v3/appRegistry'

export interface TopologyUnavailableResult {
  readonly ok: false
  readonly code: 'TOPOLOGY_UNAVAILABLE'
  readonly reasonCode: 'PACKAGE_DECLARED_ABSENT'
}

export interface TopologyCapabilitySessionSnapshot {
  readonly status: TopologySceneSessionStatus
  readonly packageSession: unknown
}

export const TOPOLOGY_UNAVAILABLE_RESULT: TopologyUnavailableResult = Object.freeze({
  ok: false,
  code: 'TOPOLOGY_UNAVAILABLE',
  reasonCode: 'PACKAGE_DECLARED_ABSENT',
})

const EMPTY_SESSION: TopologyCapabilitySessionSnapshot = Object.freeze({
  status: 'idle',
  packageSession: null,
})

let readSceneSession: () => TopologyCapabilitySessionSnapshot = () => EMPTY_SESSION

/** Installed by the application lifecycle adapter; it stores no parallel state. */
export function installTopologyCapabilitySessionSource(
  source: () => TopologyCapabilitySessionSnapshot,
): void {
  readSceneSession = source
}

export function readTopologyCapabilitySession(): TopologyCapabilitySessionSnapshot {
  return readSceneSession()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The scene lifecycle is the only authority for package capability state.
 * A parse/load failure, legacy sidecar absence, or partial v2 state must not
 * be projected as an approved capability absence.
 */
export function isTopologyDeclaredAbsentSession(
  session: TopologyCapabilitySessionSnapshot,
): boolean {
  if (session.status !== 'scene-ready' || !isRecord(session.packageSession)) return false
  const packageSession = session.packageSession
  if (
    packageSession.schemaVersion !== 2 ||
    packageSession.profile !== 'TOPOLOGY_ABSENT_TRANSITION' ||
    !isRecord(packageSession.topologyCapability)
  ) {
    return false
  }
  const capability = packageSession.topologyCapability
  return (
    capability.capability === 'topology' &&
    capability.status === 'UNAVAILABLE' &&
    capability.code === 'TOPOLOGY_UNAVAILABLE' &&
    capability.reasonCode === 'PACKAGE_DECLARED_ABSENT' &&
    capability.packageSchemaVersion === 2
  )
}

export function currentTopologyUnavailableResult(
  session: TopologyCapabilitySessionSnapshot = readTopologyCapabilitySession(),
): TopologyUnavailableResult | null {
  return isTopologyDeclaredAbsentSession(session)
    ? TOPOLOGY_UNAVAILABLE_RESULT
    : null
}

export function parseTopologyUnavailableResult(
  value: unknown,
): TopologyUnavailableResult | null {
  if (!isRecord(value)) return null
  return (
    value.ok === false &&
    value.code === 'TOPOLOGY_UNAVAILABLE' &&
    value.reasonCode === 'PACKAGE_DECLARED_ABSENT'
  )
    ? TOPOLOGY_UNAVAILABLE_RESULT
    : null
}

/** Registry/Manifest bindings are authoritative; callers cannot self-label. */
export function templateRequiresTopology(templateId: string): boolean {
  if (v3TemplateRegistry.has(templateId)) {
    return v3TemplateRegistry.registration(templateId).capability.namespace === 'topologyTool'
  }
  const definition = templateRegistry.get(templateId)
  return typeof definition?.method === 'string' &&
    definition.method.startsWith('ssp.topologyTool.')
}

export function topologyTemplateUnavailableResult(
  templateId: string,
  session: TopologyCapabilitySessionSnapshot = readTopologyCapabilitySession(),
): TopologyUnavailableResult | null {
  if (!templateRequiresTopology(templateId)) return null
  return currentTopologyUnavailableResult(session)
}

export function isTemplateCapabilityAvailable(
  templateId: string,
  session: TopologyCapabilitySessionSnapshot = readTopologyCapabilitySession(),
): boolean {
  return topologyTemplateUnavailableResult(templateId, session) === null
}
