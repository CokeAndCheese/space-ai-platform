# Template Layer Phase 0 Inventory

> 自动生成：`npm run phase0:generate`。不要手工编辑。本模板任务不修改 SSP 源码。

## 完成状态

- Controller：10/10
- Controller methods（当前 checkout 实际扫描）：85
- CR-SSP-001/003 新增方法（当前 checkout）：4/4
- SSP 合入后目标方法数：85
- Capability classification：mapped 71 / host-only 13 / blocked 1 / deprecated 0
- Unclassified：0
- Legacy v2 templates：79/79 baseline entries
- Template code classification：atomic 33 / composite 40 / non-SSP 1 / app-dependent 5

**Phase 0 分类账完成：unclassified=0；SSP 已实施，模板 Runtime 语义迁移仍待完成。**

说明：`mapped` 表示至少有一个 atomic/composite v2 code 引用，不表示允许 AI 调用；`blocked` 表示只被 app-dependent 模板引用；`host-only` 表示当前没有 v2 code 引用。

## SSP 实施交接与模板迁移门槛

- SSP 状态：implemented-upstream-template-runtime-migration-pending
- 源码同步状态：integrated-in-current-checkout
- 已实施公共方法：`objectsTool.query`, `objectsTool.describe`, `objectsTool.applyHighlight`, `objectsTool.releaseHighlight`
- 当前清单只把本 checkout 中实际存在的方法计入 Capability classification，不伪造尚未合入此 checkout 的源码能力。
- `query-scene` 当前状态：app-dependent; dependencies=[scene-traverse, ssp-context, timer]。必须迁移为 `query -> describe/action`，不得再遍历 scene、直读 metadata 或创建 timer。
- `clearAllHighlights` 当前状态：aiEnabled=true; classification=atomic。该 SSP API 仅供宿主紧急全局恢复，AI/template 必须撤销直接调用。
- Runtime 待办：execution-local capability table；maximum 32 active highlight leases per execution；AI durationMs maximum 60000；release execution-owned leases on cancel or timeout；project, redact, bound, and serialize every public result。
- 主任务验证记录：test:objects (13 cases)、typecheck、test:topology、audit:topology-boundary、audit:templates、audit:ai-boundary、build。

## Controller 计数

| Namespace | Methods | Mapped | Blocked | Host-only |
|---|---:|---:|---:|---:|
| cameraController | 6 | 5 | 1 | 0 |
| sceneTool | 5 | 5 | 0 | 0 |
| lightTool | 3 | 3 | 0 | 0 |
| helperTool | 3 | 3 | 0 | 0 |
| modelTool | 12 | 6 | 0 | 6 |
| objectsTool | 16 | 12 | 0 | 4 |
| poiManager | 8 | 7 | 0 | 1 |
| cssTool | 3 | 2 | 0 | 1 |
| viewerTool | 6 | 5 | 0 | 1 |
| topologyTool | 23 | 23 | 0 | 0 |

## 尚无可接受 v2 映射的 SSP 方法

- `cameraController.surroundOnTarget` — blocked; src/ssp/camera/cameraController.ts:129; app-dependent=[surroundOnTarget]
- `cssTool.list` — host-only; src/ssp/css/cssTool.ts:69; app-dependent=[none]
- `modelTool.getFloorNameByLevel` — host-only; src/ssp/model/modelTool.ts:141; app-dependent=[none]
- `modelTool.getFloorNamesByBuilding` — host-only; src/ssp/model/modelTool.ts:140; app-dependent=[none]
- `modelTool.getLoadedSubcategories` — host-only; src/ssp/model/modelTool.ts:138; app-dependent=[none]
- `modelTool.getSubcategories` — host-only; src/ssp/model/modelTool.ts:143; app-dependent=[none]
- `modelTool.loadAll` — host-only; src/ssp/model/modelTool.ts:130; app-dependent=[none]
- `modelTool.unloadSubcategory` — host-only; src/ssp/model/modelTool.ts:134; app-dependent=[none]
- `objectsTool.applyHighlight` — host-only; src/ssp/objects/objectsTool.ts:110; app-dependent=[none]
- `objectsTool.describe` — host-only; src/ssp/objects/objectsTool.ts:106; app-dependent=[none]
- `objectsTool.query` — host-only; src/ssp/objects/objectsTool.ts:105; app-dependent=[none]
- `objectsTool.releaseHighlight` — host-only; src/ssp/objects/objectsTool.ts:111; app-dependent=[none]
- `poiManager.getById` — host-only; src/ssp/poi/poiManager.ts:93; app-dependent=[none]
- `viewerTool.getById` — host-only; src/ssp/viewer/viewerTool.ts:86; app-dependent=[none]

## 非 SSP 或应用依赖模板

- `captureMainViewpoint` — app-dependent; dependencies=[window]; calls=[cameraController.getViewpoint]
- `flyToMainViewpoint` — app-dependent; dependencies=[window]; calls=[cameraController.fitScene, cameraController.setViewpoint, modelTool.getFloorInfo, modelTool.getLoadedFloors]
- `surroundOnTarget` — app-dependent; dependencies=[timer]; calls=[cameraController.surroundOnTarget, objectsTool.getByUserDataProperty]
- `highlightIsolate` — app-dependent; dependencies=[scene-traverse, ssp-context]; calls=[cameraController.flyToObject, objectsTool.getByUserDataProperty, objectsTool.setHighlight, objectsTool.setVisible]
- `query-scene` — app-dependent; dependencies=[scene-traverse, ssp-context, timer]; calls=[cameraController.fitScene, cameraController.flyToObject, modelTool.getFloorInfo, objectsTool.getById, objectsTool.getByName, objectsTool.getByUserDataProperty, objectsTool.isExploded, objectsTool.setHighlight, objectsTool.setVisible, objectsTool.unHighlight]
- `help` — non-SSP; dependencies=[none]; calls=[none]

## 重复映射

- 被多个模板引用的 SSP 方法：23
  - `cameraController.flyToObject` <- `floor`, `fly-to-floor`, `flyToObject`, `focus-on-object`
  - `lightTool.createAmbientLight` <- `createAmbientLight`, `removeLight`, `setAmbientLight`
  - `modelTool.getFloorInfo` <- `fitScene`, `flyToObject`
  - `modelTool.getLoadedFloors` <- `fitScene`, `flyToObject`, `setVisibleByFloor`, `unloadAllModels`, `unloadFloor`
  - `objectsTool.getById` <- `focus-on-object`, `getObjectById`
  - `objectsTool.getByUserDataProperty` <- `flash-alarm`, `floor`, `fly-to-floor`, `getObjectByUserDataProperty`, `highlight-objects`, `setObjectHighlight`, `setObjectVisible`, `unHighlightObject`
  - `objectsTool.isExploded` <- `collapse-floor`, `explode-floor`
  - `objectsTool.setHighlight` <- `flash-alarm`, `focus-on-object`, `highlight-objects`, `setObjectHighlight`
  - `objectsTool.setVisibleByFloor` <- `floor`, `setVisibleByFloor`
  - `poiManager.add` <- `createPoi`, `showHidePoi`
  - `poiManager.hide` <- `hidePoi`, `showHidePoi`
  - `poiManager.list` <- `hidePoi`, `removePoi`, `showHidePoi`, `showPoi`
  - `poiManager.show` <- `showHidePoi`, `showPoi`
  - `topologyTool.create` <- `createTopology`, `hideTopology`, `removeTopology`, `showTopology`
  - `topologyTool.createGraph` <- `createGraph`, `findPath`, `getGraph`, `getRouteById`, `hideRoute`, `listGraphs`, `listRoutes`, `removeAllGraphs`, `removeAllRoutes`, `removeGraph`, `removeRoute`, `renderRoute`, `setEdgeRoutingState`, `setEdgeVisualState`, `setRouteVisualState`, `showRoute`
  - `topologyTool.findPath` <- `findPath`, `getRouteById`, `hideRoute`, `listRoutes`, `removeAllRoutes`, `removeRoute`, `renderRoute`, `setRouteVisualState`, `showRoute`
  - `topologyTool.getById` <- `getTopologyById`, `hideTopology`, `removeTopology`, `showTopology`
  - `topologyTool.getGraph` <- `findPath`, `getGraph`, `getRouteById`, `hideRoute`, `listGraphs`, `listRoutes`, `removeAllRoutes`, `removeGraph`, `removeRoute`, `renderRoute`, `setEdgeRoutingState`, `setEdgeVisualState`, `setRouteVisualState`, `showRoute`
  - `topologyTool.getRouteById` <- `getRouteById`, `hideRoute`, `setRouteVisualState`, `showRoute`
  - `topologyTool.list` <- `getTopologyById`, `hideTopology`, `listTopologies`, `removeTopology`, `showTopology`
  - `topologyTool.listGraphs` <- `listGraphs`, `removeAllGraphs`
  - `topologyTool.listRoutes` <- `listRoutes`, `removeAllRoutes`
  - `topologyTool.renderRoute` <- `getRouteById`, `hideRoute`, `listRoutes`, `removeAllRoutes`, `removeRoute`, `renderRoute`, `setRouteVisualState`, `showRoute`

- 被多个 atomic v2 模板一一绑定的方法：1
  - `lightTool.createAmbientLight` <- `createAmbientLight`, `setAmbientLight`

## 元数据与真实代码不一致

共有 39 个模板的 `method` 元数据与实际 SSP 调用集合不一致。
- `fitScene`: metadata=[cameraController.fitScene], code=[cameraController.fitScene, modelTool.getFloorInfo, modelTool.getLoadedFloors]
- `flyToMainViewpoint`: metadata=[cameraController.setViewpoint], code=[cameraController.fitScene, cameraController.setViewpoint, modelTool.getFloorInfo, modelTool.getLoadedFloors]
- `flyToObject`: metadata=[cameraController.flyToObject], code=[cameraController.flyToObject, modelTool.getFloorInfo, modelTool.getLoadedFloors]
- `surroundOnTarget`: metadata=[cameraController.surroundOnTarget], code=[cameraController.surroundOnTarget, objectsTool.getByUserDataProperty]
- `removeLight`: metadata=[lightTool.removeLight], code=[lightTool.createAmbientLight, lightTool.removeLight]
- `unloadAllModels`: metadata=[modelTool.unloadAll], code=[modelTool.getLoadedFloors, modelTool.unloadAll]
- `unloadFloor`: metadata=[modelTool.unloadFloor], code=[modelTool.getLoadedFloors, modelTool.unloadFloor]
- `collapse-floor`: metadata=[objectsTool.collapseFloor], code=[objectsTool.collapseFloor, objectsTool.isExploded]
- `explode-floor`: metadata=[objectsTool.explodeFloor], code=[objectsTool.explodeFloor, objectsTool.isExploded]
- `floor`: metadata=[cameraController.flyToObject, objectsTool.setVisibleByFloor], code=[cameraController.flyToObject, objectsTool.getByUserDataProperty, objectsTool.setVisibleByFloor]
- `query-scene`: metadata=[none], code=[cameraController.fitScene, cameraController.flyToObject, modelTool.getFloorInfo, objectsTool.getById, objectsTool.getByName, objectsTool.getByUserDataProperty, objectsTool.isExploded, objectsTool.setHighlight, objectsTool.setVisible, objectsTool.unHighlight]
- `setObjectHighlight`: metadata=[objectsTool.setHighlight], code=[objectsTool.getByUserDataProperty, objectsTool.setHighlight]
- `setObjectVisible`: metadata=[objectsTool.setVisible], code=[objectsTool.getByUserDataProperty, objectsTool.setVisible]
- `setVisibleByFloor`: metadata=[objectsTool.setVisibleByFloor], code=[modelTool.getLoadedFloors, objectsTool.setVisibleByFloor]
- `unHighlightObject`: metadata=[objectsTool.unHighlight], code=[objectsTool.getByUserDataProperty, objectsTool.unHighlight]
- `hidePoi`: metadata=[poiManager.hide], code=[poiManager.hide, poiManager.list]
- `removePoi`: metadata=[poiManager.remove], code=[poiManager.list, poiManager.remove]
- `showHidePoi`: metadata=[poiManager.hide, poiManager.show], code=[poiManager.add, poiManager.hide, poiManager.list, poiManager.show]
- `showPoi`: metadata=[poiManager.show], code=[poiManager.list, poiManager.show]
- `findPath`: metadata=[topologyTool.findPath], code=[topologyTool.createGraph, topologyTool.findPath, topologyTool.getGraph]
- `getGraph`: metadata=[topologyTool.getGraph], code=[topologyTool.createGraph, topologyTool.getGraph]
- `getRouteById`: metadata=[topologyTool.getRouteById], code=[topologyTool.createGraph, topologyTool.findPath, topologyTool.getGraph, topologyTool.getRouteById, topologyTool.renderRoute]
- `getTopologyById`: metadata=[topologyTool.getById], code=[topologyTool.getById, topologyTool.list]
- `hideRoute`: metadata=[topologyTool.hideRoute], code=[topologyTool.createGraph, topologyTool.findPath, topologyTool.getGraph, topologyTool.getRouteById, topologyTool.hideRoute, topologyTool.renderRoute]
- `hideTopology`: metadata=[topologyTool.hide], code=[topologyTool.create, topologyTool.getById, topologyTool.hide, topologyTool.list]
- `listGraphs`: metadata=[topologyTool.listGraphs], code=[topologyTool.createGraph, topologyTool.getGraph, topologyTool.listGraphs]
- `listRoutes`: metadata=[topologyTool.listRoutes], code=[topologyTool.createGraph, topologyTool.findPath, topologyTool.getGraph, topologyTool.listRoutes, topologyTool.renderRoute]
- `removeAllGraphs`: metadata=[topologyTool.removeAllGraphs], code=[topologyTool.createGraph, topologyTool.listGraphs, topologyTool.removeAllGraphs]
- `removeAllRoutes`: metadata=[topologyTool.removeAllRoutes], code=[topologyTool.createGraph, topologyTool.findPath, topologyTool.getGraph, topologyTool.listRoutes, topologyTool.removeAllRoutes, topologyTool.renderRoute]
- `removeGraph`: metadata=[topologyTool.removeGraph], code=[topologyTool.createGraph, topologyTool.getGraph, topologyTool.removeGraph]
- `removeRoute`: metadata=[topologyTool.removeRoute], code=[topologyTool.createGraph, topologyTool.findPath, topologyTool.getGraph, topologyTool.removeRoute, topologyTool.renderRoute]
- `removeTopology`: metadata=[topologyTool.remove], code=[topologyTool.create, topologyTool.getById, topologyTool.list, topologyTool.remove]
- `renderRoute`: metadata=[topologyTool.renderRoute], code=[topologyTool.createGraph, topologyTool.findPath, topologyTool.getGraph, topologyTool.renderRoute]
- `setEdgeRoutingState`: metadata=[topologyTool.setEdgeRoutingState], code=[topologyTool.createGraph, topologyTool.getGraph, topologyTool.setEdgeRoutingState]
- `setEdgeVisualState`: metadata=[topologyTool.setEdgeVisualState], code=[topologyTool.createGraph, topologyTool.getGraph, topologyTool.setEdgeVisualState]
- `setRouteVisualState`: metadata=[topologyTool.setRouteVisualState], code=[topologyTool.createGraph, topologyTool.findPath, topologyTool.getGraph, topologyTool.getRouteById, topologyTool.renderRoute, topologyTool.setRouteVisualState]
- `showRoute`: metadata=[topologyTool.showRoute], code=[topologyTool.createGraph, topologyTool.findPath, topologyTool.getGraph, topologyTool.getRouteById, topologyTool.renderRoute, topologyTool.showRoute]
- `showTopology`: metadata=[topologyTool.show], code=[topologyTool.create, topologyTool.getById, topologyTool.list, topologyTool.show]
- `removeCanvas3D`: metadata=[viewerTool.remove], code=[viewerTool.list, viewerTool.remove]

## 参数消费

共有 39 个模板至少存在一个声明但未被 code 消费的参数。
- `flyTo`: ignored=[opt.done, opt.enableTransition, position], consumed=[none]
- `flyToObject`: ignored=[enableTransition, idOrObj], consumed=[none]
- `setViewpoint`: ignored=[data], consumed=[none]
- `surroundOnTarget`: ignored=[opts.heightOffset, opts.radius, opts.speed, target], consumed=[none]
- `css2dLabel`: ignored=[opts.bgColor, opts.color, opts.fontSize, opts.position, opts.size, opts.text], consumed=[none]
- `addAxes`: ignored=[options], consumed=[none]
- `addGrid`: ignored=[options.color, options.divisions, options.position, options.size], consumed=[none]
- `createAmbientLight`: ignored=[options.color, options.intensity], consumed=[none]
- `createDirectionalLight`: ignored=[options.color, options.intensity, options.position, options.target], consumed=[none]
- `removeLight`: ignored=[id], consumed=[none]
- `setAmbientLight`: ignored=[options.color, options.id, options.intensity], consumed=[none]
- `loadFloor`: ignored=[floorNameOrUrl], consumed=[none]
- `loadSubcategory`: ignored=[subcategory], consumed=[none]
- `unloadFloor`: ignored=[floorName], consumed=[none]
- `flash-alarm`: ignored=[color, renderType], consumed=[none]
- `floor`: ignored=[floorName, options.flyTo], consumed=[none]
- `fly-to-floor`: ignored=[floorName, options.done, options.enableTransition, options.scope], consumed=[none]
- `focus-on-object`: ignored=[color, id], consumed=[none]
- `getObjectById`: ignored=[id], consumed=[none]
- `getObjectByName`: ignored=[fuzzy, name], consumed=[none]
- `getObjectByUserDataProperty`: ignored=[key, opts.scope, value], consumed=[none]
- `highlight-objects`: ignored=[color, key, value], consumed=[none]
- `highlightIsolate`: ignored=[color, key, value], consumed=[none]
- `setObjectHighlight`: ignored=[color, pulse, sid], consumed=[none]
- `setObjectVisible`: ignored=[sid, visible], consumed=[none]
- `setVisibleByFloor`: ignored=[floorName, visible], consumed=[none]
- `unHighlightObject`: ignored=[sid], consumed=[none]
- `createPoi`: ignored=[opts.attachTo, opts.color, opts.fontSize, opts.iconSize, opts.position, opts.text, opts.textColor, opts.visible], consumed=[none]
- `createPoiNode`: ignored=[opts, opts.onClick, opts.onHover], consumed=[none]
- `hidePoi`: ignored=[id], consumed=[none]
- `removePoi`: ignored=[id], consumed=[none]
- `showHidePoi`: ignored=[id], consumed=[none]
- `showPoi`: ignored=[id], consumed=[none]
- `clear`: ignored=[keepCameraLight], consumed=[none]
- `setBackgroundColor`: ignored=[color], consumed=[none]
- `setFog`: ignored=[options], consumed=[none]
- `createCanvas3D`: ignored=[opts.cameraPosition, opts.cameraTarget, opts.label, opts.position, opts.size], consumed=[none]
- `removeCanvas3D`: ignored=[id], consumed=[none]
- `screenshot`: ignored=[opts.download, opts.filename, opts.format, opts.height, opts.quality, opts.width], consumed=[none]

## v2 冻结规则

- `v2-template-baseline.json` 固定现有 code 模板的 id + path。
- 删除现有 v2 模板允许用于迁移；新增或重命名含 `code` 的 v2 模板会使 `npm run audit:phase0` 失败。
- 未知 SSP 方法、动态/间接方法访问、SSP 解构和模板字符串插值一律失败；冻结阶段不再扩展 legacy JavaScript 语法。
- 只有显式运行 `--init-baseline` 才能重建基线；普通 generate/check 不会扩展基线。
- Phase 1+ 新模板必须使用 v3 目录与声明式 schema，不得加入 legacy `ssp_templates` code 集合。
