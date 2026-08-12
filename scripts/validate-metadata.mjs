/**
 * validate-metadata.mjs
 *
 * 扫描 public/models/<sub>/<name>.glb, 验证 metadata 符合 v3.1 规范:
 *
 * scene.extras 必填:
 *   - floorName   (string)
 *   - building    (string | null)
 *   - level       (number)
 *   - floorType   (FLOOR | TOWER | ROOF | BASEMENT | LANDSCAPE_TERRAIN | LANDSCAPE_FACADE | FACILITY)
 *                 [v3: 删 ROOF_DECORATION, 并入 ROOF]
 *   - name        (string, 可选但建议)
 *
 * node.extras (每个 mesh 节点):
 *   - name        (string, 中文名)
 *   - sid         (string, 格式 <RENDERTYPE>_<FLOORNAME>_<SEQ>, 全局唯一)
 *   - findId      (string, 格式 <FLOORNAME>_mesh_<INDEX>, 自动派生, 我们检查是否一致)
 *   - floorName   (冗余, 建议)
 *   - building    (冗余, 建议)
 *   - level       (冗余, 建议)
 *   - renderType  (WINDOW | DOOR | ELEVATOR | STAIR | CEILING | WALL | SPACE | FACILITY)
 *                 [v3: 删 ROOF (合并入 CEILING), 加 WALL (墙/柱/梁)]
 *                 [v3.1: 加 FACILITY (消防/安防器材)]
 *   - renderTypeConfidence (high | low, 可选)
 *   - spaceType   (renderType === 'SPACE' 时必填)
 *   - fireType    (renderType === 'FACILITY' 时必填, 11 种, v3.1)
 *
 * 用法:
 *   node scripts/validate-metadata.mjs                       # 验证 public/models/ 下所有子目录
 *   node scripts/validate-metadata.mjs <sub>                # 只验证某个子目录
 *   node scripts/validate-metadata.mjs --strict             # 警告也算错误 (退出码 1)
 *   node scripts/validate-metadata.mjs --json               # 输出 JSON 报告
 *
 * 退出码:
 *   0  全部通过
 *   1  有错误 (默认只统计 error; --strict 时 warning 也算)
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

// ---------------------------------------------------------------------------
// 规范常量
// ---------------------------------------------------------------------------

// v3.1: floorType 7 种 (删 ROOF_DECORATION, 并入 ROOF)
const VALID_FLOOR_TYPES = new Set([
  'FLOOR',
  'TOWER',
  'ROOF',                // v3: 含原 ROOF_DECORATION
  'BASEMENT',
  'LANDSCAPE_TERRAIN',
  'LANDSCAPE_FACADE',
  'FACILITY',
])

// v3.1: renderType 8 种 (删 ROOF, 加 WALL, 加 FACILITY)
const VALID_RENDER_TYPES = new Set([
  'WINDOW',
  'DOOR',
  'ELEVATOR',
  'STAIR',
  'CEILING',             // v3: 含义扩大, 覆盖原 ROOF
  'WALL',                // v3: 新增, 墙/柱/梁
  'SPACE',
  'FACILITY',            // v3.1: 新增, 消防/安防器材
])

// v3.1: fireType 11 种 (仅 FACILITY 用)
const VALID_FIRE_TYPES = new Set([
  'HYDRANT',
  'SMOKE_DETECTOR',
  'SPRINKLER',
  'EXTINGUISHER',
  'EMERGENCY_LIGHT',
  'EXIT_SIGN',
  'BREAK_GLASS',
  'ALARM_BELL',
  'FIRE_HOSE',
  'FIRE_DOOR',
  'OTHER',
])

const VALID_SPACE_TYPES = new Set([
  'TOILET',
  'LAUNDRY',
  'KITCHEN',
  'OFFICE',
  'MEETING_ROOM',
  'BEDROOM',
  'CORRIDOR',
  'STAIRWELL',
  'ELEVATOR_HALL',
  'MECHANICAL_ROOM',
  'STORAGE',
  'LOBBY',
  'BALCONY',
])

// sid 格式: <RENDERTYPE>_<FLOORNAME>_<SEQ>  (e.g. WINDOW_A_6F_42)
// v3.1 sid 格式:
//   通用: <RENDERTYPE>_<FLOORNAME>_<TAIL>
//   TAIL 可以是 SEQ (数字) 或 SUB (字符串, 如 CEILING_LOWER) 或
//        FACILITY 的 FIRE_TYPE_SEQ 复合 (如 HYDRANT_01)
const SID_RE = /^[A-Z]+_[A-Z0-9_\-]+_[A-Z0-9_\-]+$/

// findId 格式: <FLOORNAME>_mesh_<INDEX>
const FINDID_RE = /^[A-Z0-9_\-]+_mesh_\d+$/

// ---------------------------------------------------------------------------
// GLB 解析
// ---------------------------------------------------------------------------

/**
 * 读 GLB 头部 + JSON chunk
 */
async function readGLBMetadata(filePath) {
  const buf = await fs.readFile(filePath)
  if (buf.length < 20) throw new Error('GLB too small: ' + filePath)
  const magic = buf.toString('utf-8', 0, 4)
  if (magic !== 'glTF') throw new Error('Not a GLB: ' + filePath)
  const c0Len = buf.readUInt32LE(12)
  if (c0Len > 50 * 1024 * 1024) throw new Error('JSON chunk too large: ' + filePath)
  const jsonStr = buf.subarray(20, 20 + c0Len).toString('utf-8')
  return JSON.parse(jsonStr)
}

// ---------------------------------------------------------------------------
// 验证
// ---------------------------------------------------------------------------

/**
 * 验证一个 GLB 文件的 metadata
 * @returns { file, scene, meshes, errors: [], warnings: [], stats: {} }
 */
function validateGLB(filePath, sub) {
  const result = {
    file: path.basename(filePath),
    sub,
    scene: null,
    meshes: [],
    errors: [],
    warnings: [],
    stats: {
      totalNodes: 0,
      meshNodes: 0,
      withSid: 0,
      withRenderType: 0,
      withSpaceType: 0,
      spaceMesh: 0,
      withFireType: 0,    // v3.1
      facilityMesh: 0,    // v3.1
    },
  }

  // 同步 (因为整个函数已经是 async) — 用 readFileSync 包一层
  // 实际上 readGLBMetadata 是 async, 这里要 await — 改用同步版本
  return { file: path.basename(filePath), sub, errors: ['use validateGLBAsync'] }
}

async function validateGLBAsync(filePath, sub) {
  const result = {
    file: path.basename(filePath),
    sub,
    scene: {},
    meshes: [],
    errors: [],
    warnings: [],
    stats: {
      totalNodes: 0,
      meshNodes: 0,
      withSid: 0,
      withRenderType: 0,
      withSpaceType: 0,
      spaceMesh: 0,
      withFireType: 0,    // v3.1
      facilityMesh: 0,    // v3.1
    },
  }

  let gltf
  try {
    gltf = await readGLBMetadata(filePath)
  } catch (e) {
    result.errors.push('Failed to read GLB: ' + e.message)
    return result
  }

  // --- scene.extras ---
  const scene = gltf.scenes?.[0]
  const sceneExtras = scene?.extras ?? {}
  result.scene = sceneExtras

  // floorName
  if (!sceneExtras.floorName || typeof sceneExtras.floorName !== 'string') {
    result.errors.push('scene.extras.floorName missing or not a string')
  }

  // building
  if (
    sceneExtras.building !== undefined &&
    sceneExtras.building !== null &&
    typeof sceneExtras.building !== 'string'
  ) {
    result.errors.push('scene.extras.building must be string or null')
  }
  // 缺失: 警告 (e.g. LANDSCAPE 没有楼栋)
  if (sceneExtras.building === undefined) {
    result.warnings.push('scene.extras.building missing (allowed for LANDSCAPE, otherwise required)')
  }

  // level
  if (
    sceneExtras.level !== undefined &&
    sceneExtras.level !== null &&
    typeof sceneExtras.level !== 'number'
  ) {
    result.errors.push('scene.extras.level must be number or null')
  }
  if (sceneExtras.level === undefined) {
    result.warnings.push('scene.extras.level missing (allowed for LANDSCAPE, otherwise required)')
  }

  // floorType
  if (!sceneExtras.floorType || !VALID_FLOOR_TYPES.has(sceneExtras.floorType)) {
    result.errors.push(
      `scene.extras.floorType invalid: "${sceneExtras.floorType}" (valid: ${[...VALID_FLOOR_TYPES].join(', ')})`,
    )
  }

  // name (建议)
  if (!sceneExtras.name) {
    result.warnings.push('scene.extras.name missing (recommended, e.g. "A 楼 6 层")')
  }

  const floorName = sceneExtras.floorName || 'UNKNOWN'

  // --- nodes (mesh only) ---
  result.stats.totalNodes = gltf.nodes?.length || 0
  const nodes = gltf.nodes || []
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    if (n.mesh === undefined) continue // 不是 mesh 节点, 跳过
    result.stats.meshNodes++

    const extras = n.extras ?? {}
    const m = {
      index: i,
      name: n.name,
      extras,
      errors: [],
      warnings: [],
    }

    // name (建议, 中文名; 没 name 也行, 但无法给 sid / 查找会有问题)
    if (!n.name) {
      m.warnings.push('mesh node has no .name (will be untrackable by sid, please add)')
    }

    // sid (强烈建议)
    if (extras.sid) {
      result.stats.withSid++
      // 格式校验
      if (!SID_RE.test(extras.sid)) {
        m.warnings.push(
          `sid "${extras.sid}" does not match pattern ${SID_RE} (expected: RENDERTYPE_FLOORNAME_TAIL where TAIL = SEQ or SUB or FIRETYPE_SEQ)`,
        )
      }
    } else {
      m.warnings.push('mesh has no .sid (recommended: <RENDERTYPE>_<FLOORNAME>_<SEQ>)')
    }

    // findId
    if (extras.findId) {
      if (!FINDID_RE.test(extras.findId)) {
        m.warnings.push(
          `findId "${extras.findId}" does not match pattern ${FINDID_RE}`,
        )
      }
      // 校验: findId 应该等于 <floorName>_mesh_<i>
      const expectedFindId = `${floorName}_mesh_${i}`
      if (extras.findId !== expectedFindId) {
        m.warnings.push(
          `findId "${extras.findId}" should be "${expectedFindId}" (auto-derived from index)`,
        )
      }
    } else {
      m.warnings.push(`mesh has no .findId (expected: "${floorName}_mesh_${i}")`)
    }

    // renderType
    if (extras.renderType) {
      result.stats.withRenderType++
      if (!VALID_RENDER_TYPES.has(extras.renderType)) {
        m.errors.push(
          `renderType "${extras.renderType}" invalid (valid: ${[...VALID_RENDER_TYPES].join(', ')})`,
        )
      }
      // 空间 mesh 必须有 spaceType
      if (extras.renderType === 'SPACE') {
        result.stats.spaceMesh++
        if (!extras.spaceType) {
          m.errors.push('renderType=SPACE requires spaceType field')
        } else {
          result.stats.withSpaceType++
          if (!VALID_SPACE_TYPES.has(extras.spaceType)) {
            m.warnings.push(
              `spaceType "${extras.spaceType}" not in known list (you may extend it; valid: ${[...VALID_SPACE_TYPES].join(', ')})`,
            )
          }
        }
      }
      // 消防/安防器材 mesh 必须有 fireType (v3.1)
      if (extras.renderType === 'FACILITY') {
        result.stats.facilityMesh++
        if (!extras.fireType) {
          m.errors.push('renderType=FACILITY requires fireType field')
        } else {
          result.stats.withFireType++
          if (!VALID_FIRE_TYPES.has(extras.fireType)) {
            m.warnings.push(
              `fireType "${extras.fireType}" not in known list (you may extend it; valid: ${[...VALID_FIRE_TYPES].join(', ')})`,
            )
          }
        }
      }
    } else {
      // mesh 没标 renderType — warning
      m.warnings.push('mesh has no .renderType (recommended: WINDOW/DOOR/ELEVATOR/STAIR/CEILING/WALL/SPACE/FACILITY)')
    }

    // 冗余字段一致性
    if (extras.floorName && extras.floorName !== floorName) {
      m.warnings.push(
        `node.extras.floorName "${extras.floorName}" != scene.extras.floorName "${floorName}"`,
      )
    }
    if (
      extras.building !== undefined &&
      extras.building !== sceneExtras.building
    ) {
      m.warnings.push(
        `node.extras.building "${extras.building}" != scene.extras.building "${sceneExtras.building}"`,
      )
    }

    result.meshes.push(m)
    if (m.errors.length) result.errors.push(`mesh #${i} (${n.name || 'unnamed'}): ${m.errors.join('; ')}`)
    if (m.warnings.length) result.warnings.push(`mesh #${i} (${n.name || 'unnamed'}): ${m.warnings.join('; ')}`)
  }

  return result
}

// ---------------------------------------------------------------------------
// 汇总
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2)
  const strict = args.includes('--strict')
  const verbose = args.includes('--verbose') || args.includes('-v')
  const jsonOutput = args.includes('--json')
  const targetSub = args.find((a) => !a.startsWith('--'))

  const modelsDir = path.resolve('public/models')
  const entries = await fs.readdir(modelsDir, { withFileTypes: true })

  // 决定扫哪些目录
  //  - 无参数: 扫 public/models/ 下所有子目录
  //  - 一个参数:
  //      - 如果是 absolute 路径或以 ./ ../ 开头: 直接用该目录
  //      - 否则: 当成 public/models/<sub> 子目录
  const dirs = []
  if (targetSub) {
    const isAbs = path.isAbsolute(targetSub)
    const startsWithRel = targetSub.startsWith('./') || targetSub.startsWith('../')
    if (isAbs || startsWithRel) {
      dirs.push(path.resolve(targetSub))
    } else {
      dirs.push(path.resolve(modelsDir, targetSub))
    }
  } else {
    for (const e of entries) {
      if (e.isDirectory()) dirs.push(path.join(modelsDir, e.name))
    }
  }

  // 收集所有 GLB
  const allFiles = []
  for (const dir of dirs) {
    try {
      const files = await fs.readdir(dir)
      const sub = path.basename(dir)
      for (const f of files) {
        if (f.toLowerCase().endsWith('.glb')) {
          allFiles.push({ path: path.join(dir, f), sub })
        }
      }
    } catch (e) {
      console.error(`[validate] cannot read ${dir}: ${e.message}`)
    }
  }

  if (allFiles.length === 0) {
    console.log('[validate] no GLB files found')
    return
  }

  // 验证
  const reports = []
  for (const f of allFiles) {
    const r = await validateGLBAsync(f.path, f.sub)
    reports.push(r)
  }

  // 全局 sid 唯一性检查
  const sidMap = new Map() // sid -> [file, index]
  for (const r of reports) {
    for (const m of r.meshes) {
      const sid = m.extras.sid
      if (!sid) continue
      if (!sidMap.has(sid)) sidMap.set(sid, [])
      sidMap.get(sid).push({ file: r.file, sub: r.sub, index: m.index, name: m.name })
    }
  }
  const sidDuplicates = []
  for (const [sid, locs] of sidMap.entries()) {
    if (locs.length > 1) {
      sidDuplicates.push({ sid, locs })
    }
  }

  // 汇总
  const totalFiles = reports.length
  const filesWithErrors = reports.filter((r) => r.errors.length > 0).length
  const totalErrors = reports.reduce((s, r) => s + r.errors.length, 0)
  const totalWarnings = reports.reduce((s, r) => s + r.warnings.length, 0)
  const totalMeshNodes = reports.reduce((s, r) => s + r.stats.meshNodes, 0)
  const totalWithSid = reports.reduce((s, r) => s + r.stats.withSid, 0)
  const totalWithRenderType = reports.reduce(
    (s, r) => s + r.stats.withRenderType,
    0,
  )
  const totalSpaceMesh = reports.reduce((s, r) => s + r.stats.spaceMesh, 0)
  const totalWithSpaceType = reports.reduce(
    (s, r) => s + r.stats.withSpaceType,
    0,
  )
  const totalFacilityMesh = reports.reduce((s, r) => s + r.stats.facilityMesh, 0)
  const totalWithFireType = reports.reduce(
    (s, r) => s + r.stats.withFireType,
    0,
  )

  const summary = {
    totalFiles,
    filesWithErrors,
    totalErrors,
    totalWarnings,
    sidDuplicates: sidDuplicates.length,
    totalMeshNodes,
    totalWithSid,
    totalWithRenderType,
    totalSpaceMesh,
    totalWithSpaceType,
    totalFacilityMesh,
    totalWithFireType,
    passRate: {
      sid: pct(totalWithSid, totalMeshNodes),
      renderType: pct(totalWithRenderType, totalMeshNodes),
      spaceType: pct(totalWithSpaceType, totalSpaceMesh),
      fireType: pct(totalWithFireType, totalFacilityMesh),
    },
  }

  if (jsonOutput) {
    console.log(JSON.stringify({ summary, reports, sidDuplicates }, null, 2))
    return
  }

  // 人读报告
  console.log('='.repeat(70))
  console.log('GLB Metadata Validation Report v2')
  console.log('='.repeat(70))
  console.log('')
  console.log(`Scanned: ${totalFiles} GLB file(s) in ${dirs.length} dir: ${dirs.map(d => path.basename(d)).join(', ')}`)
  console.log('')
  console.log('─── Summary ────────────────────────────────────────')
  console.log(`Files with errors:        ${filesWithErrors} / ${totalFiles}`)
  console.log(`Total errors:             ${totalErrors}`)
  console.log(`Total warnings:           ${totalWarnings}`)
  console.log(`Duplicate sid (global):   ${sidDuplicates.length}`)
  console.log('')
  console.log('─── Mesh Stats ─────────────────────────────────────')
  console.log(`Total mesh nodes:         ${totalMeshNodes}`)
  console.log(`  With sid:               ${totalWithSid}  (${summary.passRate.sid}%)`)
  console.log(`  With renderType:        ${totalWithRenderType}  (${summary.passRate.renderType}%)`)
  console.log(`  SPACE mesh:             ${totalSpaceMesh}`)
  console.log(`  SPACE with spaceType:   ${totalWithSpaceType}  (${summary.passRate.spaceType}%)`)
  console.log(`  FACILITY mesh:          ${totalFacilityMesh}`)
  console.log(`  FACILITY with fireType: ${totalWithFireType}  (${summary.passRate.fireType}%)`)
  console.log('')

  // per-file 报告
  console.log('─── Per-file Report ─────────────────────────────────')
  for (const r of reports) {
    const status = r.errors.length > 0 ? '✗' : r.warnings.length > 0 ? '⚠' : '✓'
    console.log(
      `${status}  [${r.sub}/${r.file}]  mesh=${r.stats.meshNodes}  sid=${r.stats.withSid}  renderType=${r.stats.withRenderType}  errors=${r.errors.length}  warnings=${r.warnings.length}`,
    )
    if (r.errors.length > 0 && (r.errors.length <= 5 || strict)) {
      for (const e of r.errors.slice(0, 5)) {
        console.log(`     ERROR: ${e}`)
      }
      if (r.errors.length > 5) console.log(`     ... and ${r.errors.length - 5} more`)
    }
    if (verbose && r.warnings.length > 0) {
      for (const w of r.warnings.slice(0, 10)) {
        console.log(`     WARN: ${w}`)
      }
      if (r.warnings.length > 10) console.log(`     ... and ${r.warnings.length - 10} more`)
    }
  }
  console.log('')

  // sid 重复
  if (sidDuplicates.length > 0) {
    console.log('─── Duplicate sid (global) ──────────────────────────')
    for (const d of sidDuplicates) {
      console.log(`  DUPLICATE: ${d.sid}`)
      for (const l of d.locs) {
        console.log(`    at ${l.sub}/${l.file} mesh#${l.index} (${l.name})`)
      }
    }
    console.log('')
  }

  // 退出码
  const hasFail = totalErrors > 0 || (strict && totalWarnings > 0)
  console.log('='.repeat(70))
  if (hasFail) {
    console.log('FAIL — please fix the errors above')
    process.exit(1)
  } else if (totalWarnings > 0) {
    console.log('PASS WITH WARNINGS — review the warnings')
    process.exit(0)
  } else {
    console.log('PASS — all files conform to v3.1 spec')
    process.exit(0)
  }
}

function pct(num, denom) {
  if (denom === 0) return '0.0%'
  return ((num / denom) * 100).toFixed(1) + '%'
}

main().catch((err) => {
  console.error('[validate] fatal:', err)
  process.exit(2)
})