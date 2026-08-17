import * as THREE from 'three'
import { clearSspContext, setSspContext } from '../../ssp/core/context'
import { createObjectsTool, type ObjectsTool } from '../../ssp/objects/objectsTool'

type TestBody = () => void | Promise<void>

interface TestCase {
  name: string
  run: TestBody
}

type SceneQueryScalar = string | number | boolean | null
type SceneQueryField =
  | 'sid'
  | 'findId'
  | 'name'
  | 'renderType'
  | 'spaceType'
  | 'floorName'
  | 'building'
  | 'level'
  | 'floorType'
  | 'fireType'
type SceneDescriptorField =
  | 'sid'
  | 'findId'
  | 'floorName'
  | 'building'
  | 'level'
  | 'renderType'
  | 'renderTypeConfidence'
  | 'spaceType'
  | 'fireType'

type SceneQueryCondition =
  | { field: SceneQueryField; op: 'equals'; value: SceneQueryScalar }
  | { field: SceneQueryField; op: 'in'; values: readonly SceneQueryScalar[] }

interface ApprovedObjectsTool {
  query(
    criteria: { all?: readonly SceneQueryCondition[] },
    options: { limit: number },
  ): THREE.Object3D[]
  describe(
    objects: readonly THREE.Object3D[],
    options?: { fields?: readonly SceneDescriptorField[] },
  ): Array<{
    id: string
    name: string
    type: string
    visible: boolean
    metadata: Readonly<Record<string, SceneQueryScalar | readonly SceneQueryScalar[]>>
  }>
  applyHighlight(
    objects: readonly THREE.Object3D[],
    options?: { color?: string | number | THREE.Color; pulse?: boolean; durationMs?: number },
  ): HighlightLease
  releaseHighlight(lease: HighlightLease): boolean
  setHighlight(obj: THREE.Object3D, color?: string | number | THREE.Color, pulse?: boolean): void
  unHighlight(obj: THREE.Object3D): void
  clearAllHighlights(): void
}

interface HighlightLease {
  readonly id: string
  readonly objectIds: readonly string[]
  readonly status: 'ACTIVE' | 'RELEASED' | 'EXPIRED'
}

interface Fixture {
  scene: THREE.Scene
  root: THREE.Group
  objects: {
    doorA: THREE.Mesh
    doorB: THREE.Mesh
    windowA: THREE.Mesh
    doorAHidden: THREE.Mesh
    doorASecond: THREE.Mesh
  }
  sharedMaterial: THREE.MeshStandardMaterial
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function equal<T>(actual: T, expected: T, message: string): void {
  if (!Object.is(actual, expected)) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`)
  }
}

function deepEqual(actual: unknown, expected: unknown, message: string): void {
  const actualJson = JSON.stringify(actual)
  const expectedJson = JSON.stringify(expected)
  if (actualJson !== expectedJson) {
    throw new Error(`${message}: expected ${expectedJson}, got ${actualJson}`)
  }
}

function expectThrows(run: () => unknown, message: string): void {
  try {
    run()
  } catch {
    return
  }
  throw new Error(`${message}: expected an exception`)
}

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs))
}

function objectsTool(): ApprovedObjectsTool {
  return createObjectsTool() as unknown as ObjectsTool & ApprovedObjectsTool
}

function installContext(scene: THREE.Scene): void {
  setSspContext({
    scene,
    camera: new THREE.PerspectiveCamera(),
    renderer: {} as THREE.WebGLRenderer,
    domElement: {} as HTMLElement,
  })
}

function makeMesh(
  name: string,
  sid: string,
  material: THREE.MeshStandardMaterial,
  metadata: Record<string, unknown>,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material)
  mesh.name = name
  mesh.userData = { sid, ...metadata }
  return mesh
}

function makeFixture(): Fixture {
  const scene = new THREE.Scene()
  const root = new THREE.Group()
  root.name = 'fixture-root'
  const sharedMaterial = new THREE.MeshStandardMaterial({ emissive: 0x102030 })
  const doorA = makeMesh('DOOR_A_1', 'door-a', sharedMaterial, {
    findId: 'fixture-door-a',
    renderType: 'DOOR',
    building: 'A',
    floorName: 'A_1F',
    level: 1,
    floorType: 'FLOOR',
    tags: ['entry', 'fire-rated'],
    ignoredNested: { shouldNotEscape: true },
  })
  const doorB = makeMesh('DOOR_B_1', 'door-b', sharedMaterial, {
    findId: 'fixture-door-b',
    renderType: 'DOOR',
    building: 'B',
    floorName: 'B_1F',
    level: 1,
    floorType: 'FLOOR',
  })
  const windowA = makeMesh('WINDOW_A_1', 'window-a', new THREE.MeshStandardMaterial({ emissive: 0x203040 }), {
    findId: 'fixture-window-a',
    renderType: 'WINDOW',
    building: 'A',
    floorName: 'A_1F',
    level: 1,
    floorType: 'FLOOR',
  })
  const doorAHidden = makeMesh('DOOR_A_2', 'door-a-hidden', new THREE.MeshStandardMaterial({ emissive: 0x304050 }), {
    findId: 'fixture-door-a-hidden',
    renderType: 'DOOR',
    building: 'A',
    floorName: 'A_1F',
    level: 1,
    floorType: 'FLOOR',
  })
  doorAHidden.visible = false
  const doorASecond = makeMesh('DOOR_A_3', 'door-a-second', new THREE.MeshStandardMaterial({ emissive: 0x405060 }), {
    findId: 'fixture-door-a-second',
    renderType: 'DOOR',
    building: 'A',
    floorName: 'A_1F',
    level: 1,
    floorType: 'FLOOR',
  })
  root.add(doorA, doorB, windowA, doorAHidden, doorASecond)
  scene.add(root)
  installContext(scene)
  return { scene, root, objects: { doorA, doorB, windowA, doorAHidden, doorASecond }, sharedMaterial }
}

function emissiveHex(mesh: THREE.Mesh): number {
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
  const emissive = (material as THREE.MeshStandardMaterial).emissive
  return emissive.getHex()
}

function assertBoundedMetadata(metadata: Readonly<Record<string, unknown>>): void {
  for (const value of Object.values(metadata)) {
    if (Array.isArray(value)) {
      assert(value.length <= 50, 'metadata arrays must remain bounded')
      assert(value.every((item) => item === null || ['string', 'number', 'boolean'].includes(typeof item)), 'metadata arrays must contain scalars')
    } else {
      assert(value === null || ['string', 'number', 'boolean'].includes(typeof value), 'metadata must contain only scalars')
    }
  }
}

const tests: TestCase[] = [
  {
    name: 'query applies flat AND equals/in criteria, limit, and traversal order',
    run: () => {
      const fixture = makeFixture()
      const tool = objectsTool()
      const matches = tool.query(
        {
          all: [
            { field: 'renderType', op: 'equals', value: 'DOOR' },
            { field: 'building', op: 'in', values: ['A'] },
          ],
        },
        { limit: 2 },
      )
      deepEqual(matches.map((object) => object.userData.sid), ['door-a', 'door-a-hidden'], 'query must preserve scene traversal order')
      equal(tool.query({ all: [{ field: 'renderType', op: 'equals', value: 'DOOR' }] }, { limit: 1 }).length, 1, 'query must enforce limit')
      equal(tool.query({ all: [] }, { limit: 3 })[2], fixture.objects.windowA, 'query should stop at the requested traversal limit')
    },
  },
  {
    name: 'query rejects invalid limits, conditions, and values',
    run: () => {
      makeFixture()
      const tool = objectsTool()
      for (const limit of [0, 201, 1.5, Number.NaN]) {
        expectThrows(() => tool.query({}, { limit }), `invalid limit ${String(limit)} must fail`)
      }
      expectThrows(() => tool.query({}, {} as { limit: number }), 'missing limit must fail')
      expectThrows(
        () => tool.query({ all: [{ field: 'renderType', op: 'startsWith', value: 'DOOR' } as never] }, { limit: 1 }),
        'unsupported condition operator must fail',
      )
      expectThrows(
        () => tool.query({ all: [{ field: 'notAField', op: 'equals', value: 'DOOR' } as never] }, { limit: 1 }),
        'unknown condition field must fail',
      )
      expectThrows(
        () => tool.query({ all: Array.from({ length: 9 }, () => ({ field: 'renderType', op: 'equals', value: 'DOOR' })) as never }, { limit: 1 }),
        'more than eight conditions must fail',
      )
      expectThrows(
        () => tool.query({ all: [{ field: 'renderType', op: 'in', values: Array.from({ length: 51 }, (_, index) => String(index)) }] }, { limit: 1 }),
        'more than fifty in-values must fail',
      )
      expectThrows(
        () => tool.query({ all: [{ field: 'renderType', op: 'equals', value: { nested: true } as never }] }, { limit: 1 }),
        'object condition values must fail',
      )
      expectThrows(
        () => tool.query({ all: [{ field: 'renderType', op: 'equals', value: 'x'.repeat(257) }] }, { limit: 1 }),
        'overlong string condition values must fail',
      )
      expectThrows(
        () => tool.query({ all: [{ and: [] } as never] }, { limit: 1 }),
        'nested boolean conditions must fail',
      )
      expectThrows(
        () => tool.query({ or: [] } as never, { limit: 1 }),
        'unknown top-level query operators must fail',
      )
      expectThrows(
        () => tool.query({}, { limit: 1, offset: 1 } as never),
        'unapproved query options must fail',
      )
      expectThrows(
        () => tool.query(Object.create({ all: [] }), Object.create({ limit: 1 })),
        'inherited query fields must fail',
      )
      const hiddenOption = { limit: 1 }
      Object.defineProperty(hiddenOption, 'offset', { value: 1, enumerable: false })
      expectThrows(() => tool.query({}, hiddenOption), 'non-enumerable query fields must fail')
      const inheritedConditions = new Array(1)
      Object.setPrototypeOf(inheritedConditions, Object.assign(Object.create(Array.prototype), {
        0: { field: 'renderType', op: 'equals', value: 'DOOR' },
      }))
      expectThrows(
        () => tool.query({ all: inheritedConditions }, { limit: 1 }),
        'inherited condition array elements must fail',
      )
      const inheritedValues = new Array(1)
      Object.setPrototypeOf(inheritedValues, Object.assign(Object.create(Array.prototype), { 0: 'DOOR' }))
      expectThrows(
        () => tool.query({ all: [{ field: 'renderType', op: 'in', values: inheritedValues }] }, { limit: 1 }),
        'inherited in-values must fail',
      )
      let accessorRead = false
      const accessorConditions = new Array(1)
      Object.defineProperty(accessorConditions, '0', {
        get: () => {
          accessorRead = true
          return { field: 'renderType', op: 'equals', value: 'DOOR' }
        },
      })
      expectThrows(
        () => tool.query({ all: accessorConditions }, { limit: 1 }),
        'array accessors must fail',
      )
      equal(accessorRead, false, 'strict array validation must reject accessors without invoking them')
    },
  },
  {
    name: 'describe projects bounded fields and rejects foreign objects atomically',
    run: () => {
      const fixture = makeFixture()
      const tool = objectsTool()
      const described = tool.describe([fixture.objects.doorA, fixture.objects.windowA], {
        fields: ['renderType', 'building'],
      })
      equal(described.length, 2, 'describe should return one descriptor per object')
      deepEqual(Object.keys(described[0]), ['id', 'name', 'type', 'visible', 'metadata'], 'describe should return bounded descriptor fields')
      equal(described[0].id, 'door-a', 'descriptor id should use the approved object identity')
      equal(described[0].name, 'DOOR_A_1', 'descriptor name')
      assert(described[0].type.length > 0, 'descriptor type should be bounded and non-empty')
      equal(described[0].visible, true, 'descriptor visible')
      deepEqual(Object.keys(described[0].metadata), ['renderType', 'building'], 'describe fields should bound metadata projection')
      assertBoundedMetadata(described[0].metadata)
      assert(!('ignoredNested' in described[0].metadata), 'descriptor metadata must not expose nested arbitrary userData')

      const foreign = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial())
      foreign.name = 'FOREIGN'
      foreign.userData = { sid: 'foreign' }
      expectThrows(() => tool.describe([fixture.objects.doorA, foreign]), 'foreign object must reject the entire describe call')
      equal(tool.describe([fixture.objects.doorA])[0].id, 'door-a', 'failed foreign describe must not poison later calls')
      expectThrows(() => tool.describe(Array.from({ length: 201 }, () => fixture.objects.doorA)), 'more than 200 objects must fail atomically')
      expectThrows(() => tool.describe([fixture.objects.doorA], { fields: Array.from({ length: 17 }, () => 'renderType') as unknown as SceneDescriptorField[] }), 'more than 16 fields must fail')
      const inheritedFields = new Array(1)
      Object.setPrototypeOf(inheritedFields, Object.assign(Object.create(Array.prototype), { 0: 'renderType' }))
      expectThrows(
        () => tool.describe([fixture.objects.doorA], { fields: inheritedFields as SceneDescriptorField[] }),
        'inherited describe fields must fail',
      )
    },
  },
  {
    name: 'overlapping leases use last-applied priority and older expiry cannot override newer',
    run: async () => {
      const fixture = makeFixture()
      const tool = objectsTool()
      const older = tool.applyHighlight([fixture.objects.doorA], { color: '#ff0000', durationMs: 100 })
      const newer = tool.applyHighlight([fixture.objects.doorA], { color: '#0000ff', durationMs: 1000 })
      equal(older.status, 'ACTIVE', 'older lease starts active')
      equal(newer.status, 'ACTIVE', 'newer lease starts active')
      equal(emissiveHex(fixture.objects.doorA), 0x0000ff, 'newer lease should be visible')
      await wait(160)
      equal(older.status, 'EXPIRED', 'older lease should expire')
      equal(newer.status, 'ACTIVE', 'newer lease must survive older expiry')
      equal(emissiveHex(fixture.objects.doorA), 0x0000ff, 'older expiry must not override newer visual state')
      equal(tool.releaseHighlight(newer), true, 'newer lease explicit release')
      equal(emissiveHex(fixture.objects.doorA), 0x102030, 'last lease release restores original emissive')
    },
  },
  {
    name: 'leases are opaque, explicitly releasable, and idempotent after release or expiry',
    run: async () => {
      const fixture = makeFixture()
      const tool = objectsTool()
      const lease = tool.applyHighlight([fixture.objects.doorA], { color: 0xff8800 })
      assert(typeof lease.id === 'string' && lease.id.length > 0, 'lease should expose an opaque identity')
      deepEqual(lease.objectIds, ['door-a'], 'lease should identify its owned object ids')
      expectThrows(() => tool.releaseHighlight({ ...lease }), 'copied lease handle must be rejected')
      equal(emissiveHex(fixture.objects.doorA), 0xff8800, 'forged release must not mutate the highlight')
      equal(tool.releaseHighlight(lease), true, 'first explicit release should succeed')
      equal(tool.releaseHighlight(lease), false, 'repeated explicit release should be idempotent')
      equal(lease.status, 'RELEASED', 'released lease status should be monotonic')

      const expiring = tool.applyHighlight([fixture.objects.doorA], { color: 0x00aa00, durationMs: 100 })
      await wait(160)
      equal(expiring.status, 'EXPIRED', 'duration should expire the lease')
      equal(tool.releaseHighlight(expiring), false, 'release after expiry should be idempotent')
      equal(emissiveHex(fixture.objects.doorA), 0x102030, 'expired lease should restore original emissive')
    },
  },
  {
    name: 'shared materials use clone-on-write and dispose clones after restoration',
    run: () => {
      const fixture = makeFixture()
      const tool = objectsTool()
      const originalMaterial = fixture.sharedMaterial
      let cloneDisposeCount = 0
      const lease = tool.applyHighlight([fixture.objects.doorA], { color: '#abcdef' })
      const clonedMaterial = fixture.objects.doorA.material as THREE.MeshStandardMaterial
      clonedMaterial.addEventListener('dispose', () => { cloneDisposeCount += 1 })
      assert(clonedMaterial !== originalMaterial, 'highlighting one user of a shared material must clone on write')
      equal(fixture.objects.doorB.material, originalMaterial, 'unselected shared-material user must retain original reference')
      equal(emissiveHex(fixture.objects.doorB), 0x102030, 'unselected shared-material user must retain original color')
      equal(tool.releaseHighlight(lease), true, 'shared-material lease release')
      equal(fixture.objects.doorA.material, originalMaterial, 'release should restore original material reference')
      equal(cloneDisposeCount, 1, 'SSP-owned material clone should be disposed exactly once')
    },
  },
  {
    name: 'shared material arrays are isolated and their original references are restored',
    run: () => {
      const fixture = makeFixture()
      const tool = objectsTool()
      const first = new THREE.MeshStandardMaterial({ emissive: 0x111111 })
      const second = new THREE.MeshStandardMaterial({ emissive: 0x222222 })
      const sharedArray = [first, second]
      const selected = makeMesh('ARRAY_SELECTED', 'array-selected', first, {})
      const untouched = makeMesh('ARRAY_UNTOUCHED', 'array-untouched', first, {})
      selected.material = sharedArray
      untouched.material = sharedArray
      fixture.root.add(selected, untouched)

      const lease = tool.applyHighlight([selected], { color: '#abcdef' })
      assert(selected.material !== sharedArray, 'selected mesh must receive its own material array')
      equal(untouched.material, sharedArray, 'unselected mesh must retain the shared array reference')
      equal((untouched.material as THREE.Material[])[0], first, 'unselected material slot must remain unchanged')
      equal(tool.releaseHighlight(lease), true, 'array-backed lease release')
      equal(selected.material, sharedArray, 'release must restore the original material array reference')
    },
  },
  {
    name: 'failed material preparation rolls back earlier slots and does not consume lease capacity',
    run: () => {
      const fixture = makeFixture()
      const tool = objectsTool()
      const goodMaterial = new THREE.MeshStandardMaterial({ emissive: 0x123456 })
      const badMaterial = new THREE.MeshStandardMaterial({ emissive: 0x654321 })
      badMaterial.clone = (() => { throw new Error('intentional clone failure') }) as typeof badMaterial.clone
      const good = makeMesh('ROLLBACK_GOOD', 'rollback-good', goodMaterial, {})
      const bad = makeMesh('ROLLBACK_BAD', 'rollback-bad', badMaterial, {})
      const group = new THREE.Group()
      group.userData.sid = 'rollback-group'
      group.add(good, bad)
      fixture.root.add(group)

      expectThrows(() => tool.applyHighlight([group]), 'material clone failure must reject atomically')
      equal(good.material, goodMaterial, 'earlier material mutation must be restored after failure')
      const leases = Array.from({ length: 128 }, () => tool.applyHighlight([fixture.objects.doorA]))
      equal(leases.length, 128, 'failed apply must not consume active lease capacity')
      tool.clearAllHighlights()
    },
  },
  {
    name: 'highlight limits are enforced and a newer pulse reschedules the shared timer',
    run: async () => {
      const fixture = makeFixture()
      const tool = objectsTool()
      for (const durationMs of [99, 300001, 100.5]) {
        expectThrows(
          () => tool.applyHighlight([fixture.objects.doorA], { durationMs }),
          `invalid duration ${String(durationMs)} must fail`,
        )
      }

      const manyObjects = Array.from({ length: 257 }, (_, index) => {
        const object = new THREE.Object3D()
        object.userData.sid = `limit-${index}`
        fixture.root.add(object)
        return object
      })
      expectThrows(() => tool.applyHighlight(manyObjects), 'more than 256 objects must fail')

      const active = Array.from({ length: 128 }, () => tool.applyHighlight([fixture.objects.doorA]))
      expectThrows(() => tool.applyHighlight([fixture.objects.doorA]), 'more than 128 active leases must fail')
      tool.clearAllHighlights()
      assert(active.every((lease) => lease.status === 'RELEASED'), 'global cleanup should release every active lease')

      const long = tool.applyHighlight([fixture.objects.doorA], { color: '#ff0000', durationMs: 1000 })
      const pulsing = tool.applyHighlight([fixture.objects.doorA], { color: '#0000ff', pulse: true })
      await wait(560)
      equal(emissiveHex(fixture.objects.doorA), 0x000000, 'new top pulse must reschedule an earlier manager tick')
      equal(tool.releaseHighlight(pulsing), true, 'pulsing lease release')
      equal(emissiveHex(fixture.objects.doorA), 0xff0000, 'underlying timed lease should reappear')
      equal(tool.releaseHighlight(long), true, 'underlying lease release')
    },
  },
  {
    name: 'root removal and clearSspContext clean active leases and owned material clones',
    run: () => {
      const fixture = makeFixture()
      const tool = objectsTool()
      const lease = tool.applyHighlight([fixture.objects.doorA], { color: '#ff00ff' })
      const clonedMaterial = fixture.objects.doorA.material as THREE.MeshStandardMaterial
      let cloneDisposeCount = 0
      clonedMaterial.addEventListener('dispose', () => { cloneDisposeCount += 1 })
      fixture.scene.remove(fixture.root)
      equal(lease.status, 'EXPIRED', 'removing a model root should expire its leases')
      equal(fixture.objects.doorA.material, fixture.sharedMaterial, 'root removal should restore shared material')
      equal(cloneDisposeCount, 1, 'root removal should dispose owned clones')

      const second = makeFixture()
      const secondTool = objectsTool()
      const secondLease = secondTool.applyHighlight([second.objects.doorA], { color: '#00ffff' })
      clearSspContext()
      equal(secondLease.status, 'RELEASED', 'clearSspContext should release active leases')
      equal(second.objects.doorA.material, second.sharedMaterial, 'clearSspContext should restore original material')
    },
  },
  {
    name: 'child mesh removal and same-context scene replacement clean active leases',
    run: () => {
      const fixture = makeFixture()
      const tool = objectsTool()
      const group = new THREE.Group()
      group.userData.sid = 'watched-group'
      const material = new THREE.MeshStandardMaterial({ emissive: 0x313233 })
      const child = makeMesh('WATCHED_CHILD', 'watched-child', material, {})
      group.add(child)
      fixture.root.add(group)
      const childLease = tool.applyHighlight([group], { color: '#ff00ff' })
      group.remove(child)
      equal(childLease.status, 'EXPIRED', 'removing a highlighted child mesh must expire its lease')
      equal(child.material, material, 'child removal must restore its original material')

      const context = {
        scene: fixture.scene,
        camera: new THREE.PerspectiveCamera(),
        renderer: {} as THREE.WebGLRenderer,
        domElement: {} as HTMLElement,
      }
      setSspContext(context)
      const sceneLease = tool.applyHighlight([fixture.objects.doorA], { color: '#00ffff' })
      context.scene = new THREE.Scene()
      setSspContext(context)
      equal(sceneLease.status, 'RELEASED', 'reusing a context object with a new scene must run cleanup')
      equal(fixture.objects.doorA.material, fixture.sharedMaterial, 'scene replacement must restore original material')
    },
  },
  {
    name: 'legacy highlighting remains compatible without a context or scene attachment',
    run: () => {
      clearSspContext()
      const tool = objectsTool()
      const original = new THREE.MeshStandardMaterial({ emissive: 0x010203 })
      const detached = new THREE.Mesh(new THREE.BufferGeometry(), original)
      tool.setHighlight(detached, '#aabbcc')
      equal(emissiveHex(detached), 0xaabbcc, 'detached legacy object should highlight without context')
      installContext(new THREE.Scene())
      clearSspContext()
      equal(emissiveHex(detached), 0xaabbcc, 'unrelated context cleanup must not release detached legacy state')
      tool.unHighlight(detached)
      equal(detached.material, original, 'detached legacy object should restore its original material')
      equal(emissiveHex(detached), 0x010203, 'detached legacy object should restore its emissive value')
    },
  },
  {
    name: 'legacy setUnHighlight and clearAll coexist with lease-owned visual state',
    run: () => {
      const fixture = makeFixture()
      const tool = objectsTool()
      tool.setHighlight(fixture.objects.doorA, '#ff0000')
      const lease = tool.applyHighlight([fixture.objects.doorA], { color: '#0000ff' })
      equal(emissiveHex(fixture.objects.doorA), 0x0000ff, 'lease should be the last-applied visual owner')
      tool.unHighlight(fixture.objects.doorA)
      equal(emissiveHex(fixture.objects.doorA), 0x0000ff, 'legacy unHighlight must not release an active lease')
      equal(tool.releaseHighlight(lease), true, 'lease remains explicitly releasable after legacy unHighlight')
      equal(emissiveHex(fixture.objects.doorA), 0x102030, 'releasing the lease should restore the true original')

      tool.setHighlight(fixture.objects.doorA, '#00ff00')
      const retained = tool.applyHighlight([fixture.objects.doorA], { color: '#ffffff' })
      tool.clearAllHighlights()
      equal(retained.status, 'RELEASED', 'host emergency clearAllHighlights should release scoped leases too')
      equal(emissiveHex(fixture.objects.doorA), 0x102030, 'global emergency cleanup must restore the original baseline')
      equal(tool.releaseHighlight(retained), false, 'globally released lease should remain idempotent')
    },
  },
]

export interface ObjectsToolSuiteResult {
  passed: number
  names: readonly string[]
  durationMs: number
}

export async function runObjectsToolSuite(): Promise<ObjectsToolSuiteResult> {
  const startedAt = performance.now()
  const names: string[] = []
  for (const test of tests) {
    try {
      await test.run()
      names.push(test.name)
      console.log(`[objects:test] PASS ${test.name}`)
    } catch (error) {
      const detail = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)
      throw new Error(`[objects:test] FAIL ${test.name}\n${detail}`)
    } finally {
      clearSspContext()
    }
  }
  return {
    passed: names.length,
    names,
    durationMs: performance.now() - startedAt,
  }
}
