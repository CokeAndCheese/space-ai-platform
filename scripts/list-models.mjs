/**
 * 扫描 public/models/ 目录 (含子目录),把可用 .glb 列表写到 src/model-manifest.json
 *
 * 设计:
 *   - 递归扫描子目录 (一层), 路径写进 url: /models/<sub>/<filename>
 *   - 文件名按字典序排序
 *   - 推断每条记录的 displayName (去后缀, 友好化)
 *   - 推断 size (字节, 方便 UI 显示)
 *   - 在 record 里加 subcategory 字段 (顶级目录名), 方便前端按场景分组
 *
 * 用法:
 *   node scripts/list-models.mjs
 *   npm run list-models
 *
 * 注意: 这是显式写回命令。dev/build/verify:r1 不会自动调用本脚本。
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

const MODELS_DIR = path.resolve('public/models')
const MANIFEST_PATH = path.resolve('src/model-manifest.json')

async function main() {
  let entries
  try {
    entries = await fs.readdir(MODELS_DIR, { withFileTypes: true })
  } catch (err) {
    console.error(`[list-models] 读取 ${MODELS_DIR} 失败:`, err)
    process.exit(1)
  }

  // 收集两种 record:
  //   - 单个 GLB 文件 (kind: 'file')
  //   - 子目录 (kind: 'scene', 一次性加载该目录下所有 GLB)
  const records = []
  // 收集指纹 (max mtime + 文件数) 用于跳过未变的情况
  let maxMtime = 0
  let fileCount = 0

  for (const e of entries) {
    if (e.isFile() && e.name.toLowerCase().endsWith('.glb')) {
      // 顶级 (老格式, 留兼容)
      const rec = await buildFileRecord('', e.name)
      records.push(rec)
      maxMtime = Math.max(maxMtime, rec.mtime)
      fileCount++
    } else if (e.isDirectory()) {
      const sub = e.name
      const subPath = path.join(MODELS_DIR, sub)
      const subEntries = await fs.readdir(subPath, { withFileTypes: true })
      let glbCount = 0
      let totalSize = 0
      let subMaxMtime = 0
      for (const se of subEntries) {
        if (se.isFile() && se.name.toLowerCase().endsWith('.glb')) {
          const rec = await buildFileRecord(sub, se.name)
          records.push(rec)
          glbCount++
          totalSize += rec.sizeBytes
          subMaxMtime = Math.max(subMaxMtime, rec.mtime)
        }
      }
      // 子目录本身也算一条 record (kind: 'scene')
      if (glbCount > 0) {
        const sceneRec = buildSceneRecord(sub, glbCount, totalSize, subMaxMtime)
        records.push(sceneRec)
        maxMtime = Math.max(maxMtime, subMaxMtime)
        fileCount += glbCount
      }
    }
  }

  // 缓存检查: 读现有 manifest, 如果 fingerprint 一致且未过期则跳过
  // 强制跳过检查: --force (CIRCLE_NODE_LOG_INDEX 没设的话)
  const force = process.argv.includes('--force')
  const fingerprint = `${maxMtime}|${fileCount}|${records.length}`
  if (!force) {
    try {
      const existing = JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf8'))
      const existingFp = existing.__fingerprint
      const generatedAt = existing.generatedAt
      const ageMs = generatedAt ? Date.now() - new Date(generatedAt).getTime() : Infinity
      // fingerprint 一致 且 不超过 7 天, 跳过写
      if (existingFp === fingerprint && ageMs < 7 * 24 * 60 * 60 * 1000) {
        console.log(`[list-models] 未变 (fingerprint=${fingerprint}), 跳过 (上生成 ${generatedAt}, ${(ageMs / 1000 / 60).toFixed(1)} min 前)`)
        return
      }
    } catch {
      // 没有 manifest 或解析失败, 继续生成
    }
  }

  // 排序: scene 优先 (同 sub 内排首位), 然后 file
  records.sort((a, b) => {
    if (a.kind !== b.kind) {
      // scene 在前, file 在后
      if (a.kind === 'scene') return -1
      if (b.kind === 'scene') return 1
    }
    if (a.subcategory !== b.subcategory) {
      if (!a.subcategory) return 1
      if (!b.subcategory) return -1
      return a.subcategory.localeCompare(b.subcategory)
    }
    return a.filename.localeCompare(b.filename)
  })

  const manifest = {
    generatedAt: new Date().toISOString(),
    modelsDir: 'public/models',
    count: records.length,
    models: records,
    // 缓存指纹: max mtime + file count + record count
    // 全部一致即认为"未变", 可跳过重写
    __fingerprint: fingerprint,
  }

  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  const sceneCount = records.filter(r => r.kind === 'scene').length
  const totalFileCount = records.filter(r => r.kind === 'file').length
  console.log(`[list-models] 写入 ${records.length} 条 (${sceneCount} 场景 + ${totalFileCount} 文件):`)
  // 按 subcategory 分组打印
  const grouped = new Map()
  for (const r of records) {
    const k = r.subcategory || '(root)'
    if (!grouped.has(k)) grouped.set(k, [])
    grouped.get(k).push(r)
  }
  for (const [k, list] of grouped) {
    console.log(`  ${k}/:`)
    for (const r of list) {
      const tag = r.kind === 'scene' ? '[SCENE]' : '       '
      console.log(`    ${tag} ${r.filename.padEnd(28)} ${r.sizeMB} MB`)
    }
  }
}

async function buildFileRecord(sub, filename) {
  const full = sub ? path.join(MODELS_DIR, sub, filename) : path.join(MODELS_DIR, filename)
  const stat = await fs.stat(full)
  const displayName = filename
    .replace(/\.glb$/i, '')
    .replace(/\.opt$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
  const url = sub ? `/models/${sub}/${filename}` : `/models/${filename}`
  return {
    kind: 'file',
    subcategory: sub, // '' 表示顶级
    filename,
    url,
    displayName,
    sizeBytes: stat.size,
    sizeMB: +(stat.size / 1024 / 1024).toFixed(2),
    mtime: stat.mtimeMs,
  }
}

function buildSceneRecord(sub, glbCount, totalSize, subMaxMtime = Date.now()) {
  const displayName = sub.charAt(0).toUpperCase() + sub.slice(1)
  return {
    kind: 'scene',
    subcategory: '',
    filename: sub,
    url: `/models/${sub}`, // 注意: 结尾不带 .glb, 表示场景
    displayName: `${displayName} (${glbCount} GLB · 整个场景)`,
    sizeBytes: totalSize,
    sizeMB: +(totalSize / 1024 / 1024).toFixed(2),
    mtime: subMaxMtime,
  }
}

main().catch((err) => {
  console.error('[list-models] 失败:', err)
  process.exit(1)
})
