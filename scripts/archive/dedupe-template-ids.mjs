/**
 * Disambiguate template ids that collide across subcategories
 *
 * When two JSONs in different subcategories share the same id (e.g. uspace-camera and core-api
 * both define setCameraViewpoint), prefix the id with the subcategory.
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
  // 1) 收集所有 id
  const idMap = new Map()
  const files = []
  for await (const filePath of walkJsonFiles(TEMPLATES_DIR)) {
    const raw = await fs.readFile(filePath, 'utf8')
    const json = JSON.parse(raw)
    files.push({ path: filePath, json })
    const key = json.id
    if (!idMap.has(key)) idMap.set(key, [])
    idMap.get(key).push({ path: filePath, json })
  }

  // 2) 找出有重复的 id
  let renamed = 0
  for (const [id, group] of idMap) {
    if (group.length <= 1) continue
    console.log(`[dedupe] duplicate id: "${id}" x ${group.length}`)
    for (const { path: fp, json } of group) {
      const category = json.category ?? 'unknown'
      // 检查 id 是否已经以 category 为前缀,避免重复加
      if (!json.id.startsWith(category + '.')) {
        const newId = `${category}.${json.id}`
        console.log(`  - ${fp.replace(TEMPLATES_DIR, '.')}: id "${json.id}" -> "${newId}"`)
        json.id = newId
        await fs.writeFile(fp, JSON.stringify(json, null, 2) + '\n', 'utf8')
        renamed++
      }
    }
  }

  console.log(`[dedupe] renamed ${renamed} templates`)
}

main().catch((err) => {
  console.error('[dedupe] failed:', err)
  process.exit(1)
})