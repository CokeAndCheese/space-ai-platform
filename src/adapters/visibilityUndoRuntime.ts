import { ssp } from '../ssp'
import {
  VisibilityUndoCoordinator,
  type VisibilityUndoOperation,
  type VisibilityUndoReceipt,
  type VisibilityUndoState,
} from './visibilityUndo'

const coordinator = new VisibilityUndoCoordinator()

const setVisible = (object: Parameters<typeof ssp.objectsTool.setVisible>[0], visible: boolean) => {
  ssp.objectsTool.setVisible(object, visible)
}

export function runVisibilityUndoableAction<T>(
  operation: VisibilityUndoOperation,
  action: () => T | Promise<T>,
): Promise<T> {
  return coordinator.run(ssp.getContext().scene, operation, action, setVisible)
}

export function executeVisibilityUndo(): VisibilityUndoReceipt {
  const scene = ssp.hasContext() ? ssp.getContext().scene : null
  return coordinator.undo(scene, setVisible)
}

export function getVisibilityUndoState(): VisibilityUndoState {
  return coordinator.getState()
}

export function invalidateVisibilityUndo(): void {
  coordinator.invalidate()
}

export type { VisibilityUndoReceipt }
