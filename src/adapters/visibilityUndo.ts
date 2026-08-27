import type * as THREE from 'three'

export type VisibilityUndoOperation = 'hide' | 'show' | 'isolate'

export interface VisibilityUndoState {
  canUndo: boolean
  operation: VisibilityUndoOperation | null
  changedCount: number
}

export interface VisibilityUndoReceipt {
  action: 'undoVisibility'
  undone: boolean
  operation: VisibilityUndoOperation | null
  changedCount: number
  reason?: 'no-transaction' | 'no-scene' | 'scene-mismatch' | 'generation-mismatch' | 'detached' | 'after-conflict' | 'undo-failed' | 'rollback-failed'
}

interface VisibilityEntry {
  object: THREE.Object3D
  before: boolean
  after: boolean
}

interface VisibilityTransaction {
  scene: THREE.Scene
  generation: number
  operation: VisibilityUndoOperation
  entries: readonly VisibilityEntry[]
}

export type VisibilitySetter = (object: THREE.Object3D, visible: boolean) => void

function isMountedInScene(scene: THREE.Scene, object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object
  while (current) {
    if (current === scene) return true
    current = current.parent
  }
  return false
}

function isClarificationResult(result: unknown): boolean {
  if (result === null || typeof result !== 'object') return false
  const data = (result as { data?: unknown }).data
  return data !== null && typeof data === 'object' && (data as { needsClarification?: unknown }).needsClarification === true
}

/**
 * Host adapter state for one scene-bound visibility undo transaction.
 * Object references remain private and never appear in public receipts.
 */
export class VisibilityUndoCoordinator {
  private generationValue = 0
  private transaction: VisibilityTransaction | null = null

  get generation(): number {
    return this.generationValue
  }

  getState(): VisibilityUndoState {
    const transaction = this.transaction
    return {
      canUndo: transaction !== null,
      operation: transaction?.operation ?? null,
      changedCount: transaction?.entries.length ?? 0,
    }
  }

  invalidate(): void {
    this.generationValue += 1
    this.transaction = null
  }

  private snapshot(scene: THREE.Scene): VisibilityEntry[] {
    const entries: VisibilityEntry[] = []
    scene.traverse((object) => {
      if (object === scene) return
      entries.push({ object, before: object.visible, after: object.visible })
    })
    return entries
  }

  private changedSince(entries: readonly VisibilityEntry[]): VisibilityEntry[] {
    const changed: VisibilityEntry[] = []
    for (const entry of entries) {
      if (entry.object.visible === entry.before) continue
      changed.push({ ...entry, after: entry.object.visible })
    }
    return changed
  }

  private restore(
    entries: readonly VisibilityEntry[],
    useBefore: boolean,
    setVisible: VisibilitySetter,
  ): boolean {
    let failed = false
    for (const entry of entries) {
      const visible = useBefore ? entry.before : entry.after
      try {
        setVisible(entry.object, visible)
      } catch {
        failed = true
      }
    }
    return !failed
  }

  async run<T>(
    scene: THREE.Scene,
    operation: VisibilityUndoOperation,
    action: () => T | Promise<T>,
    setVisible: VisibilitySetter,
  ): Promise<T> {
    const generation = this.generationValue
    const snapshot = this.snapshot(scene)
    try {
      const result = await action()
      if (generation !== this.generationValue) return result
      const changed = this.changedSince(snapshot)

      // A clarification response is required to have no side effects and must
      // never replace a previously undoable transaction.
      if (isClarificationResult(result)) {
        if (changed.length > 0 && !this.restore(changed, true, setVisible)) {
          this.invalidate()
          throw new Error('[visibility-undo] 澄清响应产生副作用且回滚失败')
        }
        return result
      }

      // A successful no-op retains the previous latest useful transaction.
      if (changed.length > 0) {
        this.transaction = { scene, generation, operation, entries: changed }
      }
      return result
    } catch (error) {
      if (generation !== this.generationValue) throw error
      const changed = this.changedSince(snapshot)
      if (changed.length > 0 && !this.restore(changed, true, setVisible)) {
        this.invalidate()
        throw new Error('[visibility-undo] 可见性操作失败且回滚不完整')
      }
      throw error
    }
  }

  undo(scene: THREE.Scene | null, setVisible: VisibilitySetter): VisibilityUndoReceipt {
    const transaction = this.transaction
    if (!transaction) {
      return { action: 'undoVisibility', undone: false, operation: null, changedCount: 0, reason: 'no-transaction' }
    }
    if (!scene) return this.rejectAndInvalidate(transaction, 'no-scene')
    if (transaction.scene !== scene) return this.rejectAndInvalidate(transaction, 'scene-mismatch')
    if (transaction.generation !== this.generationValue) return this.rejectAndInvalidate(transaction, 'generation-mismatch')
    if (transaction.entries.some((entry) => !isMountedInScene(scene, entry.object))) {
      return this.rejectAndInvalidate(transaction, 'detached')
    }
    if (transaction.entries.some((entry) => entry.object.visible !== entry.after)) {
      return this.rejectAndInvalidate(transaction, 'after-conflict')
    }

    const changed = transaction.entries
    const applied: VisibilityEntry[] = []
    try {
      for (const entry of changed) {
        setVisible(entry.object, entry.before)
        applied.push(entry)
      }
    } catch {
      // Undo is atomic from the caller's perspective: compensate every entry
      // back to the post-operation state before returning a rejected receipt.
      const rollbackSucceeded = this.restore(changed, false, setVisible)
      if (!rollbackSucceeded) this.invalidate()
      return {
        action: 'undoVisibility',
        undone: false,
        operation: transaction.operation,
        changedCount: changed.length,
        reason: rollbackSucceeded && applied.length < changed.length ? 'undo-failed' : 'rollback-failed',
      }
    }
    this.transaction = null
    return {
      action: 'undoVisibility',
      undone: true,
      operation: transaction.operation,
      changedCount: changed.length,
    }
  }

  private rejectAndInvalidate(
    transaction: VisibilityTransaction,
    reason: NonNullable<VisibilityUndoReceipt['reason']>,
  ): VisibilityUndoReceipt {
    this.invalidate()
    return {
      action: 'undoVisibility',
      undone: false,
      operation: transaction.operation,
      changedCount: transaction.entries.length,
      reason,
    }
  }
}
