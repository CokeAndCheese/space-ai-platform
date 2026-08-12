#!/usr/bin/env node
/**
 * fix-placeholder-code.mjs
 *
 * 修 normalize-placeholders.mjs 留下的 bug:
 *   - code 字段里有 json.id (ReferenceError)
 *   - example 字段里有 "ssp.ssp." (双前缀)
 *
 * 只动 status='placeholder' 的模板。
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

let fixed = 0
for (const f of await walk(TEMPLATES_DIR)) {
  const json = JSON.parse(await fs.readFile(f, 'utf8'))
  if (json.status !== 'placeholder') continue
  const method = json._placeholderMethod?.split('/')[0].trim() || ''

  json.code = `/* TODO: 等 ${method} API 实现后填入 */
const placeholder = { status: 'not_implemented', api: ${JSON.stringify(method)} };
console.log('[template placeholder]', ${JSON.stringify(json.id)}, placeholder);`

  json.example = `/* TODO: 实现后可参考的伪代码 */
/* ${method}().xxx() */`

  await fs.writeFile(f, JSON.stringify(json, null, 2) + '\n', 'utf8')
  fixed++
}

console.log(`[fix-placeholder-code] ${fixed} templates fixed`)