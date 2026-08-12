/**
 * migrate-roof-decoration.mjs
 *
 * v3 规范升级的数据迁移:
 *   把所有 GLB 里 scene.extras.floorType === 'ROOF_DECORATION' 改成 'ROOF'
 *   同时把 node.extras 里冗余的 floorType 也跟着改
 *
 * 原因:
 *   v3 删了 ROOF_DECORATION (并入 ROOF),
 *   validate-metadata.mjs 现在会 reject 这 3 个 GLB (A_DING / B_DING / C_DING)
 *
 * 用法:
 *   node scripts/migrate-roof-decoration.mjs                 # 默认扫 glb_cleaned/
 *   node scripts/migrate-roof-decoration.mjs <dir>           # 扫指定目录
 *   node scripts/migrate-roof-decoration.mjs <dir> --dry-run # 只打印, 不写
 *
 * 退出码:
 *   0 - 成功 (0 或更多文件改了)
 *   1 - 目录读不了
 *   2 - 致命错误
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

const FROM = 'ROOF_DECORATION'
const TO = 'ROOF'

// ---------------------------------------------------------------------------
// GLB 读写 (跟 auto-fill.mjs 同样格式)
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
// 迁移逻辑
// ---------------------------------------------------------------------------

// semantic 字段里的中文也带 "屋顶装饰" → "屋顶"
const SEMANTIC_SUB_FROM = '屋顶装饰'
const SEMANTIC_SUB_TO = '屋顶'
const SEMANTIC_DISP_FROM = '(屋顶装饰)'
const SEMANTIC_DISP_TO = '(屋顶)'
const SEMANTIC_DESC_FROM = '类型: 屋顶装饰'
const SEMANTIC_DESC_TO = '类型: 屋顶'

function migrate(gltf) {
  let rootChanged = false
  let sceneChanged = false
  let nodesChanged = 0
  let semanticChanged = false

  // 0. gltf 根级 extras (工具方会在这里冗余写一份 metadata, 跟 scene.extras 内容一致)
  if (gltf.extras?.floorType === FROM) {
    gltf.extras.floorType = TO
    rootChanged = true
  }
  if (gltf.extras?.semantic) {
    const sem = gltf.extras.semantic
    if (sem.subcategory === SEMANTIC_SUB_FROM) {
      sem.subcategory = SEMANTIC_SUB_TO
      semanticChanged = true
    }
    if (sem.typeCN === SEMANTIC_SUB_FROM) {
      sem.typeCN = SEMANTIC_SUB_TO
      semanticChanged = true
    }
    if (typeof sem.displayName === 'string' && sem.displayName.includes(SEMANTIC_DISP_FROM)) {
      sem.displayName = sem.displayName.split(SEMANTIC_DISP_FROM).join(SEMANTIC_DISP_TO)
      semanticChanged = true
    }
    if (typeof sem.description === 'string' && sem.description.includes(SEMANTIC_DESC_FROM)) {
      sem.description = sem.description.split(SEMANTIC_DESC_FROM).join(SEMANTIC_DESC_TO)
      semanticChanged = true
    }
  }

  // 1. scene.extras.floorType
  const scene = gltf.scenes?.[0]
  if (scene?.extras?.floorType === FROM) {
    scene.extras.floorType = TO
    sceneChanged = true
  }

  // 1.5. scene.extras.semantic (中文语义描述, 含 4 个字段)
  if (scene?.extras?.semantic) {
    const sem = scene.extras.semantic
    if (sem.subcategory === SEMANTIC_SUB_FROM) {
      sem.subcategory = SEMANTIC_SUB_TO
      semanticChanged = true
    }
    if (sem.typeCN === SEMANTIC_SUB_FROM) {
      sem.typeCN = SEMANTIC_SUB_TO
      semanticChanged = true
    }
    if (typeof sem.displayName === 'string' && sem.displayName.includes(SEMANTIC_DISP_FROM)) {
      sem.displayName = sem.displayName.split(SEMANTIC_DISP_FROM).join(SEMANTIC_DISP_TO)
      semanticChanged = true
    }
    if (typeof sem.description === 'string' && sem.description.includes(SEMANTIC_DESC_FROM)) {
      sem.description = sem.description.split(SEMANTIC_DESC_FROM).join(SEMANTIC_DESC_TO)
      semanticChanged = true
    }
  }

  // 2. node.extras.floorType (冗余字段, 跟 scene 保持一致)
  const nodes = gltf.nodes || []
  for (const n of nodes) {
    if (n.extras?.floorType === FROM) {
      n.extras.floorType = TO
      nodesChanged++
    }
  }

  return {
    rootChanged,
    sceneChanged,
    nodesChanged,
    semanticChanged,
    changed: rootChanged || sceneChanged || nodesChanged > 0 || semanticChanged,
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const targetDir = args.find((a) => !a.startsWith('--')) || 'glb_cleaned'

  const absDir = path.resolve(targetDir)
  let entries
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true })
  } catch (e) {
    console.error(`[migrate-roof-decoration] cannot read dir ${absDir}: ${e.message}`)
    process.exit(1)
  }
  const glbFiles = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.glb'))
    .map((e) => e.name)
    .sort()

  if (glbFiles.length === 0) {
    console.log(`[migrate-roof-decoration] no GLB files in ${absDir}`)
    return
  }

  console.log('='.repeat(70))
  console.log(`Migrate ${FROM} → ${TO}${dryRun ? ' (DRY RUN)' : ''}`)
  console.log('='.repeat(70))
  console.log(`Dir:           ${absDir}`)
  console.log(`Total files:   ${glbFiles.length}`)
  console.log('')

  let filesChanged = 0
  const report = []

  for (const f of glbFiles) {
    const filePath = path.join(absDir, f)
    try {
      const { gltf, buf } = await readGLBJSON(filePath)
      const { rootChanged, sceneChanged, nodesChanged, semanticChanged, changed } = migrate(gltf)

      if (!changed) continue

      if (!dryRun) {
        const newBuf = writeGLBJSON(buf, gltf)
        await fs.writeFile(filePath, newBuf)
      }

      filesChanged++
      report.push({
        file: f,
        rootChanged,
        sceneChanged,
        nodesChanged,
      })

      console.log(
        `  ${dryRun ? '[DRY] ' : '      '}${f.padEnd(28)} root=${rootChanged ? '✓' : ' '} scene=${sceneChanged ? '✓' : ' '}  nodes=${nodesChanged} changed`,
      )
    } catch (e) {
      console.error(`  ERROR ${f}: ${e.message}`)
    }
  }

  console.log('')
  console.log('─'.repeat(70))
  console.log(`Files changed: ${filesChanged}`)
  if (dryRun) {
    console.log('NOTE: dry-run mode, no files were modified.')
    console.log('      Re-run without --dry-run to apply.')
  } else if (filesChanged > 0) {
    console.log('Next step: re-run validate-metadata.mjs to verify.')
  } else {
    console.log('Nothing to migrate.')
  }
}

main().catch((err) => {
  console.error('[migrate-roof-decoration] fatal:', err)
  process.exit(2)
})