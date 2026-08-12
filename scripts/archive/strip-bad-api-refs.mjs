#!/usr/bin/env node
/**
 * strip-bad-api-refs.mjs
 *
 * 把模板 method/example/code 字段里调用"不存在的 ssp API"的引用清掉或标占位。
 *
 * 规则:
 * - method: 如果 ssp.* API 不存在 → method 改成 null (不写 method, 让 LLM 知道这个模板无对应 API, 不可用)
 * - example / code: 删掉调用不存在 API 的那行
 *
 * 期望"以 ssp 为准":只清掉错的,留下真存在的 API 引用。
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATES_DIR = path.resolve(__dirname, '../src/templates/ssp_templates')
const SSP_DIR = path.resolve(__dirname, '../src/ssp')

async function walk(dir) {
  const out = []
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(full)))
    else if (entry.name.endsWith('.json')) out.push(full)
  }
  return out
}

// 收集所有 ssp 已实现的 API 名字 (粗粒度:出现的方法名都算存在)
async function collectAllSspApiNames() {
  const names = new Set()
  for (const entry of await fs.readdir(SSP_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = path.join(SSP_DIR, entry.name)
    for (const f of await fs.readdir(dir)) {
      if (!f.endsWith('.ts')) continue
      const text = await fs.readFile(path.join(dir, f), 'utf8')
      // 提取 方法名: interface / 内部 obj 字面量里的 xxx(
      const m = text.matchAll(/^\s*([a-z][a-zA-Z0-9]*)\s*[:(<]/gm)
      for (const match of m) names.add(match[1])
    }
  }
  return names
}

const apiNames = await collectAllSspApiNames()

const files = await walk(TEMPLATES_DIR)

// 不存在的模块(压根没建)
const NONEXISTENT_MODULES = ['animationTool', 'postprocessingTool', 'measureTool', 'events', 'plugin']

let changed = 0
for (const f of files) {
  let json
  try { json = JSON.parse(await fs.readFile(f, 'utf8')) } catch { continue }

  let modified = false

  // === method ===
  if (json.method && typeof json.method === 'string') {
    const m = json.method.match(/^ssp\.([a-zA-Z]+)\.([a-zA-Z]+)/)
    if (m) {
      const ns = m[1]
      const api = m[2]
      // 模块本身不存在
      if (NONEXISTENT_MODULES.includes(ns)) {
        json._deprecatedMethod = json.method
        delete json.method
        modified = true
      } else if (!apiNames.has(api)) {
        json._deprecatedMethod = json.method
        delete json.method
        modified = true
      }
    }
  }

  // === code / example ===
  for (const field of ['code', 'example']) {
    if (typeof json[field] !== 'string') continue
    let text = json[field]
    const calls = text.matchAll(/ssp\.([a-zA-Z]+)\.([a-zA-Z0-9]+)/g)
    for (const c of calls) {
      const ns = c[1]
      const api = c[2]
      if (NONEXISTENT_MODULES.includes(ns) || !apiNames.has(api)) {
        // 把整行替换成注释 (用 /* */ 块注释)
        // 行可能含多个调用,简单起见只整行替换
        const lines = text.split('\n')
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(`ssp.${ns}.${api}`)) {
            lines[i] = `/* removed: ssp.${ns}.${api} not implemented */`
          }
        }
        text = lines.join('\n')
      }
    }
    if (text !== json[field]) {
      json[field] = text
      modified = true
    }
  }

  if (modified) {
    await fs.writeFile(f, JSON.stringify(json, null, 2) + '\n', 'utf8')
    changed++
  }
}

console.log(`[strip-bad-api-refs] ${changed} templates updated`)