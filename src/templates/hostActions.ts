import {
  executeLegacyHostTemplateAction,
  getVisibilityUndoState,
  invalidateVisibilityUndo,
  type LegacyHostTemplateAction,
} from './legacyRuntime'

export type HostTemplateAction = LegacyHostTemplateAction

/**
 * Explicit host-only template adapter. These actions never enter Intent,
 * Planner, the AI catalog, or the v3 Registry.
 */
export async function executeHostTemplateAction(
  action: HostTemplateAction,
): Promise<unknown> {
  return executeLegacyHostTemplateAction(action)
}

export { getVisibilityUndoState, invalidateVisibilityUndo }
