import {
  normalizeTemplateAlias,
  templateRegistry,
} from './registry'
import { v3TemplateRegistry } from './v3/appRegistry'
import {
  isTemplateCapabilityAvailable,
  type TopologyCapabilitySessionSnapshot,
} from './topologyCapabilityGate'

function asParams(value: unknown, templateId: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`[templates] ${templateId} input schema did not produce an object`)
  }
  return value as Record<string, unknown>
}

/**
 * One model-facing catalog over the migration window. A v3 id shadows the
 * same v2 id even when hidden, so policy can never fall through to legacy.
 */
export class TemplateCatalog {
  canonicalId(id: string): string | null {
    const candidate = normalizeTemplateAlias(id)
    if (v3TemplateRegistry.has(candidate)) return candidate
    return templateRegistry.canonicalId(candidate)
  }

  isV3(id: string): boolean {
    return v3TemplateRegistry.has(id)
  }

  isAiEnabled(
    id: string,
    session?: TopologyCapabilitySessionSnapshot,
  ): boolean {
    if (!isTemplateCapabilityAvailable(id, session)) return false
    if (v3TemplateRegistry.has(id)) {
      return v3TemplateRegistry.require(id).ai.exposed
    }
    return templateRegistry.isAiEnabled(id)
  }

  prepareParams(
    id: string,
    input: Record<string, unknown>,
    strict = true,
  ): Record<string, unknown> {
    if (v3TemplateRegistry.has(id)) {
      // v3 schemas are always strict; callers cannot disable the safety gate.
      return asParams(v3TemplateRegistry.prepareInput(id, input), id)
    }
    return templateRegistry.prepareParams(templateRegistry.require(id), input, strict)
  }

  toAiPromptSection(session?: TopologyCapabilitySessionSnapshot): string {
    const shadowed = new Set(v3TemplateRegistry.all().map((definition) => definition.id))
    const unavailable = new Set([
      ...v3TemplateRegistry.all().map((definition) => definition.id),
      ...templateRegistry.all().map((definition) => definition.id),
    ].filter((id) => !isTemplateCapabilityAvailable(id, session)))
    const sections = [
      v3TemplateRegistry.toAiPromptSection(unavailable),
      templateRegistry.toAiPromptSection(new Set([...shadowed, ...unavailable])),
    ].filter((section) => section.trim().length > 0)
    return sections.join('\n\n')
  }
}

export const templateCatalog = new TemplateCatalog()

export function resolveAiTemplateId(
  id: string,
  session?: TopologyCapabilitySessionSnapshot,
): string | null {
  const canonicalId = templateCatalog.canonicalId(id)
  if (!canonicalId || !templateCatalog.isAiEnabled(canonicalId, session)) return null
  return canonicalId
}
