/**
 * Move flat-style templates into directory-style using each JSON's subcategory field.
 *
 * Flat:   core-api/camera.flyTo.json         -> category=core-api, subcategory=camera
 * Target: core-api/camera/flyTo.json         -> subcategory from JSON, id from filename stem
 *
 * Only files at depth 2 (category/<filename>.json) are touched.
 * Files at depth 3+ (combo-workflow/isolate/floor.json etc) are left alone.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

const TEMPLATES_DIR = path.resolve('src/templates')

async function* walkJsonFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      yield* walkJsonFiles(full)
    } else if (e.isFile() && e.name.endsWith('.json')) {
      yield full
    }
  }
}

async function main() {
  // 1) 收集所有 depth-2 JSON
  const toMove = []
  for await (const filePath of walkJsonFiles(TEMPLATES_DIR)) {
    const rel = path.relative(TEMPLATES_DIR, filePath)
    if (rel.split(path.sep).length === 2) {
      toMove.push(filePath)
    }
  }

  let moved = 0
  for (const filePath of toMove) {
    const rel = path.relative(TEMPLATES_DIR, filePath)
    const [category, filename] = rel.split(path.sep)
    const stem = filename.replace(/\.json$/, '')

    // 读 JSON 用 subcategory 字段 (而非拆文件名, 这样不依赖前缀)
    const raw = await fs.readFile(filePath, 'utf8')
    const json = JSON.parse(raw)
    const subcategory = json.subcategory
    if (!subcategory) {
      console.warn(`[flatten] skip (no subcategory): ${rel}`)
      continue
    }

    // id 派生: 去掉 '<subcategory>.' 前缀 (soonspace 风格)
    // 例如 'camera.flyTo' (sub='camera') -> id='flyTo'
    // 例如 'animation.addTweenAnimation' (sub='animation') -> id='addTweenAnimation'
    const prefix = subcategory + '.'
    let newId
    if (stem.startsWith(prefix)) {
      newId = stem.slice(prefix.length)
    } else {
      // 没有前缀,直接用 stem
      newId = stem
    }

    const subDir = path.join(TEMPLATES_DIR, category, subcategory)
    const newFile = path.join(subDir, newId + '.json')

    if (filePath === newFile) continue

    // 如果目标已存在 (重名冲突), 跳过 + 警告
    if (await fs.stat(newFile).catch(() => null)) {
      console.warn(`[flatten] CONFLICT: ${rel} -> ${path.relative(TEMPLATES_DIR, newFile)} (target exists)`)
      continue
    }

    await fs.mkdir(subDir, { recursive: true })
    await fs.rename(filePath, newFile)

    // 更新 id 字段
    json.id = newId
    await fs.writeFile(newFile, JSON.stringify(json, null, 2) + '\n', 'utf8')
    console.log(`[flatten] ${rel} -> ${path.relative(TEMPLATES_DIR, newFile)} (id: ${newId})`)
    moved++
  }

  console.log(`[flatten] moved ${moved} templates`)

  // 2) 清空 category 根目录下的残留空文件 (depth 2 已全部移走,只可能剩 conflict 跳过项)
  // 这里不自动删,留给人手检查
}

main().catch((err) => {
  console.error('[flatten] failed:', err)
  process.exit(1)
})