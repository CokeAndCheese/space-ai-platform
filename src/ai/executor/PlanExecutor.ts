/**
 * PlanExecutor only dispatches template calls.
 * The templates runtime is the sole layer allowed to reach SSP.
 */

import type { Plan } from '../planner/IntentPlanner'
import { templateRuntime } from '@/templates/runtime'

export interface ExecutionResult {
  templateId: string
  sids: string[]
  count: number
  grouped?: Record<string, string[]>
  message?: string
  data?: unknown
  durationMs: number
}

export interface TemplateExecutor {
  execute(
    templateId: string,
    params?: Record<string, unknown>,
    options?: { aiOnly?: boolean; validateParams?: boolean },
  ): Promise<unknown>
}

function normalizeTemplateResult(
  templateId: string,
  raw: unknown,
  durationMs: number,
): ExecutionResult {
  const record = raw && typeof raw === 'object'
    ? raw as Record<string, unknown>
    : {}
  const sids = Array.isArray(record.sids)
    ? record.sids.filter((sid): sid is string => typeof sid === 'string')
    : []
  const grouped = record.grouped && typeof record.grouped === 'object'
    ? record.grouped as Record<string, string[]>
    : undefined
  const count = typeof record.count === 'number' && Number.isFinite(record.count)
    ? record.count
    : sids.length
  const message = typeof record.message === 'string' ? record.message : undefined
  const data = Object.prototype.hasOwnProperty.call(record, 'data') ? record.data : raw

  return { templateId, sids, count, grouped, message, data, durationMs }
}

export async function executePlan(
  plan: Plan,
  runtime: TemplateExecutor = templateRuntime,
): Promise<ExecutionResult> {
  const start = performance.now()
  let lastTemplateId = plan.intent.templateId
  let rawResult: unknown

  for (const step of plan.steps) {
    lastTemplateId = step.templateId
    rawResult = await runtime.execute(step.templateId, step.params, {
      aiOnly: true,
      validateParams: true,
    })
  }

  const result = normalizeTemplateResult(
    lastTemplateId,
    rawResult,
    performance.now() - start,
  )
  console.log(`[executor] template=${result.templateId}, count=${result.count}`)
  return result
}
