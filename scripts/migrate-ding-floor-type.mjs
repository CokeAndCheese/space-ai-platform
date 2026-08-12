/**
 * 临时脚本: 修复从备份恢复的 DING.glb 的 floorType
 *   ROOF_DECORATION → ROOF (v3 规范)
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

async function fixFile(filePath) {
  const buf = await fs.readFile(filePath)
  if (buf.length < 20) throw new Error('GLB too small: ' + filePath)
  if (buf.toString('utf-8', 0, 4) !== 'glTF') throw new Error('Not a GLB: ' + filePath)

  const c0Len = buf.readUInt32LE(12)
  const c0End = 20 + c0Len
  const binChunk = c0End + 8 <= buf.length ? buf.subarray(c0End + 8) : Buffer.alloc(0)

  const jsonStr = buf.subarray(20, 20 + c0Len).toString('utf-8')
  const gltf = JSON.parse(jsonStr)
  const ex = gltf.scenes?.[0]?.extras
  if (!ex) throw new Error('no scene.extras')

  if (ex.floorType === 'ROOF_DECORATION') {
    ex.floorType = 'ROOF'
    console.log(`✓ ${path.basename(filePath)}: ROOF_DECORATION → ROOF`)

    // 重新打包
    const newJsonStr = JSON.stringify(gltf)
    const newJsonBytes = Buffer.from(newJsonStr, 'utf-8')
    const padLen = (4 - (newJsonBytes.length % 4)) % 4
    const padded = Buffer.concat([newJsonBytes, Buffer.alloc(padLen, 0x20)])

    const out = Buffer.alloc(20 + padded.length + 8 + binChunk.length)
    out.write('glTF', 0, 4, 'utf-8')
    out.writeUInt32LE(2, 4)
    out.writeUInt32LE(out.length, 8)
    out.writeUInt32LE(padded.length, 12)
    out.writeUInt32LE(0x4e4f534a, 16)
    padded.copy(out, 20)
    out.writeUInt32LE(binChunk.length, 20 + padded.length)
    out.writeUInt32LE(0x004e4942, 20 + padded.length + 4)
    binChunk.copy(out, 20 + padded.length + 8)

    await fs.writeFile(filePath, out)
    console.log(`  -> wrote ${out.length} bytes (BIN preserved: ${binChunk.length})`)
  } else {
    console.log(`- ${path.basename(filePath)}: floorType already "${ex.floorType}", skip`)
  }
}

async function main() {
  const dir = path.resolve('public/models/hospital')
  for (const f of ['A_DING.glb', 'B_DING.glb', 'C_DING.glb']) {
    await fixFile(path.join(dir, f))
  }
}

main().catch(e => { console.error(e); process.exit(1) })