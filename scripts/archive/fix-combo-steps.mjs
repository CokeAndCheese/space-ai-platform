#!/usr/bin/env node
/**
 * fix-combo-steps.mjs
 *
 * combo 模板的 `steps[].template` 字段用了老命名 `core-api.sceneTool.getObjectById` 这种带前缀的 id,
 * 实际模板 id 是裸的 `getObjectById`。
 *
 * 这个脚本: 把 `core-api.X.Y` / `combo-workflow.X.Y` / `query-model.X.Y` 等老命名里的最后一段
 * 提取出来,作为新的 template id。
 *
 * 同时也对 `seeAlso` 做相同的处理。
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

// 收集所有模板 id
const files = await walk(TEMPLATES_DIR)
const idMap = new Map() // id -> file
for (const f of files) {
  try {
    const json = JSON.parse(await fs.readFile(f, 'utf8'))
    if (json.id) idMap.set(json.id, f)
  } catch {}
}

// 已知老命名 → 新 id 映射
const NAME_REMAP = {
  'event.object.click': 'click-show-poi',
  'combo-workflow.alarm.flash-alarm': 'flash-alarm',
  'combo-workflow.isolate.floor': 'floor',
  'combo-workflow.highlight.highlight-objects': 'highlight-objects',
  'combo-workflow.fly.fly-to-floor': 'fly-to-floor',
  'combo-workflow.focus.focus-on-object': 'focus-on-object',
  'core-api.sceneTool.setHighlight': null,           // 没有这个独立模板
  'core-api.sceneTool.setVisible': null,             // 没有
  'core-api.sceneTool.addObject': null,
  'core-api.camera.flyToObj': 'flyToObject',
  'core-api.camera.flyToObject': 'flyToObject',
  'core-api.camera.setCameraViewpoint': 'setCameraViewpoint',
  'core-api.camera.getCameraViewpoint': 'getCameraViewpoint',
  'core-api.camera.flyTo': 'flyTo',
  'core-api.camera.flyMainViewpoint': 'flyMainViewpoint',
  'core-api.camera.tweenCamera': null,                // 已删
  'core-api.camera.surroundOnTarget': 'surroundOnTarget',
  'core-api.sceneTool.getObjectById': 'getObjectById',
  'core-api.sceneTool.getObjectByUserDataProperty': 'getObjectByUserDataProperty',
  'core-api.sceneTool.clearScene': 'clearScene',
  'core-api.sceneTool.dispose': 'dispose',
  'core-api.sceneTool.setBackgroundColor': 'setBackgroundColor',
  'core-api.sceneTool.setFog': 'setFog',
  'core-api.sceneTool.update': 'update',
  'core-api.helper.addAxesHelper': 'addAxesHelper',
  'core-api.helper.addGridHelper': 'addGridHelper',
  'core-api.light.createAmbientLight': 'createAmbientLight',
  'core-api.light.setAmbientLight': 'setAmbientLight',
  'core-api.light.createDirectionalLight': 'createDirectionalLight',
  'core-api.poi.createPoi': 'createPoi',
  'core-api.poi.showHidePoi': 'showHidePoi',
  'core-api.poi.showPoi': null,                       // 老别名, 现统一用 showHidePoi
  'core-api.poiNode.createPoiNode': 'createPoiNode',
  'core-api.canvas3D.createCanvas3D': 'createCanvas3D',
  'core-api.css.css2dLabel': 'css2dLabel',
  'core-api.sbm.loadSbmByUrl': null,                  // 已删
  'core-api.model.loadModelByUrl': 'loadModelByUrl',
  'query-model.findByName': null,                     // 已删
  'query-model.findByFloor': null,                    // 不存在
  'query-model.by-sid.findObjectBySid': 'getObjectById',
  'query-model.findBySid': 'getObjectById',
  'uspace-instance.highlight.setInstanceHighlight': 'highlight-objects',  // 重复, 不映射 (已删)
  'uspace-instance.isolation.isolateFloor': 'floor',
  'uspace-instance.manager.getById': 'getObjectById',
  'uspace-camera.camera.flyToObject': 'flyToObject',
  'uspace-camera.camera.lock': 'lock',
  'uspace-camera.input.keyboardControls': 'keyboardControls',
  'uspace-recipe.workflow.flyToFloor': 'fly-to-floor',
  'uspace-recipe.workflow.highlightIsolate': 'highlightIsolate',
  'uspace-recipe.workflow.loadScene': 'loadScene',
  'plugin.first-person-controls.enable': null,
  'scene-object.animation.addTweenAnimation': 'addTweenAnimation',
  'scene-object.topology.createTopology': 'createTopology',
}

function fixRef(ref) {
  if (!ref) return ref
  if (idMap.has(ref)) return ref // 已经是对的 id
  if (NAME_REMAP.hasOwnProperty(ref)) {
    const v = NAME_REMAP[ref]
    if (v === null) return null  // 标记为删除
    return v
  }
  // 兜底: 取最后一段
  const parts = ref.split('.')
  const last = parts[parts.length - 1]
  if (idMap.has(last)) return last
  return null  // 找不到
}

let changedFiles = 0
let changedRefs = 0
for (const f of files) {
  let json
  try { json = JSON.parse(await fs.readFile(f, 'utf8')) } catch { continue }

  let modified = false

  // steps[*].template
  if (Array.isArray(json.steps)) {
    for (const step of json.steps) {
      if (step.template) {
        const fixed = fixRef(step.template)
        if (fixed === null) {
          // 整步被删 (引用不存在的 API)
          step._deprecated = true
          step.template = null
          modified = true
          changedRefs++
        } else if (fixed !== step.template) {
          step.template = fixed
          modified = true
          changedRefs++
        }
        // fixed === step.template 不算修改 (不加 _deprecated)
      }
    }
  }

  // seeAlso[]
  if (Array.isArray(json.seeAlso)) {
    const newRefs = []
    for (const ref of json.seeAlso) {
      const fixed = fixRef(ref)
      if (fixed === null) {
        modified = true
        changedRefs++
        continue  // 跳过
      }
      newRefs.push(fixed)
      if (fixed !== ref) {
        modified = true
        changedRefs++
      }
    }
    json.seeAlso = newRefs
  }

  if (modified) {
    await fs.writeFile(f, JSON.stringify(json, null, 2) + '\n', 'utf8')
    changedFiles++
  }
}

console.log(`[fix-combo-steps] ${changedFiles} templates, ${changedRefs} refs updated`)