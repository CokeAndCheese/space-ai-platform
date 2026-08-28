#!/usr/bin/env node
/**
 * audit-template-schema.mjs
 *
 * 阶段 3 模板梳理: schema 一致性审计。
 *
 * 检查项:
 *   1. 必填字段: id, category, subcategory, code
 *   2. 推荐字段: intent (>=3 个多角度), method, signature, params
 *   3. 字段命名一致性:
 *      - param 字段用 'desc' 还是 'description'?
 *      - seeAlso / steps 的引用都存在吗?
 *   4. 特殊字段:
 *      - placeholder 模板要有 status='placeholder'
 *      - combo 模板有 steps, 引用要合法
 *   5. intent 多角度 (>=3)
 *
 * 输出报告, 不修改
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

const issues = []
const stats = { total: 0, placeholder: 0, combo: 0, aiEnabled: 0, ok: 0 }

const allIds = new Set()
const idFiles = new Map()
for (const f of await walk(TEMPLATES_DIR)) {
  try {
    const json = JSON.parse(await fs.readFile(f, 'utf8'))
    if (json.id) {
      allIds.add(json.id)
      const list = idFiles.get(json.id) || []
      list.push(f)
      idFiles.set(json.id, list)
    }
  } catch {}
}

for (const [id, files] of idFiles) {
  if (files.length > 1) {
    for (const file of files) issues.push({ file, id, kind: 'duplicate_id', msg: files.join(', ') })
  }
}

const AI_DENYLIST = new Set([
  'clear', 'dispose', 'loadFloor', 'loadSubcategory', 'unloadFloor', 'unloadAllModels',
  'removeAllLabels', 'removeHelpers', 'removeLight', 'removeAllPoi', 'removePoi',
  'removeAllCanvases', 'removeCanvas3D', 'screenshot', 'surroundOnTarget',
])

for (const f of await walk(TEMPLATES_DIR)) {
  stats.total++
  let json
  try { json = JSON.parse(await fs.readFile(f, 'utf8')) } catch (e) {
    issues.push({ file: f, kind: 'invalid_json', msg: e.message })
    continue
  }

  const id = json.id || '?'
  const status = json.status || 'active'
  const isPlaceholder = status === 'placeholder'
  const isCombo = Array.isArray(json.steps)
  const isAiEnabled = json.aiEnabled === true
  const declaresTopology = typeof json.method === 'string' &&
    json.method.startsWith('ssp.topologyTool.')
  const callsTopology = typeof json.code === 'string' && /\bssp\.topologyTool\./.test(json.code)
  if (isPlaceholder) stats.placeholder++
  if (isCombo) stats.combo++
  if (isAiEnabled) stats.aiEnabled++
  if (declaresTopology !== callsTopology) {
    issues.push({ file: f, id, kind: 'topology_binding_mismatch' })
  }

  // === 必填字段 ===
  for (const req of ['id', 'category', 'subcategory', 'code']) {
    if (!json[req]) issues.push({ file: f, id, kind: 'missing_field', field: req })
  }

  if (json.id && path.basename(f, '.json') !== json.id) {
    issues.push({ file: f, id, kind: 'filename_id_mismatch', msg: `filename=${path.basename(f, '.json')}` })
  }

  try {
    // Compile only. The template is not executed during the static audit.
    new Function('ssp', 'THREE', 'params', `"use strict"; return (async () => { ${json.code}\n})();`)
  } catch (error) {
    issues.push({ file: f, id, kind: 'code_syntax', msg: error.message })
  }

  // === 占位模板必须有 status='placeholder' ===
  if (json._placeholderMethod && !isPlaceholder) {
    issues.push({ file: f, id, kind: 'placeholder_no_status', msg: '有 _placeholderMethod 但 status!=placeholder' })
  }

  // === 推荐字段 ===
  if (!isPlaceholder) {
    if (!json.intent || json.intent.length < 3) {
      issues.push({ file: f, id, kind: 'intent_too_few', msg: `intent 长度 ${json.intent?.length || 0} (<3)` })
    }
    if (!json.method && !json._placeholderMethod) {
      issues.push({ file: f, id, kind: 'missing_method' })
    }
    if (!json.signature) {
      issues.push({ file: f, id, kind: 'missing_signature' })
    }
  }

  // === params 字段命名一致性 ===
  if (Array.isArray(json.params)) {
    for (const p of json.params) {
      if (p.description && !p.desc) {
        issues.push({ file: f, id, kind: 'param_inconsistent', msg: `param '${p.name}' 用 description 而不是 desc` })
      }
      if (!p.name) issues.push({ file: f, id, kind: 'param_no_name' })
      if (!p.type) issues.push({ file: f, id, kind: 'param_no_type', param: p.name })
      if (p.required === undefined) issues.push({ file: f, id, kind: 'param_no_required', param: p.name })
    }
  }

  if (isAiEnabled) {
    if (declaresTopology) {
      issues.push({ file: f, id, kind: 'topology_ai_exposure' })
    }
    if (AI_DENYLIST.has(id)) {
      issues.push({ file: f, id, kind: 'dangerous_ai_template' })
    }
    if (!Array.isArray(json.params)) {
      issues.push({ file: f, id, kind: 'ai_params_missing' })
    } else if (json.params.length > 0 && !/\bparams\b/.test(json.code)) {
      issues.push({ file: f, id, kind: 'ai_code_ignores_params' })
    }
  }

  // === seeAlso 引用 ===
  if (Array.isArray(json.seeAlso)) {
    for (const ref of json.seeAlso) {
      if (!allIds.has(ref)) issues.push({ file: f, id, kind: 'seeAlso_broken', ref })
    }
  }

  // === steps 引用 ===
  if (Array.isArray(json.steps)) {
    for (const s of json.steps) {
      if (s.template && !allIds.has(s.template)) issues.push({ file: f, id, kind: 'step_template_broken', ref: s.template })
    }
  }

  // === SDK 一致性 ===
  if (json.sdk && json.sdk !== 'ssp-shim') {
    issues.push({ file: f, id, kind: 'sdk_unknown', msg: `sdk='${json.sdk}' (期望 ssp-shim)` })
  }

  // === intent 里重复 ===
  if (Array.isArray(json.intent)) {
    const set = new Set(json.intent)
    if (set.size !== json.intent.length) {
      issues.push({ file: f, id, kind: 'intent_dup' })
    }
  }

  if (issues.filter((i) => i.file === f).length === 0) stats.ok++
}

console.log('=== Schema 审计报告 ===')
console.log(`模板总数: ${stats.total}`)
console.log(`  active: ${stats.total - stats.placeholder}`)
console.log(`  placeholder: ${stats.placeholder}`)
console.log(`  combo (有 steps): ${stats.combo}`)
console.log(`  AI enabled: ${stats.aiEnabled}`)
console.log(`  0 错模板: ${stats.ok}`)
console.log(`\n问题总数: ${issues.length}`)

const byKind = {}
for (const i of issues) {
  byKind[i.kind] = (byKind[i.kind] || 0) + 1
}
console.log('\n=== 按问题类型统计 ===')
for (const [k, v] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k}: ${v}`)
}

console.log('\n=== 详细问题清单 ===')
const byFile = new Map()
for (const i of issues) {
  if (!byFile.has(i.file)) byFile.set(i.file, [])
  byFile.get(i.file).push(i)
}
for (const [f, list] of byFile) {
  console.log(`\n${path.relative(TEMPLATES_DIR, f)}`)
  for (const i of list) {
    console.log(`  [${i.kind}] ${i.field || i.ref || ''} ${i.msg || ''}`)
  }
}

if (issues.length > 0) process.exitCode = 1
