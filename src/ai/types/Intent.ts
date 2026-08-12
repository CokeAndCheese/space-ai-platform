/**
 * AI output contract.
 *
 * Narrow waist: the model may only select an AI-enabled template and provide
 * its parameters. SSP APIs, planner actions and skills are not part of the
 * model-facing schema.
 */

import { z } from 'zod'
import { resolveAiTemplateId, templateRegistry } from '@/templates/registry'

export const RENDER_TYPES = [
  'WINDOW', 'DOOR', 'ELEVATOR', 'STAIR',
  'CEILING', 'WALL', 'SPACE', 'FACILITY',
] as const
export type RenderType = typeof RENDER_TYPES[number]

export const FIRE_TYPES = [
  'HYDRANT', 'SMOKE_DETECTOR', 'SPRINKLER', 'EXTINGUISHER',
  'EMERGENCY_LIGHT', 'EXIT_SIGN', 'BREAK_GLASS', 'ALARM_BELL',
  'FIRE_HOSE', 'FIRE_DOOR', 'OTHER',
] as const
export type FireType = typeof FIRE_TYPES[number]

export const SPACE_TYPES = [
  'TOILET', 'LAUNDRY', 'KITCHEN', 'OFFICE', 'MEETING_ROOM',
  'BEDROOM', 'CORRIDOR', 'STAIRWELL', 'ELEVATOR_HALL',
  'MECHANICAL_ROOM', 'STORAGE', 'LOBBY', 'BALCONY',
] as const
export type SpaceType = typeof SPACE_TYPES[number]

export const FLOOR_TYPES = [
  'FLOOR', 'TOWER', 'ROOF', 'BASEMENT',
  'LANDSCAPE_TERRAIN', 'LANDSCAPE_FACADE', 'FACILITY',
] as const
export type FloorType = typeof FLOOR_TYPES[number]

export const DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const
export type Direction = typeof DIRECTIONS[number]

export const BUILDINGS = ['A', 'B', 'C'] as const
export type Building = typeof BUILDINGS[number]

export const QUERY_OPERATIONS = [
  'list', 'count', 'locate', 'highlight', 'flash', 'focus',
  'hide', 'show', 'isolate', 'compare', 'summarize',
] as const
export type QueryOperation = typeof QUERY_OPERATIONS[number]

export const QUERY_ENTITIES = ['object', 'floor'] as const
export type QueryEntity = typeof QUERY_ENTITIES[number]

export const GROUP_FIELDS = [
  'renderType', 'fireType', 'spaceType',
  'building', 'level', 'direction', 'floorName',
] as const
export type GroupField = typeof GROUP_FIELDS[number]

export interface QueryTarget {
  renderType?: RenderType
  fireType?: FireType
  spaceType?: SpaceType
  sid?: string
  meshName?: string
}

export interface QueryScope {
  buildings?: Building[]
  levels?: number[]
  floorNames?: string[]
  floorTypes?: FloorType[]
  directions?: Direction[]
}

export interface QueryVisual {
  color?: string
  duration?: number
}

export interface QueryOutput {
  format?: 'list' | 'table' | 'chart' | 'text'
  limit?: number
}

export interface QuerySceneParams extends Record<string, unknown> {
  entity?: QueryEntity
  operation: QueryOperation
  target?: QueryTarget
  scope?: QueryScope
  groupBy?: GroupField
  visual?: QueryVisual
  output?: QueryOutput
}

const RawIntentSchema = z.object({
  action: z.literal('template'),
  templateId: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional().default({}),
}).strict()

const IntentSchema = RawIntentSchema.superRefine((value, ctx) => {
  const canonicalId = resolveAiTemplateId(value.templateId)
  if (!canonicalId) {
    ctx.addIssue({
      code: 'custom',
      path: ['templateId'],
      message: `unknown or non-AI template: ${value.templateId}`,
    })
    return
  }
  try {
    templateRegistry.prepareParams(templateRegistry.require(canonicalId), value.params, true)
  } catch (error) {
    ctx.addIssue({
      code: 'custom',
      path: ['params'],
      message: error instanceof Error ? error.message : String(error),
    })
  }
}).transform((value) => {
  const canonicalId = resolveAiTemplateId(value.templateId)!
  const params = templateRegistry.prepareParams(
    templateRegistry.require(canonicalId),
    value.params,
    true,
  )
  return {
    action: 'template' as const,
    templateId: canonicalId,
    params,
  }
})

export type Intent = z.output<typeof IntentSchema>

/** Validate, canonicalize and apply documented template defaults. */
export function parseIntent(raw: unknown): Intent {
  return IntentSchema.parse(raw)
}

export function tryParseIntent(raw: unknown): Intent | null {
  const result = IntentSchema.safeParse(raw)
  return result.success ? result.data : null
}

export function createTemplateIntent(
  templateId: string,
  params: Record<string, unknown> = {},
): Intent {
  return parseIntent({ action: 'template', templateId, params })
}
