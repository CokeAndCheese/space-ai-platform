/**
 * inject-scene-name.mjs
 *
 * 给每个 GLB 的 scene.extras 注入中文 name 字段
 *   - 默认扫 glb_cleaned/ 目录
 *   - floorName 已知, 自动推 name
 *   - 命名规则: 不带空格, 用"栋"不用"楼"
 *
 * 用法:
 *   node scripts/inject-scene-name.mjs                          # 默认扫 glb_cleaned/
 *   node scripts/inject-scene-name.mjs <dir>                    # 扫指定目录
 *   node scripts/inject-scene-name.mjs <dir> --dry-run          # 只打印, 不写
 *   node scripts/inject-scene-name.mjs <dir> --json             # 输出 JSON 报告
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

// ---------------------------------------------------------------------------
// 命名规则 (floorName -> 中文名)
// ---------------------------------------------------------------------------

function deriveName(floorName) {
  // LANDSCAPE
  if (floorName === 'LANDSCAPE_TERRAIN') return '地形'
  if (floorName === 'LANDSCAPE_FACADE') return '外立面'

  // BASEMENT_B<n>
  const basementMatch = floorName.match(/^BASEMENT_B(\d+)$/)
  if (basementMatch) return `地下室B${basementMatch[1]}层`

  // A_T / A_DING / B_T / B_DING / C_DING
  const towerMatch = floorName.match(/^([ABC])_T$/)
  if (towerMatch) return `${towerMatch[1]}栋塔楼`

  const roofMatch = floorName.match(/^([ABC])_DING$/)
  if (roofMatch) return `${roofMatch[1]}栋屋顶`

  // A_1F / B_24F / C_6F 等
  const floorMatch = floorName.match(/^([ABC])_(\d+)F$/)
  if (floorMatch) return `${floorMatch[1]}栋${floorMatch[2]}层`

  // 没匹配上, 保持原样
  return null
}

// ---------------------------------------------------------------------------
// GLB 读写 (只改 JSON chunk, binary chunk 保持不变)
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
  // 重新打包 GLB: 12 byte header + 8 byte JSON chunk header + JSON + padding + BIN chunk
  const newJsonStr = JSON.stringify(newGltf)
  const newJsonBytes = Buffer.from(newJsonStr, 'utf-8')
  // 4-byte 对齐 (GLB spec 要求)
  const padLen = (4 - (newJsonBytes.length % 4)) % 4
  const padded = Buffer.concat([newJsonBytes, Buffer.alloc(padLen, 0x20)])

  // 从原 buffer 提取 BIN chunk (如果有)
  // 位置: 12 + 8 + c0Len 之后
  const c0Len = buf.readUInt32LE(12)
  const c0End = 20 + c0Len
  const binChunk = c0End + 8 <= buf.length
    ? buf.subarray(c0End + 8)  // 跳过 chunk 1 header (8 bytes)
    : Buffer.alloc(0)

  // 重新组装: header + JSON chunk + BIN chunk
  const out = Buffer.alloc(20 + padded.length + 8 + binChunk.length)
  // magic + version
  out.write('glTF', 0, 4, 'utf-8')
  out.writeUInt32LE(2, 4) // version
  out.writeUInt32LE(out.length, 8) // total length

  // JSON chunk
  out.writeUInt32LE(padded.length, 12)
  out.writeUInt32LE(0x4e4f534a, 16) // 'JSON'
  padded.copy(out, 20)

  // BIN chunk (header + data)
  out.writeUInt32LE(binChunk.length, 20 + padded.length) // chunk length
  out.writeUInt32LE(0x004e4942, 20 + padded.length + 4) // 'BIN\0'
  binChunk.copy(out, 20 + padded.length + 8)

  return out
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const jsonOutput = args.includes('--json')
  const targetDir = args.find((a) => !a.startsWith('--')) || 'glb_cleaned'

  const absDir = path.resolve(targetDir)
  let entries
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true })
  } catch (e) {
    console.error(`[inject-name] cannot read dir ${absDir}: ${e.message}`)
    process.exit(1)
  }
  const glbFiles = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.glb'))
    .map((e) => e.name)
    .sort()

  if (glbFiles.length === 0) {
    console.log(`[inject-name] no GLB files in ${absDir}`)
    return
  }

  const report = []
  for (const f of glbFiles) {
    const filePath = path.join(absDir, f)
    const r = {
      file: f,
      floorName: null,
      oldName: null,
      newName: null,
      changed: false,
      skipped: false,
      reason: '',
    }
    try {
      const { gltf, buf } = await readGLBJSON(filePath)
      const ex = gltf.scenes?.[0]?.extras
      if (!ex) {
        r.skipped = true
        r.reason = 'no scene.extras'
      } else {
        r.floorName = ex.floorName ?? null
        r.oldName = ex.name ?? null
        r.newName = deriveName(ex.floorName)
        if (!r.newName) {
          r.skipped = true
          r.reason = `cannot derive name from floorName "${ex.floorName}"`
        } else if (r.oldName === r.newName) {
          r.skipped = true
          r.reason = 'name already correct'
        } else {
          // 注入新 name
          ex.name = r.newName
          if (!dryRun) {
            const newBuf = writeGLBJSON(buf, gltf)
            await fs.writeFile(filePath, newBuf)
          }
          r.changed = true
        }
      }
    } catch (e) {
      r.skipped = true
      r.reason = 'error: ' + e.message
    }
    report.push(r)
  }

  if (jsonOutput) {
    console.log(JSON.stringify({ dryRun, dir: absDir, report }, null, 2))
    return
  }

  // 人读报告
  const changedCount = report.filter((r) => r.changed).length
  const skippedCount = report.filter((r) => r.skipped).length
  console.log('='.repeat(70))
  console.log(`Scene Name Injection${dryRun ? ' (DRY RUN)' : ''}`)
  console.log('='.repeat(70))
  console.log(`Dir:        ${absDir}`)
  console.log(`Total:      ${glbFiles.length} GLB`)
  console.log(`Changed:    ${changedCount}`)
  console.log(`Skipped:    ${skippedCount}`)
  console.log('')

  if (changedCount > 0) {
    console.log('─── Changes ─────────────────────────────────────────')
    for (const r of report.filter((r) => r.changed)) {
      console.log(`  ${r.file.padEnd(24)}  ${r.floorName.padEnd(24)}  "${r.oldName}" → "${r.newName}"`)
    }
    console.log('')
  }

  if (skippedCount > 0) {
    console.log('─── Skipped ─────────────────────────────────────────')
    for (const r of report.filter((r) => r.skipped)) {
      console.log(`  ${r.file.padEnd(24)}  ${r.floorName ?? '(no floorName)'.padEnd(24)}  ${r.reason}`)
    }
    console.log('')
  }

  if (dryRun) {
    console.log('NOTE: dry-run mode, no files were modified')
  } else if (changedCount > 0) {
    console.log('Files updated. Re-run validate-metadata to verify.')
  }
}

main().catch((err) => {
  console.error('[inject-name] fatal:', err)
  process.exit(2)
})