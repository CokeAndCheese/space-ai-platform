import * as THREE from 'three'
import { getSspContext, hasSspContext, registerSspContextCleanup, type SspContext } from '../core/context'

export type HighlightLeaseStatus = 'ACTIVE' | 'RELEASED' | 'EXPIRED'

export interface HighlightOptions {
  color?: string | number | THREE.Color
  pulse?: boolean
  durationMs?: number
}

export interface HighlightLease {
  readonly id: string
  readonly objectIds: readonly string[]
  readonly status: HighlightLeaseStatus
}

interface SlotLayer {
  readonly lease: LeaseRecord
  readonly color: THREE.Color
  pulse: boolean
  pulseOn: boolean
  nextPulseAt: number
}

interface SlotState {
  readonly mesh: THREE.Mesh
  readonly slot: number
  readonly originalMaterial: THREE.Material
  readonly ownedMaterial: THREE.Material
  readonly layers: SlotLayer[]
}

interface MaterialArrayState {
  readonly original: THREE.Material[]
  readonly owned: THREE.Material[]
}

interface LeaseRecord {
  handle: HighlightLease
  readonly id: string
  readonly context: SspContext | null
  readonly scene: THREE.Scene | null
  readonly scoped: boolean
  readonly objects: readonly THREE.Object3D[]
  readonly objectIds: readonly string[]
  readonly slots: SlotState[]
  readonly expiresAt: number | null
  status: HighlightLeaseStatus
}

type SchedulerTimer = ReturnType<typeof setTimeout>

const MAX_OBJECTS_PER_LEASE = 256
const MAX_ACTIVE_LEASES = 128
const PULSE_PERIOD_MS = 500

function isDescendantOf(object: THREE.Object3D, scene: THREE.Scene): boolean {
  for (let current: THREE.Object3D | null = object; current; current = current.parent) {
    if (current === scene) return true
  }
  return false
}

function getObjectId(object: THREE.Object3D): string | null {
  const extras = object.userData?.extras
  const read = (key: string): unknown => object.userData?.[key] ?? extras?.[key]
  const sid = read('sid')
  if (typeof sid === 'string' && sid.length > 0 && sid.length <= 256) return sid
  const findId = read('findId')
  if (typeof findId === 'string' && findId.length > 0 && findId.length <= 256) return findId
  return null
}

function meshMaterials(mesh: THREE.Mesh): THREE.Material[] {
  if (!mesh.material) return []
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material]
}

function setMaterialSlot(mesh: THREE.Mesh, slot: number, material: THREE.Material): void {
  if (Array.isArray(mesh.material)) {
    mesh.material[slot] = material
  } else if (slot === 0) {
    mesh.material = material
  }
}

function applyLayer(state: SlotState, layer: SlotLayer | undefined): void {
  if (!layer) return
  const emissive = (state.ownedMaterial as THREE.Material & { emissive?: THREE.Color }).emissive
  if (!emissive) return
  emissive.copy(layer.pulse && !layer.pulseOn ? new THREE.Color(0, 0, 0) : layer.color)
}

function hasStrictShape(value: unknown, allowed: readonly string[]): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  const ownKeys = Reflect.ownKeys(value)
  if (ownKeys.some((key) => typeof key !== 'string' || !allowed.includes(key))) return false
  return Object.values(Object.getOwnPropertyDescriptors(value)).every((descriptor) => 'value' in descriptor)
}

function isStrictArray(value: unknown, maxLength: number): boolean {
  if (!Array.isArray(value) || value.length > maxLength || Object.getPrototypeOf(value) !== Array.prototype) return false
  const expectedKeys = new Set<string>(['length'])
  for (let index = 0; index < value.length; index++) expectedKeys.add(String(index))
  const ownKeys = Reflect.ownKeys(value)
  if (ownKeys.some((key) => typeof key !== 'string' || !expectedKeys.has(key)) || ownKeys.length !== expectedKeys.size) return false
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor || !('value' in descriptor)) return false
  }
  return true
}

function createHandle(record: Omit<LeaseRecord, 'handle'>): HighlightLease {
  const handle = {} as HighlightLease
  Object.defineProperties(handle, {
    id: { enumerable: true, get: () => record.id },
    objectIds: { enumerable: true, get: () => record.objectIds },
    status: { enumerable: true, get: () => record.status },
  })
  return Object.freeze(handle)
}

/** Internal manager shared by legacy and scoped highlight APIs for one ObjectsTool instance. */
export interface HighlightLeaseManager {
  apply(objects: readonly THREE.Object3D[], options?: HighlightOptions, scoped?: boolean): HighlightLease
  release(lease: HighlightLease): boolean
  releaseAll(): void
  releaseSceneBound(): void
  releaseLegacyForObject(object: THREE.Object3D): void
  getLegacyLease(object: THREE.Object3D): HighlightLease | undefined
  setLegacyLease(object: THREE.Object3D, lease: HighlightLease): void
}

export function createHighlightLeaseManager(): HighlightLeaseManager {
  const leases = new Map<HighlightLease, LeaseRecord>()
  const activeLeases = new Set<LeaseRecord>()
  /** Retain identity tombstones so genuine released/expired handles are idempotent. */
  const knownHandles = new WeakSet<object>()
  const slotStates = new WeakMap<THREE.Mesh, Map<number, SlotState>>()
  const materialArrayStates = new WeakMap<THREE.Mesh, MaterialArrayState>()
  const legacyLeases = new Map<THREE.Object3D, HighlightLease>()
  let nextId = 1
  let schedulerTimer: SchedulerTimer | null = null

  function scheduleNextTick(): void {
    if (schedulerTimer !== null) {
      clearTimeout(schedulerTimer)
      schedulerTimer = null
    }
    let nextAt = Number.POSITIVE_INFINITY
    for (const lease of activeLeases) {
      if (lease.expiresAt !== null) nextAt = Math.min(nextAt, lease.expiresAt)
      for (const slot of lease.slots) {
        const layer = slot.layers.find((candidate) => candidate.lease === lease)
        if (layer?.pulse && slot.layers[slot.layers.length - 1] === layer) {
          nextAt = Math.min(nextAt, layer.nextPulseAt)
        }
      }
    }
    // Indefinite, non-pulsing leases need no timer at all.
    if (!Number.isFinite(nextAt)) return
    schedulerTimer = setTimeout(() => {
      schedulerTimer = null
      tick()
    }, Math.max(0, nextAt - performance.now()))
  }

  function tick(): void {
    const now = performance.now()
    for (const lease of Array.from(activeLeases)) {
      if (lease.expiresAt !== null && now >= lease.expiresAt) {
        finishLease(lease, 'EXPIRED')
        continue
      }
      if (lease.scene && (
        lease.objects.some((object) => !isDescendantOf(object, lease.scene!)) ||
        lease.slots.some((slot) => !isDescendantOf(slot.mesh, lease.scene!))
      )) {
        finishLease(lease, 'EXPIRED')
        continue
      }
      for (const slot of lease.slots) {
        const layer = slot.layers.find((candidate) => candidate.lease === lease)
        if (!layer?.pulse || slot.layers[slot.layers.length - 1] !== layer || now < layer.nextPulseAt) continue
        layer.pulseOn = !layer.pulseOn
        layer.nextPulseAt = now + PULSE_PERIOD_MS
        applyLayer(slot, layer)
      }
    }
    scheduleNextTick()
  }

  function removeLeaseLayer(lease: LeaseRecord): void {
    for (const slot of lease.slots) {
      const index = slot.layers.findIndex((layer) => layer.lease === lease)
      if (index < 0) continue
      slot.layers.splice(index, 1)
      const top = slot.layers[slot.layers.length - 1]
      if (top) {
        applyLayer(slot, top)
      } else {
        setMaterialSlot(slot.mesh, slot.slot, slot.originalMaterial)
        slot.ownedMaterial.dispose()
        const meshSlots = slotStates.get(slot.mesh)
        meshSlots?.delete(slot.slot)
        if (meshSlots?.size === 0) {
          const arrayState = materialArrayStates.get(slot.mesh)
          if (arrayState) {
            slot.mesh.material = arrayState.original
            materialArrayStates.delete(slot.mesh)
          }
        }
      }
    }
  }

  function watchedObjects(lease: LeaseRecord): Set<THREE.Object3D> {
    const watched = new Set<THREE.Object3D>()
    if (!lease.scene) return watched
    for (const object of lease.objects) {
      for (let current: THREE.Object3D | null = object; current; current = current.parent) {
        if (current === lease.scene) break
        watched.add(current)
      }
    }
    for (const slot of lease.slots) watched.add(slot.mesh)
    return watched
  }

  function detachObjectListeners(lease: LeaseRecord, listener: () => void): void {
    for (const object of watchedObjects(lease)) object.removeEventListener('removed', listener)
  }

  function finishLease(lease: LeaseRecord, status: 'RELEASED' | 'EXPIRED'): boolean {
    if (lease.status !== 'ACTIVE') return false
    lease.status = status
    leases.delete(lease.handle)
    activeLeases.delete(lease)
    removeLeaseLayer(lease)
    const listener = leaseRemovalListeners.get(lease)
    if (listener) {
      detachObjectListeners(lease, listener)
      leaseRemovalListeners.delete(lease)
    }
    if (legacyLeases.size > 0) {
      for (const [object, legacyLease] of legacyLeases) {
        if (legacyLease === lease) legacyLeases.delete(object)
      }
    }
    scheduleNextTick()
    return true
  }

  const leaseRemovalListeners = new Map<LeaseRecord, () => void>()

  function ensureColor(color: HighlightOptions['color']): THREE.Color {
    try {
      return (color instanceof THREE.Color ? color : new THREE.Color(color ?? '#ff0000')).clone()
    } catch {
      throw new Error('[objectsTool] invalid highlight color')
    }
  }

  function apply(
    objects: readonly THREE.Object3D[],
    options: HighlightOptions = {},
    scoped = true,
  ): HighlightLease {
    if (!hasStrictShape(options, ['color', 'pulse', 'durationMs'])) {
      throw new Error('[objectsTool] highlight options contain unsupported fields')
    }
    if (!isStrictArray(objects, MAX_OBJECTS_PER_LEASE) || objects.length === 0) {
      throw new Error(`[objectsTool] highlight objects must contain 1-${MAX_OBJECTS_PER_LEASE} objects`)
    }
    if (scoped && !hasSspContext()) throw new Error('[objectsTool] context not initialized')
    const context = hasSspContext() ? getSspContext() : null
    const uniqueObjects = Array.from(new Set(objects))
    if (uniqueObjects.length !== objects.length) {
      throw new Error('[objectsTool] highlight objects must be unique')
    }
    const objectIds = uniqueObjects.map((object) => {
      if (!(object instanceof THREE.Object3D)) {
        throw new Error('[objectsTool] highlight object must be an Object3D')
      }
      if (scoped && (!context || !isDescendantOf(object, context.scene))) {
        throw new Error('[objectsTool] highlight object is not in the current scene')
      }
      if (scoped && (object instanceof THREE.Camera || object instanceof THREE.Light || object.name.startsWith('ssp_helper_'))) {
        throw new Error('[objectsTool] highlight object is not a scene model object')
      }
      const id = getObjectId(object)
      if (scoped && !id) throw new Error('[objectsTool] highlight object has no stable id')
      return id ?? object.uuid
    })
    const scene = scoped
      ? context!.scene
      : context && uniqueObjects.every((object) => isDescendantOf(object, context.scene))
        ? context.scene
        : null
    if (activeLeases.size >= MAX_ACTIVE_LEASES) {
      throw new Error(`[objectsTool] active highlight lease limit is ${MAX_ACTIVE_LEASES}`)
    }
    const pulse = options.pulse ?? false
    if (typeof pulse !== 'boolean') throw new Error('[objectsTool] pulse must be boolean')
    const durationMs = options.durationMs
    if (durationMs !== undefined && (!Number.isInteger(durationMs) || durationMs < 100 || durationMs > 300000)) {
      throw new Error('[objectsTool] durationMs must be an integer from 100 to 300000')
    }
    const color = ensureColor(options.color)
    const now = performance.now()
    const id = `highlight-${nextId++}`
    const provisional = {
      handle: undefined as unknown as HighlightLease,
      id,
      context,
      scene,
      scoped,
      objects: uniqueObjects,
      objectIds: Object.freeze(objectIds.slice()),
      slots: [] as SlotState[],
      expiresAt: durationMs === undefined ? null : now + durationMs,
      status: 'ACTIVE' as HighlightLeaseStatus,
    }
    const handle = createHandle(provisional)
    const record = provisional
    record.handle = handle
    knownHandles.add(handle)
    leases.set(handle, record)
    activeLeases.add(record)

    try {
      const touched = new Set<string>()
      for (const object of uniqueObjects) {
        object.traverse((child: THREE.Object3D) => {
          const mesh = child as THREE.Mesh
          if (!(mesh instanceof THREE.Mesh)) return
          meshMaterials(mesh).forEach((material, slot) => {
            const emissive = (material as THREE.Material & { emissive?: THREE.Color }).emissive
            if (!emissive) return
            const key = `${mesh.uuid}:${slot}`
            if (touched.has(key)) return
            touched.add(key)
            let meshSlots = slotStates.get(mesh)
            if (!meshSlots) {
              meshSlots = new Map()
              slotStates.set(mesh, meshSlots)
            }
            let state = meshSlots.get(slot)
            if (!state) {
              const ownedMaterial = material.clone()
              let createdArrayState: MaterialArrayState | null = null
              try {
                if (Array.isArray(mesh.material)) {
                  let arrayState = materialArrayStates.get(mesh)
                  if (!arrayState) {
                    arrayState = { original: mesh.material, owned: mesh.material.slice() }
                    mesh.material = arrayState.owned
                    materialArrayStates.set(mesh, arrayState)
                    createdArrayState = arrayState
                  }
                  arrayState.owned[slot] = ownedMaterial
                } else {
                  setMaterialSlot(mesh, slot, ownedMaterial)
                }
              } catch (error) {
                if (createdArrayState) {
                  try { mesh.material = createdArrayState.original } catch { /* preserve original failure */ }
                  materialArrayStates.delete(mesh)
                }
                ownedMaterial.dispose()
                throw error
              }
              state = { mesh, slot, originalMaterial: material, ownedMaterial, layers: [] }
              meshSlots.set(slot, state)
            }
            const layer: SlotLayer = {
              lease: record,
              color,
              pulse,
              pulseOn: true,
              nextPulseAt: now + PULSE_PERIOD_MS,
            }
            state.layers.push(layer)
            record.slots.push(state)
            applyLayer(state, layer)
          })
        })
      }

      if (record.scene) {
        const listener = () => {
          if (record.status !== 'ACTIVE' || !record.scene) return
          if (
            record.objects.some((object) => !isDescendantOf(object, record.scene!)) ||
            record.slots.some((slot) => !isDescendantOf(slot.mesh, record.scene!))
          ) {
            finishLease(record, 'EXPIRED')
          }
        }
        leaseRemovalListeners.set(record, listener)
        for (const object of watchedObjects(record)) object.addEventListener('removed', listener)
      }
      scheduleNextTick()
      return handle
    } catch (error) {
      finishLease(record, 'RELEASED')
      throw error
    }
  }

  function release(lease: HighlightLease): boolean {
    if ((typeof lease !== 'object' && typeof lease !== 'function') || lease === null || !knownHandles.has(lease)) {
      throw new Error('[objectsTool] invalid highlight lease handle')
    }
    const record = leases.get(lease)
    if (!record) return false
    if (record.handle !== lease) throw new Error('[objectsTool] invalid highlight lease handle')
    if (record.status !== 'ACTIVE') return false
    if (record.scoped) {
      if (
        !record.context || !record.scene || !hasSspContext() ||
        getSspContext() !== record.context || getSspContext().scene !== record.scene
      ) {
        finishLease(record, 'EXPIRED')
        return false
      }
      if (
        record.objects.some((object) => !isDescendantOf(object, record.scene!)) ||
        record.slots.some((slot) => !isDescendantOf(slot.mesh, record.scene!))
      ) {
        finishLease(record, 'EXPIRED')
        return false
      }
    }
    return finishLease(record, 'RELEASED')
  }

  function releaseAll(): void {
    for (const lease of Array.from(activeLeases)) finishLease(lease, 'RELEASED')
  }

  function releaseSceneBound(): void {
    for (const lease of Array.from(activeLeases)) {
      if (lease.scoped || lease.scene) finishLease(lease, 'RELEASED')
    }
  }

  function releaseLegacyForObject(object: THREE.Object3D): void {
    const lease = legacyLeases.get(object)
    if (!lease) return
    legacyLeases.delete(object)
    release(lease)
  }

  function getLegacyLease(object: THREE.Object3D): HighlightLease | undefined {
    return legacyLeases.get(object)
  }

  function setLegacyLease(object: THREE.Object3D, lease: HighlightLease): void {
    legacyLeases.set(object, lease)
  }

  registerSspContextCleanup(() => releaseSceneBound())

  return { apply, release, releaseAll, releaseSceneBound, releaseLegacyForObject, getLegacyLease, setLegacyLease }
}
