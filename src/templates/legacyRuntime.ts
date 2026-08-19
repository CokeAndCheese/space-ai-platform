import * as THREE from 'three'
import { ssp } from '../ssp'
import { templateRegistry } from './registry'
import { defaultSspManifest } from './v3/manifest'
import type { TemplateDefinition } from './types'

type CompiledLegacyTemplate = (
  sspNamespace: typeof ssp,
  threeNamespace: typeof THREE,
  params: Readonly<Record<string, unknown>>,
) => Promise<unknown>

export interface ExecuteLegacyTemplateOptions {
  aiOnly?: boolean
  validateParams?: boolean
}

const compiledTemplates = new Map<string, CompiledLegacyTemplate>()
const hostOnlyTemplateIds = new Set(
  defaultSspManifest.capabilities
    .filter((capability) => capability.templatePolicy === 'host-only')
    .flatMap((capability) => [
      ...(capability.mappedTemplates ?? []),
      ...(capability.legacyReferences ?? []),
    ]),
)

function compileLegacyTemplate(
  definition: Readonly<TemplateDefinition>,
): CompiledLegacyTemplate {
  const cached = compiledTemplates.get(definition.id)
  if (cached) return cached

  // Transitional v2-only path. New v3 templates are declarative and never
  // reach this compiler; this module is removed after the v2 migration.
  const factory = new Function(
    'ssp',
    'THREE',
    'params',
    `"use strict"; return (async () => { ${definition.code}\n})();`,
  ) as CompiledLegacyTemplate
  compiledTemplates.set(definition.id, factory)
  return factory
}

async function executeLegacyTemplateInternal(
  templateId: string,
  params: Record<string, unknown> = {},
  options: ExecuteLegacyTemplateOptions = {},
  allowHostOnly = false,
): Promise<unknown> {
  const aiOnly = options.aiOnly ?? true
  const definition = templateRegistry.require(templateId)
  if (hostOnlyTemplateIds.has(definition.id) && !allowHostOnly) {
    throw new Error(`[templates] host-only template requires the explicit host action adapter: ${definition.id}`)
  }
  if (aiOnly && definition.aiEnabled !== true) {
    throw new Error(`[templates] template is not AI-enabled: ${definition.id}`)
  }

  const shouldValidate = options.validateParams ?? aiOnly
  const prepared = shouldValidate
    ? templateRegistry.prepareParams(definition, params, true)
    : { ...params }

  try {
    return await compileLegacyTemplate(definition)(ssp, THREE, Object.freeze(prepared))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`[template:${definition.id}] ${message}`)
  }
}

export async function executeLegacyTemplate(
  templateId: string,
  params: Record<string, unknown> = {},
  options: ExecuteLegacyTemplateOptions = {},
): Promise<unknown> {
  return executeLegacyTemplateInternal(templateId, params, options)
}

export type LegacyHostTemplateAction = 'clearAllHighlights'

/** Narrow host-only entry point; arbitrary template ids cannot cross this boundary. */
export async function executeLegacyHostTemplateAction(
  action: LegacyHostTemplateAction,
): Promise<unknown> {
  switch (action) {
    case 'clearAllHighlights':
      return executeLegacyTemplateInternal(action, {}, {
        aiOnly: false,
        validateParams: true,
      }, true)
  }
}
