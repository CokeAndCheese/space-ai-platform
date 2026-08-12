#!/usr/bin/env node
/**
 * normalize-placeholders.mjs
 *
 * 阶段 1 第二步: 占位模板规范化。
 *
 * 改动:
 *   - 加 status: 'placeholder' 字段
 *   - 移掉 method (没可用 API, LLM 别用)
 *   - method 改名 _placeholderMethod 防止冲突
 *   - code / example 改成 "TODO" 提示
 *   - signature 加 "(未实现) " 前缀
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATES_DIR = path.resolve(__dirname, '../src/templates/ssp_templates')

async function walk(dir) {
  const out = []
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(full)))
    else if (entry.name.endsWith('.json')) out.push(full)
  }
  return out
}

let changed = 0
for (const f of await walk(TEMPLATES_DIR)) {
  let json
  try { json = JSON.parse(await fs.readFile(f, 'utf8')) } catch { continue }
  if (!json._deprecatedMethod) continue

  json.status = 'placeholder'
  json._placeholderMethod = json._deprecatedMethod
  delete json._deprecatedMethod

  // method 字段直接删 — 占位模板没可用 API
  delete json.method

  // signature 加 "(未实现)" 前缀
  if (json.signature) {
    json.signature = `(待实现) ${json.signature}`
  }

  // code / example 用 TODO 占位
  json.code = `/* TODO: 等 ${json._placeholderMethod.split('/')[0].trim()} API 实现后填入 */
const placeholder = { status: 'not_implemented', api: ${JSON.stringify(json._placeholderMethod)} };
console.log('[template placeholder]', ${JSON.stringify(json.id)}, placeholder);`

  json.example = `/* TODO: 实现后可参考的伪代码 */
/* ${json._placeholderMethod.split('/')[0].trim()}().xxx() */`

  // tags 加 'placeholder'
  json.tags = Array.isArray(json.tags) ? [...json.tags, 'placeholder'] : ['placeholder']

  await fs.writeFile(f, JSON.stringify(json, null, 2) + '\n', 'utf8')
  changed++
}

console.log(`[normalize-placeholders] ${changed} templates marked as placeholder`)