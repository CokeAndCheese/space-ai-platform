#!/usr/bin/env node
/**
 * fix-template-paths.mjs
 *
 * 把模板里的 category / subcategory 字段改成跟实际文件路径一致
 * (从 templates/<一级目录>/<二级目录?>/<file>.json → category=<一级>, subcategory=<二级 or 'root'>)
 *
 * 这样 sandbox 分组展示跟目录一致,跟 ssp 模块对应
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATES_DIR = path.resolve(__dirname, '../src/templates')

async function walk(dir) {
  const out = []
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await walk(full)))
    } else if (entry.name.endsWith('.json')) {
      out.push(full)
    }
  }
  return out
}

const files = await walk(TEMPLATES_DIR)

let updated = 0
for (const f of files) {
  const rel = path.relative(TEMPLATES_DIR, f)
  const parts = rel.split(path.sep)
  // 支持嵌套结构, 比如 'ssp_templates/camera/flyTo.json'
  // → category = 'camera', subcategory = 'root'
  // 或 'ssp_templates/some-cat/some-sub/foo.json'
  // → category = 'some-cat', subcategory = 'some-sub'
  const filename = parts.pop()
  // 跳过顶层 ssp_templates (如果有)
  if (parts[0] === 'ssp_templates') parts.shift()
  // 剩下的: [一级目录] 或 [一级目录, 二级目录]
  const subcategory = parts.length >= 2 ? parts[parts.length - 1] : 'root'
  const category = parts[0] ?? 'root'

  const raw = await fs.readFile(f, 'utf8')
  let json
  try {
    json = JSON.parse(raw)
  } catch {
    console.warn('skip invalid JSON:', rel)
    continue
  }

  if (json.category !== category || json.subcategory !== subcategory) {
    json.category = category
    json.subcategory = subcategory
    await fs.writeFile(f, JSON.stringify(json, null, 2) + '\n', 'utf8')
    updated++
  }
}

console.log(`[fix-template-paths] ${updated} templates updated`)