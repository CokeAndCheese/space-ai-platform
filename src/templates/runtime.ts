import * as THREE from 'three'
import { ssp } from '@/ssp'
import { topologyOverrideTool } from '@/adapters/glbTopology'
import { templateRegistry } from './registry'
import type { TemplateDefinition } from './types'

export interface TopologyOverrideTemplateApi {
  query(request: Record<string, unknown>): unknown
  mutate(request: Record<string, unknown>): unknown
}

type CompiledTemplate = (
  sspNamespace: typeof ssp,
  threeNamespace: typeof THREE,
  params: Readonly<Record<string, unknown>>,
  topologyOverrides: TopologyOverrideTemplateApi,
) => Promise<unknown>

export interface ExecuteTemplateOptions {
  /** Only templates explicitly exposed to AI may run. Defaults to true. */
  aiOnly?: boolean
  /** Sandbox can run fixed examples without supplying documented parameters. */
  validateParams?: boolean
}

const compiledTemplates = new Map<string, CompiledTemplate>()

function compileTemplate(definition: Readonly<TemplateDefinition>): CompiledTemplate {
  const cached = compiledTemplates.get(definition.id)
  if (cached) return cached

  // Templates are trusted, bundled project files. User/LLM generated code is never compiled.
  const factory = new Function(
    'ssp',
    'THREE',
    'params',
    'topologyOverrides',
    `"use strict"; return (async () => { ${definition.code}\n})();`,
  ) as CompiledTemplate
  compiledTemplates.set(definition.id, factory)
  return factory
}

export async function executeTemplate(
  templateId: string,
  params: Record<string, unknown> = {},
  options: ExecuteTemplateOptions = {},
): Promise<unknown> {
  const aiOnly = options.aiOnly ?? true
  const definition = templateRegistry.require(templateId)
  if (aiOnly && definition.aiEnabled !== true) {
    throw new Error(`[templates] template is not AI-enabled: ${definition.id}`)
  }

  const shouldValidate = options.validateParams ?? aiOnly
  const prepared = shouldValidate
    ? templateRegistry.prepareParams(definition, params, true)
    : { ...params }

  try {
    const topologyOverrides: TopologyOverrideTemplateApi = Object.freeze({
      query: (request: Record<string, unknown>) => topologyOverrideTool.query(request as never),
      mutate: (request: Record<string, unknown>) => topologyOverrideTool.mutate(request as never),
    })
    return await compileTemplate(definition)(ssp, THREE, Object.freeze(prepared), topologyOverrides)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`[template:${definition.id}] ${message}`)
  }
}

export const templateRuntime = Object.freeze({ execute: executeTemplate })
