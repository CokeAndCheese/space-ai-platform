// scripts/test-ssp.mjs
// 用法:
//   1. 浏览器开 http://localhost:5174/#/sandbox
//   2. 选 hospital 场景 (等加载完)
//   3. Chrome DevTools console 粘贴下面那一坨 (在 const __test = ... 后面整段)
//
// 或者更直接: 把下面内容写成一个 JS 文件, 在沙盒 UI 的 code 字段 paste 整个文件
// 但因为 code 是 JSON 字符串, 注释会被去, 所以推荐用 DevTools console 方式

const __test = async () => {
  const r = []
  const log = (m) => { console.log(m); r.push(m) }

  log('=== ssp-shim 完整测试 ===')

  // 1. camera (7 个 API)
  log('\n── 1. camera ──')
  try {
    const vp = ssp.cameraController.getCameraViewpoint()
    log('1.1 getCameraViewpoint: ' + JSON.stringify({ x: vp.position.x.toFixed(0), y: vp.position.y.toFixed(0), z: vp.position.z.toFixed(0) }))
  } catch (e) { log('1.1 getCameraViewpoint FAIL: ' + e.message) }

  try {
    ssp.cameraController.setCameraViewpoint(ssp.cameraController.getViewpoint())
    log('1.2 setCameraViewpoint: OK')
  } catch (e) { log('1.2 setCameraViewpoint FAIL: ' + e.message) }

  const a6f = ssp.objectsTool.getByUserDataProperty('floorName', 'A_6F')[0]
  log('1.3 find A_6F: ' + (a6f ? 'found' : 'not found'))

  if (a6f) {
    try {
      const stopFn = ssp.cameraController.surroundOnTarget(a6f, { speed: 1.0 })
      log('1.4 surroundOnTarget: started, stop fn=' + typeof stopFn)
      setTimeout(() => { stopFn(); log('1.4 surround: stopped') }, 2000)
    } catch (e) { log('1.4 surroundOnTarget FAIL: ' + e.message) }

    ssp.cameraController.flyToObject(a6f).then(() => log('1.5 flyToObject: done')).catch(e => log('1.5 flyToObject FAIL: ' + e.message))
    ssp.cameraController.flyMainViewpoint().then(() => log('1.6 flyMainViewpoint: done')).catch(e => log('1.6 flyMainViewpoint FAIL: ' + e.message))
    ssp.cameraController.flyTo({ x: 0, y: 100, z: 200 }).then(() => log('1.7 flyTo: done')).catch(e => log('1.7 flyTo FAIL: ' + e.message))
  }

  // 2. model
  log('\n── 2. model ──')
  try {
    log('2.1 getLoadedFloors: ' + ssp.modelTool.getLoadedFloors().length)
    log('2.2 getLoadedSubcategories: ' + JSON.stringify(ssp.modelTool.getLoadedSubcategories()))
    const info = ssp.modelTool.getFloorInfo('A_6F')
    log('2.3 getFloorInfo A_6F: ' + (info ? `building=${info.building} level=${info.level} name=${info.name}` : 'undefined'))
  } catch (e) { log('2. model FAIL: ' + e.message) }

  // 3. scene
  log('\n── 3. scene ──')
  try { ssp.sceneTool.setBackgroundColor('#0a0a1a'); log('3.1 setBackgroundColor: done') } catch (e) { log('3.1 setBackgroundColor FAIL: ' + e.message) }
  try { ssp.sceneTool.setFog({ color: '#444466', near: 100, far: 500 }); log('3.2 setFog: done') } catch (e) { log('3.2 setFog FAIL: ' + e.message) }
  try { ssp.sceneTool.update(); log('3.3 update: done') } catch (e) { log('3.3 update FAIL: ' + e.message) }
  log('3.4 clearScene: SKIP (会清空模型, 单独测)')
  log('3.5 dispose: SKIP (会销毁, 单独测)')

  // 4. light
  log('\n── 4. light ──')
  try {
    const h1 = ssp.lightTool.createAmbientLight({ color: '#ffaa00', intensity: 0.6 })
    log('4.1 createAmbientLight: id=' + h1.id)
  } catch (e) { log('4.1 createAmbientLight FAIL: ' + e.message) }
  try { ssp.lightTool.setAmbientLight({ intensity: 1.0 }); log('4.2 setAmbientLight: done') } catch (e) { log('4.2 setAmbientLight FAIL: ' + e.message) }
  try {
    const h2 = ssp.lightTool.createDirectionalLight({ color: '#ffffff', intensity: 1.0, position: { x: 50, y: 100, z: 50 } })
    log('4.3 createDirectionalLight: id=' + h2.id)
  } catch (e) { log('4.3 createDirectionalLight FAIL: ' + e.message) }

  // 5. helper
  log('\n── 5. helper ──')
  try {
    const axes = ssp.helperTool.addAxesHelper({ size: 50 })
    log('5.1 addAxesHelper: id=' + axes.id)
  } catch (e) { log('5.1 addAxesHelper FAIL: ' + e.message) }
  try {
    const grid = ssp.helperTool.addGridHelper({ size: 200, divisions: 20 })
    log('5.2 addGridHelper: id=' + grid.id)
  } catch (e) { log('5.2 addGridHelper FAIL: ' + e.message) }

  setTimeout(() => {
    try { ssp.helperTool.removeAll(); log('5.3 removeAll: done') } catch (e) { log('5.3 removeAll FAIL: ' + e.message) }

    // 6. objects
    log('\n── 6. objects ──')
    try {
      const a = ssp.objectsTool.getById('CEILING_A_6F_1')
      log('6.1 getById CEILING_A_6F_1: ' + (a ? 'found' : 'not found'))
    } catch (e) { log('6.1 getById FAIL: ' + e.message) }
    try {
      const arr = ssp.objectsTool.getByUserDataProperty('renderType', 'CEILING')
      log('6.2 getByUserDataProperty CEILING: ' + arr.length)
    } catch (e) { log('6.2 getByUserDataProperty FAIL: ' + e.message) }
    try {
      const a = ssp.objectsTool.getById('CEILING_A_6F_1')
      if (a) ssp.objectsTool.setHighlight(a, '#ff0000')
      log('6.3 setHighlight: ' + (a ? 'done' : 'no obj'))
    } catch (e) { log('6.3 setHighlight FAIL: ' + e.message) }
    setTimeout(() => {
      try { ssp.objectsTool.clearAllHighlights(); log('6.4 clearAllHighlights: done') } catch (e) { log('6.4 clearAllHighlights FAIL: ' + e.message) }
      try { ssp.objectsTool.setVisibleByFloor('A_6F'); log('6.5 setVisibleByFloor A_6F: done (只 A_6F 可见)') } catch (e) { log('6.5 setVisibleByFloor FAIL: ' + e.message) }
      setTimeout(() => {
        // 恢复: 取消 A_6F 隔离, 但其他楼层状态不还原
        // 简单办法: location.reload()
        log('6.6 restore: location.reload()')
        setTimeout(() => location.reload(), 500)
      }, 1000)
    }, 500)
  }, 2000)

  // 7. core
  log('\n── 7. core ──')
  log('7.1 hasSspContext: ' + ssp.hasContext())
  log('7.2 hasContext via getContext: ' + !!ssp.getContext().scene)
}

__test()
