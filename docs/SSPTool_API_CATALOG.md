# SSPTool API Catalog

> ssp-shim 完整 API 目录，并标出当前已有的模板映射；部分底层 API 没有独立模板。

最后更新: 2026-08-14 (objectsTool 有界查询/描述与高亮租约)

## 总览

| 类别 | 数量 |
|---|---|
| 上下文工具 | 4 (setContext / getContext / hasContext / clearContext) |
| Controller | 10 (camera / scene / light / helper / model / objects / poi / css / viewer / topology) |
| DEV diagnostics | 1 (`window.sspDev.modelInspector`,不属于 SSP API) |
| Controller methods | 85 |
| 公开 callable 总数 | 89 (85 controller methods + 4 上下文函数) |
| 公开 members 总数 | 90 (callable 89 + `cameraController.controls` 属性) |
| 模板总数 | 79 (active) |
| 占位模板 | 0 |
| soonspace 兼容 | 0 (阶段 2.5 清完) |

`controls` 是 `CameraControls` 实例属性，不是可调用方法；因此可调用函数口径为 89，
若按 namespace 的公开 members 计数则为 90。模板数量、组合数、AI 开放数以
`npm run audit:templates` 的当前输出为准。

## 1. 命名空间

`ssp-shim` 把 Three.js 能力封装为 10 个 controller,通过 `ssp.<namespace>.<api>()` 调用。

## 2. 控制器列表

### 2.1 `ssp.cameraController` — 相机操作(7 个 API: 6 + 1 controls)

| API | 签名 | 模板 |
|---|---|---|
| `flyTo` | `(position, opt?)` 或 `({position, target})` | [flyTo](../src/templates/ssp_templates/camera/flyTo.json) |
| `flyToObject` | `(idOrObj, opt?)` | [flyToObject](../src/templates/ssp_templates/camera/flyToObject.json) |
| `setViewpoint` | `(vp)` | [setViewpoint](../src/templates/ssp_templates/camera/setViewpoint.json) |
| `getViewpoint` | `()` | [getViewpoint](../src/templates/ssp_templates/camera/getViewpoint.json) |
| `surroundOnTarget` | `(target, opts?)` | [surroundOnTarget](../src/templates/ssp_templates/camera/surroundOnTarget.json) |
| `fitScene` | `(objects, opts?)` | [fitScene](../src/templates/ssp_templates/camera/fitScene.json) |
| `controls` | (CameraControls 实例) | (用 controls.xxx 直接) |

**Viewpoint 字段**: `position` / `target` / `rotation?` (欧拉角,XYZ) / `fov?`

**flyTo 模板**:
- `flyTo({position: {x,y,z}})` — 飞到位置, target 保持当前
- `flyTo({position, target})` — 同时设两点

**fitScene**: 自动 fit 相机到一组对象 (多 GLB 合并 Box3 + bounding sphere + aspect 校正 + view 预设: 'iso' / 'front' / 'top' / 'side' / 'current')

### 2.2 `ssp.sceneTool` — 场景控制(5 个 API)

| API | 签名 | 模板 |
|---|---|---|
| `setBackgroundColor` | `(color)` | [setBackgroundColor](../src/templates/ssp_templates/scene/setBackgroundColor.json) |
| `setFog` | `(opts?)` | [setFog](../src/templates/ssp_templates/scene/setFog.json) |
| `clear` | `(keepCameraLight?)` | [clear](../src/templates/ssp_templates/scene/clear.json) |
| `dispose` | `()` | [dispose](../src/templates/ssp_templates/scene/dispose.json) |
| `update` | `()` | [update](../src/templates/ssp_templates/scene/update.json) |

⚠️ `dispose` 只释放 GPU 资源,不 remove 对象。切场景: `clear()` + `loadSubcategory()`。

### 2.3 `ssp.lightTool` — 灯光(3 个 API)

| API | 签名 | 模板 |
|---|---|---|
| `createAmbientLight` | `(opts?)` | [createAmbientLight](../src/templates/ssp_templates/light/createAmbientLight.json), [setAmbientLight](../src/templates/ssp_templates/light/setAmbientLight.json) |
| `createDirectionalLight` | `(opts?)` | [createDirectionalLight](../src/templates/ssp_templates/light/createDirectionalLight.json) |
| `removeLight` | `(id?) → number` | [removeLight](../src/templates/ssp_templates/light/removeLight.json) |

### 2.4 `ssp.helperTool` — 辅助(3 个 API)

| API | 签名 | 模板 |
|---|---|---|
| `addAxes` | `(opts?)` | [addAxes](../src/templates/ssp_templates/helper/addAxes.json) |
| `addGrid` | `(opts?)` | [addGrid](../src/templates/ssp_templates/helper/addGrid.json) |
| `removeAll` | `()` | — |

### 2.5 `ssp.modelTool` — 模型加载(12 个 API)

| API | 签名 | 模板 |
|---|---|---|
| `loadFloor` | `(floorNameOrUrl)` | (无模板,基础设施) |
| `loadSubcategory` | `(subcategory?)` | — |
| `loadAll` | `()` | — |
| `unloadFloor` | `(floorName)` | — |
| `unloadSubcategory` | `(subcategory)` | — |
| `unloadAll` | `()` | — |
| `getLoadedFloors` | `()` | — |
| `getLoadedSubcategories` | `()` | — |
| `getFloorInfo` | `(floorName)` | — |
| `getFloorNamesByBuilding` | `(building)` | — |
| `getFloorNameByLevel` | `(building, level)` | — |
| `getSubcategories` | `()` | — |

⚠️ `loadSubcategory` 现在限并发 8,55 个 GLB ~5-10s 加载完。

### 2.6 `ssp.objectsTool` — 对象操作(16 个 API)

| API | 签名 | 模板 |
|---|---|---|
| `getByName` | `(name, opts?)` | (无模板) |
| `getById` | `(id, opts?)` | [getObjectById](../src/templates/ssp_templates/objects/getObjectById.json) |
| `getByUserDataProperty` | `(key, value, opts?)` | [getObjectByUserDataProperty](../src/templates/ssp_templates/objects/getObjectByUserDataProperty.json) |
| `query` | `(criteria, { limit }) → Object3D[]` | —（仅供受控 Runtime 内部组合） |
| `describe` | `(objects, { fields? }?) → SceneObjectDescriptor[]` | —（AI 输出仍由 Runtime 投影/脱敏） |
| `setHighlight` | `(obj, color?, pulse?)` | [highlight-objects](../src/templates/ssp_templates/objects/highlight-objects.json), [flash-alarm](../src/templates/ssp_templates/objects/flash-alarm.json) |
| `unHighlight` | `(obj)` | — |
| `clearAllHighlights` | `()` | [clearAllHighlights](../src/templates/ssp_templates/objects/clearAllHighlights.json) |
| `applyHighlight` | `(objects, options?) → HighlightLease` | —（Runtime capability） |
| `releaseHighlight` | `(lease) → boolean` | —（仅接受原始不透明 handle） |
| `setVisible` | `(obj, visible)` | — |
| `setVisibleByFloor` | `(floorName, visible?)` | [floor](../src/templates/ssp_templates/objects/floor.json) |
| `resetVisibility` | `() → {restored, hiddenBefore}` | [resetVisibility](../src/templates/ssp_templates/objects/resetVisibility.json) |
| `explodeFloor` | `(opts?)` | [explode-floor](../src/templates/ssp_templates/objects/explode-floor.json) |
| `collapseFloor` | `(durationMs?)` | — |
| `isExploded` | `()` | — |

`FindOptions.scope` 限定查找范围 (subcategory / building)。

`query` 只接受编译期字段白名单、扁平 AND、`equals/in` 和必填 `limit`；不接受动态属性路径、业务规则、排序或分页。`describe` 只返回有界 plain data。`applyHighlight/releaseHighlight` 使用对象 identity 校验的不透明租约，重叠采用后写优先；模型移除或 context 清理会自动回收材质 clone 与 timer。`clearAllHighlights` 仅作为宿主紧急全局恢复能力，新模板和补偿流程不得调用。

**resetVisibility** (阶段 2.5 新增): 一键把所有 mesh 设为 visible=true (跳过 Camera/Light/helper),返回 `{restored, hiddenBefore}` 给 UI 反馈用。

**animatePosition 内部**: rAF + easeInOutQuad + cancel 机制 (闭包 `activeAnim`)。

### 2.7 `ssp.poiManager` — POI 标注(8 个 API)

| API | 签名 | 模板 |
|---|---|---|
| `add` | `(opts?)` | [createPoi](../src/templates/ssp_templates/poi/createPoi.json) |
| `addNode` | `(opts?: 含 onClick/onHover/hoverColor)` | [createPoiNode](../src/templates/ssp_templates/poi/createPoiNode.json) |
| `show` | `(id)` | [showHidePoi](../src/templates/ssp_templates/poi/showHidePoi.json) |
| `hide` | `(id)` | — |
| `remove` | `(id)` | — |
| `removeAll` | `()` | — |
| `getById` | `(id)` | — |
| `list` | `()` | — |

⚠️ `addNode` 现在真正支持交互(2026-07 阶段 2 收尾):
- `onClick(e)` — 点击 POI 触发,e 含 `{ poiId, originalEvent, poi }`
- `onHover(e)` — 鼠标 hover,e 含 `{ poiId, type: 'enter'|'leave', poi }`
- `hoverColor` — hover 时 sprite color 变这个色

### 2.8 `ssp.cssTool` — Sprite 标签(3 个 API)

| API | 签名 | 模板 |
|---|---|---|
| `createCSS2DObject` | `(opts?)` | [css2dLabel](../src/templates/ssp_templates/css/css2dLabel.json) |
| `removeAll` | `()` | — |
| `list` | `()` | — |

⚠️ 实际是 WebGL Sprite (不是 CSS2DRenderer),名字误导。

### 2.9 `ssp.viewerTool` — 多画布 + 截图(6 个 API)

| API | 签名 | 模板 |
|---|---|---|
| `createCanvas` | `(opts?)` | [createCanvas3D](../src/templates/ssp_templates/viewer/createCanvas3D.json) |
| `getById` | `(id)` | — |
| `remove` | `(id)` | — |
| `removeAll` | `()` | — |
| `list` | `()` | — |
| `screenshot` | `(opts?) → Promise<dataURL>` | [screenshot](../src/templates/ssp_templates/viewer/screenshot.json) |

`screenshot` 选项: `format` (png/jpeg/webp) / `quality` (0-1) / `download` (true 触发下载) / `filename` / `width` / `height`。实现: 临时 RT + readRenderTargetPixels,不依赖 preserveDrawingBuffer。

**createCanvas**: 创建子画布 (snapshot 模式 5fps),子相机独立 + 用户能拖, 主 canvas 不污染 (不创建额外 WebGL context)。

### 2.10 `ssp.topologyTool` — 静态图兼容层 + 空间路网(23 个 API)

`topologyTool` 只接收调用方显式提供的通用图数据。它不解析 BIM SID、不查询
WALL/STAIR/FACILITY、不推断连接关系，也不调用其他 SSP controller。

| 分组 | API |
|---|---|
| legacy 静态图 | `create` / `show` / `hide` / `getById` / `list` / `remove` / `removeAll` |
| 路网生命周期 | `createGraph` / `getGraph` / `listGraphs` / `removeGraph` / `removeAllGraphs` |
| 边状态与寻路 | `setEdgeRoutingState` / `setEdgeVisualState` / `findPath` |
| 路线渲染 | `renderRoute` / `setRouteVisualState` / `showRoute` / `hideRoute` / `getRouteById` / `listRoutes` / `removeRoute` / `removeAllRoutes` |

边界：`topologyTool.removeAll()` 只删除 legacy 静态图；不会触碰 v2 图或路线。
`removeAllGraphs()` 才是 v2 图的批量清理入口，并按图所有权级联释放关联边和路线；
路线也可单独使用 `removeAllRoutes()` 清理。

v2 支持稳定 edge ID、折线几何长度、通行/权重/blocker 状态、任意边显隐/颜色/
flow、同 connector 跨层边、最多 4 组必经节点的精确约束 Dijkstra，以及直接叠加在
模型上的 3D 路线。业务元数据 `kind/subtype/mode/tags/data` 可读但不被核心解释。

完整签名、流转关系和示例见 [topologyTool API 与内部设计](./topologyTool_API.md)。
所有 topology 原子模板默认 `aiEnabled:false`；AI 只应选择由这些原子能力组合出的
高层业务模板。

## 3. 别名(已删除)

⚠️ 历史别名已清理,模板 + 代码都用新名:
- ~~`setCameraViewpoint`~~ → `setViewpoint`
- ~~`getCameraViewpoint`~~ → `getViewpoint`
- ~~`addAxesHelper`~~ → `addAxes`
- ~~`addGridHelper`~~ → `addGrid`
- ~~`clearScene`~~ → `clear`

✅ 阶段 2.5 (2026-08-03) 清掉 soonspace 兼容:
- 删 `ssp.viewer.update` 别名 → 用 `ssp.sceneTool.update`
- 删 `ssp.viewer.screenshot` 别名 → 用 `ssp.viewerTool.screenshot`

(模板 `viewer/screenshot.json` 已更新用 `ssp.viewerTool.screenshot`)

## 4. 组合模板

`src/templates/ssp_templates/objects/` 下含 `steps` 的 4 个模板是组合工作流:

| 模板 | 涉及 API |
|---|---|
| highlight-objects | getByUserDataProperty + setHighlight |
| flash-alarm | getByUserDataProperty + setHighlight(pulse=true) |
| floor | getByUserDataProperty + setVisibleByFloor + flyToObject |
| focus-on-object | getById + setHighlight + flyToObject |

## 5. 模板目录与封版统计

模板按实际目录（一级 `category`）分布如下；全部文件均为 active，placeholder 为 0。

| category | 文件数 |
|---|---:|
| camera | 8 |
| css | 2 |
| helper | 3 |
| light | 4 |
| model | 4 |
| objects | 18 |
| poi | 7 |
| scene | 6 |
| topology | 23 |
| viewer | 4 |
| **合计** | **79** |

其中组合模板（含 `steps`）4 个，`aiEnabled:true` 8 个；topology 目录的 23 个
原子模板全部 `aiEnabled:false`，高层业务流程应通过组合模板承接。

## 6. 占位模板统计

| 状态 | 数量 |
|---|---|
| active | 79 |
| placeholder | 0 |
| **合计** | 79 |

> 2026-07: 12 个占位模板已删除,全部由组合模板或现有 API 覆盖。
> 已删占位: `addTweenAnimation` / `click-show-poi` / `effectHighlight` / `enableBloom` / `addOutputEffect` / `keyboardControls` / `loadModelByUrl` / `loadScene` / `lock` / `measureDistance` / `setControlsOptions`。旧 `createTopology` 占位也曾删除，2026-08 已由当前可执行 legacy 兼容模板和 v2 路网模板替代。
> 
> 后续如需这些能力,会作为新模板加回 (schema 已稳定, 占位不再需要)。
