import { ssp } from '../../ssp'
import { v3TemplateRegistry } from './appRegistry'
import { AtomicTemplateRuntime } from './runtime'
import { topologyTemplateUnavailableResult } from '../topologyCapabilityGate'
import type { JsonValue } from './types'

/** The only application-level injection point from v3 templates into SSP. */
export const v3TemplateRuntime = new AtomicTemplateRuntime(
  v3TemplateRegistry,
  ssp,
  (templateId) => topologyTemplateUnavailableResult(templateId) as JsonValue | null,
)
