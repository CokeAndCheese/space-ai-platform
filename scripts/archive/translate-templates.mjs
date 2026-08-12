/**
 * Translate soonspace-skill templates to ssp-shim syntax
 *
 * Each translation rule maps:
 *   - soonspace method name -> ssp-shim path
 *   - soonspace argument shape -> ssp-shim argument shape
 *
 * Translation map (soonspace -> ssp-shim):
 *
 *   ssp.flyTo(pos, rotation?, opts?)
 *     -> ssp.cameraController.tweenCamera({ position: pos, target: ?, enableTransition: true })
 *     target 保持当前 controls.target (soonspace 也支持 rotation,这里我们忽略)
 *
 *   ssp.flyMainViewpoint()
 *     -> ssp.cameraController.flyMainViewpoint()
 *
 *   ssp.getCameraViewpoint() / ssp.setCameraViewpoint(vp)
 *     -> ssp.cameraController.getViewpoint() / setViewpoint(vp)
 *
 *   ssp.setBackgroundColor(color)
 *     -> ssp.sceneTool.setBackgroundColor(color)   [needs impl]
 *
 *   ssp.setFog / ssp.enableFog / ssp.disableFog
 *     -> ssp.sceneTool.setFog / enableFog / disableFog   [needs impl]
 *
 *   ssp.createAmbientLight / ssp.createDirectionalLight / ssp.setAmbientLight
 *     -> ssp.lightTool.createAmbientLight / createDirectionalLight / setAmbientLight   [needs impl]
 *
 *   ssp.loadModelByUrl(url)
 *     -> ssp.modelTool.loadModel(url)   [needs impl]
 *
 *   ssp.createMesh / createPoint / createLine / createIcon / createLink / createNode
 *     -> ssp.objectsTool.createMesh / createPoint / createLine / createIcon / createLink / createNode   [needs impl]
 *
 *   ssp.createPoi / ssp.createPoiNode / ssp.showPoi / ssp.hidePoi
 *     -> ssp.poiManager.add / ...   [needs impl]
 *
 *   ssp.flyToObject(obj) / ssp.controls.flyToObject(obj)
 *     -> ssp.cameraController.flyToObject(obj)
 *
 *   ssp.controls.tweenCamera(opts)
 *     -> ssp.cameraController.tweenCamera(opts)
 *
 *   ssp.controls.setCameraViewpoint(name)  [name 是预设视角,SOONSPACE 概念]
 *     -> ssp.cameraController.setViewpoint({ position, target, fov })  [name 需查表]
 *
 *   ssp.controls.lock() / unlock()
 *     -> ssp.cameraController.controls.enabled = false / true   [needs impl]
 *
 *   ssp.surroundOnTarget(target) / ssp.startStopSurround()
 *     -> ssp.cameraController.surroundOnTarget / startStopSurround   [needs impl]
 *
 *   ssp.stopSurround
 *     -> ssp.cameraController.stopSurround
 *
 *   ssp.createCanvas3D / ssp.dispose / ssp.clearScene / ssp.update
 *     -> ssp.sceneTool.*   [needs impl]
 *
 *   ssp.setControlsOptions / ssp.getObjectById / ssp.getObjectByUserDataProperty
 *     -> ssp.sceneTool.* / ssp.objectsTool.*   [needs impl]
 *
 *   ssp.addAxesHelper / ssp.addGridHelper
 *     -> ssp.helperTool.*   [needs impl]
 *
 *   ssp.addTweenAnimation(opts)
 *     -> ssp.animationTool.addTween(opts)   [needs impl]
 *
 *   ssp.setInstanceHighlight(obj, color, pulse)
 *     -> ssp.objectsTool.setHighlight(obj, color, pulse)   [needs impl]
 *
 *   ssp.measureDistance / ssp.measureArea / ssp.measureAngle
 *     -> ssp.measureTool.*   [needs impl — three-mesh-bvh]
 *
 *   ssp.cssRenderer.*
 *     -> ssp.cssTool.*   [needs impl]
 *
 *   ssp.screenshot(w, h, mime)
 *     -> ssp.viewer.screenshot(w, h, mime)   [needs impl]
 *
 *   ssp.loadSbmByUrl / ssp.createTopology
 *     -> ssp.sbmTool.* / ssp.topologyTool.*   [SBM 是 soonspace 私有格式,跳过或 TODO]
 *
 *   ssp.enableBloom / ssp.renderPipeline.* / ssp.effectHighlight
 *     -> ssp.postprocessingTool.*   [needs impl — pmndrs/postprocessing]
 *
 *   ssp.fogShadow
 *     -> ssp.sceneTool.setFog + setShadow   [needs impl]
 *
 * For each template we do the translation conservatively:
 *   - parse code as text
 *   - replace soonspace method calls with ssp-shim equivalents
 *   - if no translation rule, leave code as-is but add a TODO comment
 *
 * For unimplemented methods we add a comment marker so we know which APIs to build next.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

const TEMPLATES_DIR = path.resolve('src/templates')

// Translation rules: array of [regex, replacement, note]
// Order matters — more specific rules first
const RULES = [
  // ---- implemented: ssp-shim cameraController ----
  // soonspace flyTo(pos, rotation?, opts?) -> ssp-shim flyTo(pos, {enableTransition, done})
  // 第 2 个 rotation 参数被丢弃(我们不接受欧拉角输入)
  // 第 3 个 opts.duration 映射为 enableTransition = true,done 映射为 done
  [/\bssp\.flyTo\b/g, 'ssp.cameraController.flyTo', 'implemented (rotation param dropped)'],
  [/\bssp\.flyMainViewpoint\b/g, 'ssp.cameraController.flyMainViewpoint', 'implemented'],
  [/\bssp\.getCameraViewpoint\b/g, 'ssp.cameraController.getViewpoint', 'implemented'],
  [/\bssp\.setCameraViewpoint\b/g, 'ssp.cameraController.setViewpoint', 'implemented'],
  [/\bssp\.flyToObject\b/g, 'ssp.cameraController.flyToObject', 'implemented'],
  [/\bssp\.controls\.flyToObject\b/g, 'ssp.cameraController.flyToObject', 'implemented'],
  [/\bssp\.controls\.tweenCamera\b/g, 'ssp.cameraController.tweenCamera', 'implemented'],
  [/\bssp\.controls\.setCameraViewpoint\b/g, 'ssp.cameraController.setViewpoint', 'implemented (preset name not yet supported, pass full viewpoint object)'],

  // ---- NEEDS IMPL: list separately so we can mark them ----
  [/\bssp\.setBackgroundColor\b/g, 'ssp.sceneTool.setBackgroundColor', 'TODO: sceneTool'],
  [/\bssp\.setBackground\b/g, 'ssp.sceneTool.setBackground', 'TODO: sceneTool'],
  [/\bssp\.setFog\b/g, 'ssp.sceneTool.setFog', 'TODO: sceneTool'],
  [/\bssp\.enableFog\b/g, 'ssp.sceneTool.enableFog', 'TODO: sceneTool'],
  [/\bssp\.disableFog\b/g, 'ssp.sceneTool.disableFog', 'TODO: sceneTool'],
  [/\bssp\.enableShadow\b/g, 'ssp.sceneTool.enableShadow', 'TODO: sceneTool'],
  [/\bssp\.disableShadow\b/g, 'ssp.sceneTool.disableShadow', 'TODO: sceneTool'],

  // light
  [/\bssp\.createAmbientLight\b/g, 'ssp.lightTool.createAmbientLight', 'TODO: lightTool'],
  [/\bssp\.createDirectionalLight\b/g, 'ssp.lightTool.createDirectionalLight', 'TODO: lightTool'],
  [/\bssp\.setAmbientLight\b/g, 'ssp.lightTool.setAmbientLight', 'TODO: lightTool'],

  // model
  [/\bssp\.loadModelByUrl\b/g, 'ssp.modelTool.loadModel', 'TODO: modelTool'],

  // objects
  [/\bssp\.createMesh\b/g, 'ssp.objectsTool.createMesh', 'TODO: objectsTool'],
  [/\bssp\.createPoint\b/g, 'ssp.objectsTool.createPoint', 'TODO: objectsTool'],
  [/\bssp\.createLine\b/g, 'ssp.objectsTool.createLine', 'TODO: objectsTool'],
  [/\bssp\.createIcon\b/g, 'ssp.objectsTool.createIcon', 'TODO: objectsTool'],
  [/\bssp\.createLink\b/g, 'ssp.objectsTool.createLink', 'TODO: objectsTool'],
  [/\bssp\.createNode\b/g, 'ssp.objectsTool.createNode', 'TODO: objectsTool'],
  [/\bssp\.createGroup\b/g, 'ssp.objectsTool.createGroup', 'TODO: objectsTool'],
  [/\bssp\.createPolygon\b/g, 'ssp.objectsTool.createPolygon', 'TODO: objectsTool'],
  [/\bssp\.createTopology\b/g, 'ssp.topologyTool.createTopology', 'TODO: topologyTool'],

  // poi
  [/\bssp\.createPoi\b/g, 'ssp.poiManager.add', 'TODO: poiManager'],
  [/\bssp\.createPoiNode\b/g, 'ssp.poiManager.addNode', 'TODO: poiManager'],
  [/\bssp\.showPoi\b/g, 'ssp.poiManager.show', 'TODO: poiManager'],
  [/\bssp\.hidePoi\b/g, 'ssp.poiManager.hide', 'TODO: poiManager'],
  [/\bssp\.showHidePoi\b/g, 'ssp.poiManager.setVisible', 'TODO: poiManager'],

  // object queries
  [/\bssp\.getObjectById\b/g, 'ssp.objectsTool.getById', 'TODO: objectsTool'],
  [/\bssp\.getObjectByUserDataProperty\b/g, 'ssp.objectsTool.getByUserDataProperty', 'TODO: objectsTool'],
  [/\bssp\.getById\b/g, 'ssp.objectsTool.getById', 'TODO: objectsTool'],
  [/\bssp\.objectManager\.getById\b/g, 'ssp.objectsTool.getById', 'TODO: objectsTool'],
  [/\bssp\.setObjectVisible\b/g, 'ssp.objectsTool.setVisible', 'TODO: objectsTool'],

  // isolate
  [/\bssp\.isolateFloor\b/g, 'ssp.objectsTool.isolateFloor', 'TODO: objectsTool'],

  // helpers
  [/\bssp\.addAxesHelper\b/g, 'ssp.helperTool.addAxes', 'TODO: helperTool'],
  [/\bssp\.addGridHelper\b/g, 'ssp.helperTool.addGrid', 'TODO: helperTool'],

  // animation
  [/\bssp\.addTweenAnimation\b/g, 'ssp.animationTool.addTween', 'TODO: animationTool'],

  // highlight
  [/\bssp\.setInstanceHighlight\b/g, 'ssp.objectsTool.setHighlight', 'TODO: objectsTool'],

  // scene management
  [/\bssp\.createCanvas3D\b/g, 'ssp.viewer.createCanvas', 'TODO: viewer'],
  [/\bssp\.clearScene\b/g, 'ssp.sceneTool.clear', 'TODO: sceneTool'],
  [/\bssp\.dispose\b/g, 'ssp.sceneTool.dispose', 'TODO: sceneTool'],
  [/\bssp\.update\b/g, 'ssp.viewer.update', 'TODO: viewer'],

  // controls
  [/\bssp\.setControlsOptions\b/g, 'ssp.cameraController.setControlsOptions', 'TODO: cameraController'],
  [/\bssp\.controls\.lock\b/g, 'ssp.cameraController.controls.enabled = false', 'TODO'],
  [/\bssp\.controls\.unlock\b/g, 'ssp.cameraController.controls.enabled = true', 'TODO'],

  // surround
  [/\bssp\.surroundOnTarget\b/g, 'ssp.cameraController.surroundOnTarget', 'TODO'],
  [/\bssp\.startStopSurround\b/g, 'ssp.cameraController.startSurround / stopSurround', 'TODO'],

  // screenshot
  [/\bssp\.screenshot\b/g, 'ssp.viewer.screenshot', 'TODO: viewer'],

  // css renderer
  [/\bssp\.cssRenderer\./g, 'ssp.cssTool.', 'TODO: cssTool'],

  // measure
  [/\bssp\.measureDistance\b/g, 'ssp.measureTool.distance', 'TODO: measureTool'],
  [/\bssp\.measureArea\b/g, 'ssp.measureTool.area', 'TODO: measureTool'],
  [/\bssp\.measureAngle\b/g, 'ssp.measureTool.angle', 'TODO: measureTool'],

  // sbm
  [/\bssp\.loadSbmByUrl\b/g, 'ssp.sbmTool.load', 'TODO: sbm (soonspace 私有格式)'],

  // fog shadow
  [/\bssp\.fogShadow\b/g, 'ssp.sceneTool.setFogAndShadow', 'TODO: sceneTool'],

  // render pipeline
  [/\bssp\.renderPipeline\./g, 'ssp.postprocessingTool.', 'TODO: postprocessingTool'],
  [/\bssp\.enableBloom\b/g, 'ssp.postprocessingTool.enableBloom', 'TODO: postprocessingTool'],
  [/\bssp\.addMarker\b/g, 'ssp.postprocessingTool.addMarker', 'TODO: postprocessingTool'],
  [/\bssp\.effectHighlight\b/g, 'ssp.objectsTool.highlight', 'TODO: objectsTool'],

  // events
  [/\bssp\.on\(/g, 'ssp.events.on(', 'TODO: events'],
  [/\bssp\.off\(/g, 'ssp.events.off(', 'TODO: events'],

  // plugin
  [/\bssp\.registerPlugin\(/g, 'ssp.plugin.register(', 'TODO: plugin'],

  // ssp.fogShadow
  [/\bssp\.addMarker\b/g, 'ssp.postprocessingTool.addMarker', 'TODO: postprocessingTool'],
]

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

function translateCode(code, fileLabel) {
  let out = code
  for (const [regex, repl, note] of RULES) {
    if (regex.test(out)) {
      out = out.replace(regex, repl)
    }
  }
  return out
}

async function main() {
  let touched = 0
  const todos = new Set()

  for await (const filePath of walkJsonFiles(TEMPLATES_DIR)) {
    const raw = await fs.readFile(filePath, 'utf8')
    const json = JSON.parse(raw)

    // 翻译 code
    if (typeof json.code === 'string') {
      const newCode = translateCode(json.code, filePath)
      if (newCode !== json.code) {
        json.code = newCode
        touched++
      }
    }
    // 翻译 example
    if (typeof json.example === 'string') {
      const newExample = translateCode(json.example, filePath)
      if (newExample !== json.example) {
        json.example = newExample
      }
    }
    // 翻译 method 字段
    if (typeof json.method === 'string') {
      const newMethod = translateCode(json.method, filePath)
      if (newMethod !== json.method) {
        json.method = newMethod
      }
    }
    // 收集 TODO 标记
    for (const [regex, , note] of RULES) {
      if (note && note.startsWith('TODO') && regex.test(json.code ?? '')) {
        todos.add(note)
      }
    }

    // sdk 改为 ssp-shim
    if (typeof json.sdk === 'string') {
      json.sdk = 'ssp-shim'
    }

    // intent 保留不动 (已经是中文多角度)

    await fs.writeFile(filePath, JSON.stringify(json, null, 2) + '\n', 'utf8')
  }

  console.log(`[translate] touched ${touched} templates`)
  console.log(`[translate] unimplemented APIs we need to build (${todos.size}):`)
  for (const t of todos) console.log(`  - ${t}`)
}

main().catch((err) => {
  console.error('[translate] failed:', err)
  process.exit(1)
})