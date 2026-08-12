#!/usr/bin/env node
/**
 * rename-template-ids.mjs
 *
 * 阶段 1 模板梳理: 把别名 id 重命名为 ssp 主名 id。
 *
 * 重命名映射:
 *   setCameraViewpoint → setViewpoint
 *   getCameraViewpoint → getViewpoint
 *   clearScene         → clear
 *   addAxesHelper      → addAxes
 *   addGridHelper      → addGrid
 *
 * 改动:
 *   - 模板文件 id 字段
 *   - 文件名 (xxx.json → yyy.json)
 *   - 其他模板的 seeAlso / steps[].template 里的引用
 *   - docs 里的引用 (SSPTool_API_CATALOG.md / README.md / PROJECT_SUMMARY.md)
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATES_DIR = path.resolve(__dirname, '../src/templates/ssp_templates')
const DOCS = [
  path.resolve(__dirname, '../docs/SSPTool_API_CATALOG.md'),
  path.resolve(__dirname, '../README.md'),
  path.resolve(__dirname, '../PROJECT_SUMMARY.md'),
]

const RENAME_MAP = {
  setCameraViewpoint: 'setViewpoint',
  getCameraViewpoint: 'getViewpoint',
  clearScene: 'clear',
  addAxesHelper: 'addAxes',
  addGridHelper: 'addGrid',
}

// 前缀变体 (老命名格式)
const PREFIX_VARIANTS = Object.keys(RENAME_MAP).flatMap((k) => [
  `core-api.${k}`,
  `ssp.${k}`,
])

async function walk(dir) {
  const out = []
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(full)))
    else if (entry.name.endsWith('.json')) out.push(full)
  }
  return out
}

let renamedFiles = 0
let renamedRefs = 0

// === 第一步: 重命名文件 + 改 id ===
const renameQueue = []
for (const f of await walk(TEMPLATES_DIR)) {
  const json = JSON.parse(await fs.readFile(f, 'utf8'))
  if (!json.id) continue
  // 直接命中
  let newId = RENAME_MAP[json.id]
  // 命中前缀变体 (core-api.setCameraViewpoint → setViewpoint)
  if (!newId) {
    const stripped = PREFIX_VARIANTS.find((v) => v === json.id)
    if (stripped) newId = RENAME_MAP[stripped.replace(/^(core-api|ssp)\./, '')]
  }
  if (!newId) continue

  const newName = path.basename(f).replace(json.id, newId)
  if (newName !== path.basename(f)) {
    const newPath = path.join(path.dirname(f), newName)
    renameQueue.push({ old: f, new: newPath })
  }
  json.id = newId
  json._renamedFrom = path.basename(f).replace('.json', '')
  await fs.writeFile(f, JSON.stringify(json, null, 2) + '\n', 'utf8')
  renamedFiles++
}

// 物理重命名
for (const { old, new: newPath } of renameQueue) {
  await fs.rename(old, newPath)
  console.log(`[rename] ${path.basename(old)} → ${path.basename(newPath)}`)
}

// === 第二步: 更新所有模板的 seeAlso / steps ===
function resolveRef(ref) {
  if (RENAME_MAP[ref]) return RENAME_MAP[ref]
  const stripped = PREFIX_VARIANTS.find((v) => v === ref)
  if (stripped) return RENAME_MAP[stripped.replace(/^(core-api|ssp)\./, '')]
  return null
}

for (const f of await walk(TEMPLATES_DIR)) {
  let json
  try { json = JSON.parse(await fs.readFile(f, 'utf8')) } catch { continue }
  let modified = false
  if (Array.isArray(json.seeAlso)) {
    json.seeAlso = json.seeAlso.map((ref) => {
      const fixed = resolveRef(ref)
      if (fixed) {
        modified = true
        renamedRefs++
        return fixed
      }
      return ref
    })
  }
  if (Array.isArray(json.steps)) {
    for (const step of json.steps) {
      if (step.template) {
        const fixed = resolveRef(step.template)
        if (fixed) {
          step.template = fixed
          modified = true
          renamedRefs++
        }
      }
    }
  }
  if (modified) {
    await fs.writeFile(f, JSON.stringify(json, null, 2) + '\n', 'utf8')
  }
}

// === 第三步: 更新 docs ===
for (const f of DOCS) {
  try {
    let text = await fs.readFile(f, 'utf8')
    let modified = false
    for (const [old, neu] of Object.entries(RENAME_MAP)) {
      // 只改显式引用 — 在 markdown 链接里或模板路径里
      const oldPath = `${old}.json`
      const newPath = `${neu}.json`
      // 改模板路径引用 (.../ssp_templates/camera/setCameraViewpoint.json)
      const pathRe = new RegExp(`ssp_templates/[^/]+/${old}\\.json`, 'g')
      if (pathRe.test(text)) {
        text = text.replace(pathRe, (m) => m.replace(oldPath, newPath))
        modified = true
        renamedRefs++
      }
    }
    if (modified) {
      await fs.writeFile(f, text, 'utf8')
      console.log(`[doc-updated] ${path.relative(path.resolve(__dirname, '..'), f)}`)
    }
  } catch {}
}

console.log(`[rename-template-ids] ${renamedFiles} files renamed, ${renamedRefs} refs updated`)