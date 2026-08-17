import {
  executeLegacyTemplate,
  type ExecuteLegacyTemplateOptions,
} from './legacyRuntime'
import { v3TemplateRegistry } from './v3/appRegistry'
import { v3TemplateRuntime } from './v3/appRuntime'

export interface ExecuteTemplateOptions extends ExecuteLegacyTemplateOptions {}

/**
 * Transitional v3-first dispatcher. A registered v3 id always shadows v2;
 * the legacy compiler is reachable only for ids that have not migrated yet.
 */
export async function executeTemplate(
  templateId: string,
  params: Record<string, unknown> = {},
  options: ExecuteTemplateOptions = {},
): Promise<unknown> {
  if (v3TemplateRegistry.has(templateId)) {
    return v3TemplateRuntime.execute(templateId, params, {
      aiOnly: options.aiOnly ?? true,
    })
  }
  return executeLegacyTemplate(templateId, params, options)
}

export const templateRuntime = Object.freeze({ execute: executeTemplate })
