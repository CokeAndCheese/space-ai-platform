/** Template-only planner. It never imports or describes SSP APIs. */

import type { Intent } from '../types/Intent'

export type Step = {
  type: 'template'
  templateId: string
  params: Record<string, unknown>
}

export interface Plan {
  steps: Step[]
  intent: Intent
  planId: string
}

export function buildPlan(intent: Intent, planId: string): Plan {
  return {
    planId,
    intent,
    steps: [{
      type: 'template',
      templateId: intent.templateId,
      params: intent.params,
    }],
  }
}
