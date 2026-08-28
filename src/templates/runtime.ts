import {
  executeLegacyTemplate,
  type ExecuteLegacyTemplateOptions,
} from './legacyRuntime'
import { v3TemplateRegistry } from './v3/appRegistry'
import { v3TemplateRuntime } from './v3/appRuntime'
import {
  readTopologyCapabilitySession,
  topologyTemplateUnavailableResult,
  type TopologyCapabilitySessionSnapshot,
} from './topologyCapabilityGate'

export interface ExecuteTemplateOptions extends ExecuteLegacyTemplateOptions {}

export interface TemplateRuntimeDependencies {
  readonly readSceneSession?: () => TopologyCapabilitySessionSnapshot
  readonly executeV3?: (
    templateId: string,
    params: Record<string, unknown>,
    options: { aiOnly?: boolean },
  ) => Promise<unknown>
  readonly executeLegacy?: (
    templateId: string,
    params: Record<string, unknown>,
    options: ExecuteLegacyTemplateOptions,
  ) => Promise<unknown>
}

export interface TemplateRuntime {
  execute(
    templateId: string,
    params?: Record<string, unknown>,
    options?: ExecuteTemplateOptions,
  ): Promise<unknown>
}

/**
 * Transitional v3-first dispatcher. A registered v3 id always shadows v2;
 * the legacy compiler is reachable only for ids that have not migrated yet.
 */
export function createTemplateRuntime(
  dependencies: TemplateRuntimeDependencies = {},
): TemplateRuntime {
  const readSceneSession = dependencies.readSceneSession ?? readTopologyCapabilitySession
  const executeV3 = dependencies.executeV3 ?? (
    (templateId, params, options) => v3TemplateRuntime.execute(templateId, params, options)
  )
  const executeLegacy = dependencies.executeLegacy ?? executeLegacyTemplate
  return Object.freeze({
    async execute(
      templateId: string,
      params: Record<string, unknown> = {},
      options: ExecuteTemplateOptions = {},
    ): Promise<unknown> {
      const unavailable = topologyTemplateUnavailableResult(templateId, readSceneSession())
      if (unavailable !== null) return unavailable
      if (v3TemplateRegistry.has(templateId)) {
        return executeV3(templateId, params, {
          aiOnly: options.aiOnly ?? true,
        })
      }
      return executeLegacy(templateId, params, options)
    },
  })
}

export const templateRuntime = createTemplateRuntime()

export function executeTemplate(
  templateId: string,
  params: Record<string, unknown> = {},
  options: ExecuteTemplateOptions = {},
): Promise<unknown> {
  return templateRuntime.execute(templateId, params, options)
}
