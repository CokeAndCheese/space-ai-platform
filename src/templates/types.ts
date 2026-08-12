export interface TemplateParamDefinition {
  name: string
  type: string
  required: boolean
  default?: unknown
  desc?: string
  description?: string
  enum?: unknown[]
}

/**
 * Bundled template metadata.
 *
 * `aiEnabled` is deliberately opt-in. A template can be useful in Sandbox
 * without being safe or meaningful as an AI capability.
 */
export interface TemplateDefinition {
  id: string
  category: string
  subcategory: string
  intent: string[]
  scene?: string
  sdk?: string
  method?: string
  signature?: string
  params?: TemplateParamDefinition[]
  returns?: string
  code: string
  example?: string
  guard?: string[]
  seeAlso?: string[]
  tags?: string[]
  steps?: unknown[]
  aiEnabled?: boolean
  /** Optional deterministic parameters used by the Sandbox smoke test. */
  testParams?: Record<string, unknown>
  /** Added by the registry; not persisted in JSON. */
  sourcePath?: string
  /** Added by the registry; not persisted in JSON. */
  filename?: string
}

export interface TemplateCall {
  templateId: string
  params: Record<string, unknown>
}

export interface TemplateResult {
  sids?: string[]
  count?: number
  grouped?: Record<string, string[]>
  message?: string
  data?: unknown
  [key: string]: unknown
}
