import { failure } from './diagnostics'
import type { Metadata33Projection, PackageFloor, PackageParseResult } from './types'

const RT = new Set(['WINDOW', 'DOOR', 'ELEVATOR', 'STAIR', 'CEILING', 'WALL', 'SPACE', 'FACILITY'])
const FT = new Set(['FLOOR', 'TOWER', 'ROOF', 'BASEMENT', 'LANDSCAPE_TERRAIN', 'LANDSCAPE_FACADE', 'FACILITY'])
const SP = new Set(['TOILET', 'LAUNDRY', 'KITCHEN', 'OFFICE', 'MEETING_ROOM', 'BEDROOM', 'CORRIDOR', 'STAIRWELL', 'ELEVATOR_HALL', 'MECHANICAL_ROOM', 'STORAGE', 'LOBBY', 'BALCONY'])
const DIR = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
const DIRECTIONAL_RT = new Set(['DOOR', 'WINDOW', 'ELEVATOR', 'STAIR'])
const FIRE = new Set(['HYDRANT', 'SMOKE_DETECTOR', 'SPRINKLER', 'EXTINGUISHER', 'EMERGENCY_LIGHT', 'EXIT_SIGN', 'BREAK_GLASS', 'ALARM_BELL', 'FIRE_HOSE', 'FIRE_DOOR', 'OTHER'])
const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])
const NODE_SEMANTIC_FIELDS = [
  'name',
  'sid',
  'findId',
  'renderType',
  'renderTypeConfidence',
  'floorName',
  'building',
  'level',
  'floorType',
  'spaceType',
  'fireType',
  'direction',
] as const
const u32 = (b: Uint8Array, a: number) => (b[a]! | b[a + 1]! << 8 | b[a + 2]! << 16 | b[a + 3]! << 24) >>> 0
const rec = (v: unknown): Record<string, any> | null => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : null
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const bad = (path: string, reason: string, uri?: string, assetId?: string) => failure('PACKAGE_METADATA_INVALID', 'METADATA', path, { reason }, { manifestUri: uri, assetId })
function sidMatches(sid: string, e: Record<string, any>): boolean {
  const type = e.renderType; const floor = e.floorName; if (typeof type !== 'string' || typeof floor !== 'string' || !sid.startsWith(`${type}_${floor}_`)) return false
  const suffix = sid.slice(`${type}_${floor}_`.length); const seq = (v: string) => /^(?:0[1-9]|[1-9]\d+)$/u.test(v)
  if (type === 'FACILITY') return typeof e.fireType === 'string' && FIRE.has(e.fireType) && suffix.startsWith(`${e.fireType}_`) && seq(suffix.slice(e.fireType.length + 1))
  if (type === 'SPACE') return typeof e.spaceType === 'string' && SP.has(e.spaceType) && suffix.startsWith(`${e.spaceType}_`) && seq(suffix.slice(e.spaceType.length + 1))
  if (type === 'CEILING') return suffix === 'LOWER' || suffix === 'UPPER' || suffix.startsWith('SLAB_') && seq(suffix.slice(5))
  if (type === 'WALL') return seq(suffix)
  if (!DIRECTIONAL_RT.has(type) || typeof e.direction !== 'string' || !DIR.includes(e.direction)) return false
  return suffix.startsWith(`${e.direction}_`) && seq(suffix.slice(e.direction.length + 1))
}

function hasNodeSemanticField(extras: Record<string, any>): boolean {
  return NODE_SEMANTIC_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(extras, field))
}

export interface Metadata33ValidationPolicy {
  readonly forbidEmbeddedTopology?: boolean
}

export function parseMetadata33Glb(bytes: Uint8Array, expected: PackageFloor, manifestUri?: string, assetId?: string, policy: Metadata33ValidationPolicy = {}): PackageParseResult<Metadata33Projection> {
  if (bytes.byteLength < 12 || u32(bytes, 0) !== 0x46546c67 || u32(bytes, 4) !== 2 || u32(bytes, 8) !== bytes.byteLength) return bad('/', 'invalid-glb-header', manifestUri, assetId)
  let at = 12; let json: Uint8Array | null = null; let bin: Uint8Array | null = null; let prior = 0
  while (at < bytes.byteLength) { if (at + 8 > bytes.byteLength) return bad('/', 'truncated-chunk', manifestUri, assetId); const length = u32(bytes, at); const type = u32(bytes, at + 4); if ((length & 3) || at + 8 + length > bytes.byteLength || (type !== 0x4e4f534a && type !== 0x004e4942) || prior === 0x004e4942) return bad('/', 'chunk-order-or-type', manifestUri, assetId); const chunk = bytes.subarray(at + 8, at + 8 + length); if (type === 0x4e4f534a) { if (json) return bad('/', 'duplicate-json-chunk', manifestUri, assetId); json = chunk } else { if (bin) return bad('/', 'duplicate-bin-chunk', manifestUri, assetId); bin = chunk }; prior = type; at += 8 + length }
  if (!json || !bin) return bad('/', 'missing-json-or-bin-chunk', manifestUri, assetId)
  let gltf: Record<string, any> | null = null; try { gltf = rec(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(json))) } catch { return bad('/', 'invalid-json', manifestUri, assetId) }
  if (!gltf || rec(gltf.asset)?.version !== '2.0') return bad('/asset', 'gltf-version', manifestUri, assetId)
  if (!Array.isArray(gltf.buffers) || gltf.buffers.length !== 1 || gltf.buffers.some((v) => { const b = rec(v); return !b || b.uri !== undefined || !Number.isInteger(b.byteLength) || (b.byteLength as number) < 0 || (b.byteLength as number) > bin!.byteLength || bin!.byteLength - (b.byteLength as number) > 3 })) return bad('/buffers', 'external-or-missing-buffer', manifestUri, assetId)
  if (gltf.images !== undefined && (!Array.isArray(gltf.images) || gltf.images.some((v) => { const i = rec(v); if (!i) return true; const hasUri = Object.prototype.hasOwnProperty.call(i, 'uri'); const hasView = Object.prototype.hasOwnProperty.call(i, 'bufferView'); if (hasUri === hasView) return true; if (hasUri) return typeof i.uri !== 'string' || !/^data:image\/(?:jpeg|png|webp)(?:;[^,]*)?,/iu.test(i.uri) || i.mimeType !== undefined; return !IMAGE_MIME.has(i.mimeType) }))) return bad('/images', 'external-image-uri', manifestUri, assetId)
  const componentBytes: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }; const typeComponents: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }
  const buffers = gltf.buffers as Record<string, any>[]; const bufferViews = gltf.bufferViews; const accessors = gltf.accessors
  if (bufferViews !== undefined && (!Array.isArray(bufferViews) || bufferViews.some((value) => { const view = rec(value); const offset = view?.byteOffset ?? 0; const stride = view?.byteStride; if (!view || view.buffer !== 0 || !Number.isInteger(view.byteLength) || (view.byteLength as number) < 0 || !Number.isInteger(offset) || offset < 0 || offset % 4 !== 0) return true; if (stride !== undefined && (!Number.isInteger(stride) || stride < 4 || stride > 252 || stride % 4 !== 0)) return true; return offset + (view.byteLength as number) > buffers[0]!.byteLength }))) return bad('/bufferViews', 'buffer-view-bounds', manifestUri, assetId)
  if (!Array.isArray(accessors) || accessors.some((value) => { const accessor = rec(value); if (!accessor || !Number.isInteger(accessor.componentType) || componentBytes[accessor.componentType] === undefined || typeof accessor.type !== 'string' || typeComponents[accessor.type] === undefined || !Number.isInteger(accessor.count) || (accessor.count as number) < 0 || accessor.bufferView === undefined) return true; if (!Array.isArray(bufferViews) || !Number.isInteger(accessor.bufferView) || accessor.bufferView < 0 || accessor.bufferView >= bufferViews.length) return true; const view = rec(bufferViews[accessor.bufferView]); const offset = accessor.byteOffset ?? 0; const stride = view?.byteStride as number | undefined; const element = componentBytes[accessor.componentType] * typeComponents[accessor.type]; if (!Number.isInteger(offset) || (offset as number) < 0 || (offset as number) % componentBytes[accessor.componentType] !== 0 || (stride !== undefined && (!Number.isInteger(stride) || stride < element))) return true; const required = (accessor.count as number) === 0 ? 0 : ((accessor.count as number) - 1) * (stride ?? element) + element; return (offset as number) + required > (view?.byteLength as number ?? 0) })) return bad('/accessors', 'accessor-bounds', manifestUri, assetId)
  const validAccessor = (value: unknown) => Array.isArray(accessors) && Number.isInteger(value) && (value as number) >= 0 && (value as number) < accessors.length
  const validView = (value: unknown) => Array.isArray(bufferViews) && Number.isInteger(value) && (value as number) >= 0 && (value as number) < bufferViews.length
  if (Array.isArray(gltf.images) && gltf.images.some((value) => { const image = rec(value); return image?.bufferView !== undefined && !validView(image.bufferView) })) return bad('/images', 'image-buffer-view', manifestUri, assetId)
  if (Array.isArray(gltf.meshes) && gltf.meshes.some((value) => { const mesh = rec(value); if (!mesh || !Array.isArray(mesh.primitives) || mesh.primitives.length === 0) return true; return mesh.primitives.some((primitiveValue) => { const primitive = rec(primitiveValue); const attributes = primitive ? rec(primitive.attributes) : null; if (!primitive || !attributes || !validAccessor(attributes.POSITION)) return true; const position = Array.isArray(accessors) ? rec(accessors[attributes.POSITION as number]) : null; if (!position || position.componentType !== 5126 || position.type !== 'VEC3' || !Number.isInteger(position.count) || position.count < 1) return true; if (primitive.indices !== undefined) { const index = Array.isArray(accessors) && validAccessor(primitive.indices) ? rec(accessors[primitive.indices as number]) : null; if (!index || ![5121, 5123, 5125].includes(index.componentType as number) || index.type !== 'SCALAR' || !Number.isInteger(index.count) || index.count < 1) return true }; if (primitive.mode !== undefined && (!Number.isInteger(primitive.mode) || primitive.mode < 0 || primitive.mode > 6)) return true; if (primitive.material !== undefined && (!Array.isArray(gltf.materials) || !Number.isInteger(primitive.material) || primitive.material < 0 || primitive.material >= gltf.materials.length)) return true; return Object.values(attributes).some((accessor) => !validAccessor(accessor)) }) })) return bad('/meshes', 'mesh-primitive-reference', manifestUri, assetId)
  const scenes = gltf.scenes; const nodes = gltf.nodes; if (!Array.isArray(scenes) || scenes.length !== 1 || !Array.isArray(nodes) || gltf.scene !== 0) return bad('/', 'scene-graph-missing', manifestUri, assetId)
  const scene = rec(scenes[0]); const sx = scene ? rec(scene.extras) : null; if (!scene || !sx) return bad('/scenes/0/extras', 'scene-extras-missing', manifestUri, assetId)
  if (policy.forbidEmbeddedTopology && Object.prototype.hasOwnProperty.call(sx, 'sspTopology')) return failure('PACKAGE_EMBEDDED_TOPOLOGY_FORBIDDEN', 'METADATA', '/scenes/0/extras/sspTopology', {}, { manifestUri, assetId })
  if (['sid', 'findId', 'renderType', 'spaceType', 'fireType', 'node', 'nodes'].some((k) => k in sx)) return bad('/scenes/0/extras', 'scene-node-fields', manifestUri, assetId)
  const floor: PackageFloor & { name: string } = { floorName: sx.floorName as string, building: sx.building as string | null, level: sx.level as number | null, floorType: sx.floorType as string, name: sx.name as string }
  if (!text(floor.floorName) || !text(floor.name) || !FT.has(floor.floorType) || !(floor.building === null || text(floor.building)) || !(floor.level === null || Number.isInteger(floor.level))) return bad('/scenes/0/extras', 'scene-floor-fields', manifestUri, assetId)
  if (floor.floorType.startsWith('LANDSCAPE_')
    ? floor.building !== null || floor.level !== null
    : floor.building === null || (floor.level === null && floor.floorType !== 'TOWER' && floor.floorType !== 'ROOF')) return bad('/scenes/0/extras', 'floor-identity', manifestUri, assetId)
  for (const key of ['floorName', 'building', 'level', 'floorType'] as const) if (!Object.is(floor[key], expected[key])) return failure('PACKAGE_METADATA_INVALID', 'METADATA', `/scenes/0/extras/${key}`, { reason: 'manifest-floor-mismatch' }, { manifestUri, assetId })
  const roots = scene.nodes; if (!Array.isArray(roots) || roots.some((n) => !Number.isInteger(n) || n < 0 || n >= nodes.length)) return bad('/scenes/0/nodes', 'invalid-root-node', manifestUri, assetId)
  const referencedMeshes = new Set<number>()
  for (let ni = 0; ni < nodes.length; ni += 1) { const node = rec(nodes[ni]); if (!node) return bad(`/nodes/${ni}`, 'node-invalid', manifestUri, assetId); if (node.children !== undefined && (!Array.isArray(node.children) || node.children.some((n) => !Number.isInteger(n) || n < 0 || n >= nodes.length))) return bad(`/nodes/${ni}/children`, 'child-invalid', manifestUri, assetId); const nodeExtras = rec(node.extras); if (node.mesh === undefined && nodeExtras && hasNodeSemanticField(nodeExtras)) return bad(`/nodes/${ni}/extras`, 'non-mesh-semantic-fields', manifestUri, assetId); if (node.mesh !== undefined && (!Number.isInteger(node.mesh) || !Array.isArray(gltf.meshes) || node.mesh < 0 || node.mesh >= gltf.meshes.length)) return bad(`/nodes/${ni}/mesh`, 'mesh-invalid', manifestUri, assetId); if (node.mesh !== undefined) referencedMeshes.add(node.mesh as number) }
  if (Array.isArray(gltf.meshes) && gltf.meshes.some((_mesh, index) => !referencedMeshes.has(index))) return bad('/meshes', 'unreferenced-mesh', manifestUri, assetId)
  const seen = new Set<number>(); const active = new Set<number>(); const projected: Metadata33Projection['nodes'][number][] = []; const sids = new Set<string>(); const finds = new Set<string>()
  for (let index = 0; index < nodes.length; index += 1) { const node = rec(nodes[index]); const extras = node ? rec(node.extras) : null; if (node?.mesh !== undefined && extras && '_editorEntityId' in extras) return bad(`/nodes/${index}/extras`, 'editor-field', manifestUri, assetId) }
  const visit = (index: number): PackageParseResult<null> => { if (active.has(index)) return bad(`/nodes/${index}`, 'node-cycle', manifestUri, assetId); if (seen.has(index)) return { ok: true, value: null }; const node = rec(nodes[index]); if (!node) return bad(`/nodes/${index}`, 'node-invalid', manifestUri, assetId); active.add(index); seen.add(index); if (node.children !== undefined && (!Array.isArray(node.children) || node.children.some((n) => !Number.isInteger(n) || n < 0 || n >= nodes.length))) return bad(`/nodes/${index}/children`, 'child-invalid', manifestUri, assetId)
    if (node.mesh !== undefined) { if (!Number.isInteger(node.mesh) || node.mesh < 0 || !Array.isArray(gltf.meshes) || node.mesh >= gltf.meshes.length) return bad(`/nodes/${index}/mesh`, 'mesh-invalid', manifestUri, assetId); const e = rec(node.extras); if (!e || !text(e.name) || !text(e.sid) || !text(e.findId) || !text(e.renderType) || !text(e.floorName) || !(e.building === null || text(e.building)) || !(e.level === null || Number.isInteger(e.level)) || !text(e.floorType) || (e.renderTypeConfidence !== 'high' && e.renderTypeConfidence !== 'low')) return bad(`/nodes/${index}/extras`, 'mesh-extras-missing', manifestUri, assetId); if (!RT.has(e.renderType) || !sidMatches(e.sid, e) || e.floorName !== floor.floorName || e.building !== floor.building || e.level !== floor.level || e.floorType !== floor.floorType) return bad(`/nodes/${index}/extras`, 'mesh-extras-invalid', manifestUri, assetId); if (e.findId !== `${floor.floorName}_mesh_${index}`) return bad(`/nodes/${index}/extras/findId`, 'findId-mismatch', manifestUri, assetId); if (sids.has(e.sid) || finds.has(e.findId)) return bad(`/nodes/${index}/extras`, 'duplicate-identity', manifestUri, assetId); sids.add(e.sid); finds.add(e.findId); if (e.renderType === 'SPACE' && (typeof e.spaceType !== 'string' || !SP.has(e.spaceType))) return bad(`/nodes/${index}/extras/spaceType`, 'space-type', manifestUri, assetId); if (e.renderType === 'FACILITY' && (typeof e.fireType !== 'string' || !FIRE.has(e.fireType))) return bad(`/nodes/${index}/extras/fireType`, 'fire-type', manifestUri, assetId); projected.push(Object.freeze({ index, name: e.name, sid: e.sid, findId: e.findId, renderType: e.renderType, renderTypeConfidence: e.renderTypeConfidence as 'high' | 'low', floorName: e.floorName, building: e.building as string | null, level: e.level as number | null, floorType: e.floorType as string, ...(e.spaceType === undefined ? {} : { spaceType: e.spaceType as string }), ...(e.fireType === undefined ? {} : { fireType: e.fireType as string }) })) } else { const e = rec(node.extras); if (e && hasNodeSemanticField(e)) return bad(`/nodes/${index}/extras`, 'non-mesh-semantic-fields', manifestUri, assetId) }
    active.delete(index); return { ok: true, value: null } }
  const state = new Map<number, 0 | 1 | 2>(); const reachable: number[] = []
  for (const root of roots) { const stack: Array<{ index: number; exit: boolean }> = [{ index: root, exit: false }]; while (stack.length > 0) { const item = stack.pop()!; const current = state.get(item.index) ?? 0; if (item.exit) { state.set(item.index, 2); continue }; if (current === 1) return bad(`/nodes/${item.index}`, 'node-cycle', manifestUri, assetId); if (current === 2) continue; state.set(item.index, 1); reachable.push(item.index); stack.push({ index: item.index, exit: true }); const node = rec(nodes[item.index]); if (node?.children && Array.isArray(node.children)) for (let ci = node.children.length - 1; ci >= 0; ci -= 1) stack.push({ index: node.children[ci] as number, exit: false }) } }
  for (const index of reachable) { const result = visit(index); if (!result.ok) return result }
  for (let i = 0; i < nodes.length; i += 1) { const node = rec(nodes[i]); if (node?.mesh !== undefined && !state.has(i)) return bad(`/nodes/${i}`, 'mesh-not-reachable', manifestUri, assetId) }
  return { ok: true, value: Object.freeze({ scene: Object.freeze(floor), nodes: Object.freeze(projected), buffer: bin }) }
}
