/**
 * auto-fill.mjs
 *
 * 自动给每个 mesh 节点注入:
 *   - findId  = <FLOORNAME>_mesh_<NODE_INDEX>
 *   - floorName / building / level / floorType  从 scene.extras 复制
 *
 * 不动: geometry / materials / sid / renderType (需要人工或另一工具填)
 *
 * 用法:
 *   node scripts/auto-fill.mjs                            # 默认扫 glb_cleaned/
 *   node scripts/auto-fill.mjs <dir>                      # 扫指定目录
 *   node scripts/auto-fill.mjs <dir> --dry-run            # 只打印, 不写
 *   node scripts/auto-fill.mjs <dir> --json               # 输出 JSON
 *   node scripts/auto-fill.mjs <dir> --force              # 强制覆盖已有 findId
 *
 * 默认行为:
 *   - 已存在 findId / 冗余字段的 mesh: 跳过 (用 --force 强制)
 *   - 没有 scene.extras.floorName: 报错跳过
 *   - 没有 mesh 节点: 不写
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

// ---------------------------------------------------------------------------
// GLB 读写 (复用 inject-scene-name 的实现, 同一种格式)
// ---------------------------------------------------------------------------

async function readGLBJSON(filePath) {
  const buf = await fs.readFile(filePath)
  if (buf.length < 20) throw new Error('GLB too small: ' + filePath)
  const magic = buf.toString('utf-8', 0, 4)
  if (magic !== 'glTF') throw new Error('Not a GLB: ' + filePath)
  const c0Len = buf.readUInt32LE(12)
  const c0Type = buf.readUInt32LE(16)
  if (c0Type !== 0x4e4f534a) throw new Error('First chunk not JSON: ' + filePath)
  if (20 + c0Len > buf.length) throw new Error('JSON chunk truncated: ' + filePath)
  const jsonStr = buf.subarray(20, 20 + c0Len).toString('utf-8')
  return { gltf: JSON.parse(jsonStr), buf, c0Len }
}

function writeGLBJSON(buf, newGltf) {
  const newJsonStr = JSON.stringify(newGltf)
  const newJsonBytes = Buffer.from(newJsonStr, 'utf-8')
  // 4-byte 对齐 (GLB spec 要求)
  const padLen = (4 - (newJsonBytes.length % 4)) % 4
  const padded = Buffer.concat([newJsonBytes, Buffer.alloc(padLen, 0x20)])

  const out = Buffer.alloc(20 + padded.length)
  out.write('glTF', 0, 4, 'utf-8')
  out.writeUInt32LE(2, 4)
  out.writeUInt32LE(out.length, 8)
  out.writeUInt32LE(padded.length, 12)
  out.writeUInt32LE(0x4e4f534a, 16)
  padded.copy(out, 20)

  return out
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const jsonOutput = args.includes('--json')
  const force = args.includes('--force')
  const targetDir = args.find((a) => !a.startsWith('--')) || 'glb_cleaned'

  const absDir = path.resolve(targetDir)
  let entries
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true })
  } catch (e) {
    console.error(`[auto-fill] cannot read dir ${absDir}: ${e.message}`)
    process.exit(1)
  }
  const glbFiles = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.glb'))
    .map((e) => e.name)
    .sort()

  if (glbFiles.length === 0) {
    console.log(`[auto-fill] no GLB files in ${absDir}`)
    return
  }

  const report = []
  let totalInjected = 0
  let totalSkipped = 0
  let totalFailed = 0

  for (const f of glbFiles) {
    const filePath = path.join(absDir, f)
    const r = {
      file: f,
      floorName: null,
      meshTotal: 0,
      injected: 0,
      skipped: 0,
      failed: false,
      reason: '',
    }
    try {
      const { gltf, buf } = await readGLBJSON(filePath)
      const scene = gltf.scenes?.[0]
      const sceneExtras = scene?.extras ?? {}

      if (!sceneExtras.floorName) {
        r.failed = true
        r.reason = 'no scene.extras.floorName, skip (use inject-scene-name first)'
        report.push(r)
        totalFailed++
        continue
      }
      r.floorName = sceneExtras.floorName

      const nodes = gltf.nodes || []
      let fileInjected = 0
      let fileSkipped = 0

      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]
        if (n.mesh === undefined) continue // 跳过 group
        r.meshTotal++

        const extras = n.extras ?? {}
        const expectedFindId = `${sceneExtras.floorName}_mesh_${i}`

        // 判断是否需要注入
        const hasFindId = extras.findId !== undefined
        const hasFloorName = 'floorName' in extras
        const hasBuilding = 'building' in extras
        const hasLevel = 'level' in extras
        const hasFloorType = 'floorType' in extras
        const allPresent = hasFindId && hasFloorName && hasBuilding && hasLevel && hasFloorType

        if (allPresent && !force) {
          // 已完整, 跳过 (除非 force)
          fileSkipped++
          continue
        }

        // 注入 (或覆盖 force 模式)
        if (!extras.findId) extras.findId = expectedFindId
        else if (force) extras.findId = expectedFindId

        if (force || !hasFloorName) extras.floorName = sceneExtras.floorName
        if (force || !hasBuilding) extras.building = sceneExtras.building
        if (force || !hasLevel) extras.level = sceneExtras.level
        if (force || !hasFloorType) extras.floorType = sceneExtras.floorType

        n.extras = extras
        fileInjected++
      }

      if (fileInjected > 0 && !dryRun) {
        const newBuf = writeGLBJSON(buf, gltf)
        await fs.writeFile(filePath, newBuf)
      }

      r.injected = fileInjected
      r.skipped = fileSkipped
      totalInjected += fileInjected
      totalSkipped += fileSkipped
    } catch (e) {
      r.failed = true
      r.reason = 'error: ' + e.message
      totalFailed++
    }
    report.push(r)
  }

  if (jsonOutput) {
    console.log(
      JSON.stringify({ dryRun, force, dir: absDir, report, totalInjected, totalSkipped, totalFailed }, null, 2),
    )
    return
  }

  // 人读报告
  const filesChanged = report.filter((r) => r.injected > 0).length
  console.log('='.repeat(70))
  console.log(`Auto-Fill Mesh Metadata${dryRun ? ' (DRY RUN)' : ''}${force ? ' (FORCE)' : ''}`)
  console.log('='.repeat(70))
  console.log(`Dir:           ${absDir}`)
  console.log(`Total files:   ${glbFiles.length}`)
  console.log(`Files changed: ${filesChanged}`)
  console.log(`Injected:      ${totalInjected} mesh nodes`)
  console.log(`Skipped:       ${totalSkipped} mesh nodes (already had findId+redundant fields)`)
  console.log(`Failed:        ${totalFailed} files`)
  console.log('')

  if (filesChanged > 0) {
    console.log('─── Top 10 changed files ───────────────────────────')
    for (const r of report.filter((r) => r.injected > 0).slice(0, 10)) {
      console.log(`  ${r.file.padEnd(24)}  floorName=${r.floorName.padEnd(20)}  injected=${r.injected}  skipped=${r.skipped}`)
    }
    if (filesChanged > 10) {
      console.log(`  ... and ${filesChanged - 10} more`)
    }
    console.log('')
  }

  if (totalFailed > 0) {
    console.log('─── Failed files ────────────────────────────────────')
    for (const r of report.filter((r) => r.failed)) {
      console.log(`  ${r.file.padEnd(24)}  ${r.reason}`)
    }
    console.log('')
  }

  if (dryRun) {
    console.log('NOTE: dry-run mode, no files were modified')
  } else if (filesChanged > 0) {
    console.log('Re-run validate-metadata to verify.')
  }
}

main().catch((err) => {
  console.error('[auto-fill] fatal:', err)
  process.exit(2)
})