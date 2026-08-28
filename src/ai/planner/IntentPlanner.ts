/**
 * IntentPlanner —— Intent → Plan (决策表入口)
 */

import { buildPlan, type Plan } from './decisionTable'
import { parseIntent, type Intent } from '../types/Intent'

export function planIntent(intent: Intent): Plan {
  const planId = crypto.randomUUID()
  // Revalidate against the current capability projection at the last point
  // before a model-selected call becomes executable work.
  return buildPlan(parseIntent(intent), planId)
}

export type { Plan, Step } from './decisionTable'
