/**
 * IntentPlanner —— Intent → Plan (决策表入口)
 */

import { buildPlan, type Plan } from './decisionTable'
import type { Intent } from '../types/Intent'

export function planIntent(intent: Intent): Plan {
  const planId = crypto.randomUUID()
  return buildPlan(intent, planId)
}

export type { Plan, Step } from './decisionTable'