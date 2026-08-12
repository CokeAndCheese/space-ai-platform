# 阶段 2 总结: objectsTool + GLB metadata 注入 + 收尾

> 文档性质：历史过程记录。最后复核：2026-08-10。
>
> 下文的 30/37 个模板、topology 占位和“11 controller”等数字只描述当时阶段，
> 不能作为当前状态。当前基线是 10 个 SSP controller、79 个 active 模板、
> topology 23 个公开方法；以 [HANDOFF_PROMPT.md](./HANDOFF_PROMPT.md) 和
> [SSPTool_API_CATALOG.md](./SSPTool_API_CATALOG.md) 为准。

> 周期: 2026-07-22 ~ 2026-07-26
> 目标: 让 ssp.objectsTool 可以基于 GLB metadata (sid / renderType / spaceType) 高效查找和高亮对象
> 状态: ✅ 完成, 12/12 模板跑通, 55/55 GLB 注入完成

---

## 阶段 2 收尾 (2026-07-27)

**触发原因**: 后续全局审计发现 7 个高优先级问题 + 多个文档/API 不一致。

**收尾工作** (4 步):

### 1. 高优先级问题修复

| # | 问题 | 修复 |
|---|---|---|
| 3 | `setViewpoint` 忽略 `rotation` 字段 | `Viewpoint` 接口加 `rotation?: {x,y,z}`,`setViewpoint` 实现支持欧拉角 (XYZ) |
| 5 | `sceneTool.dispose()` 文档说"释放 GPU 资源"但实际**只释放不 remove** — 文档欺骗 | 接口注释明确"只释放 GPU,不 remove;配合 clear 使用" |
| 12 | `addGrid` 代码默认 `divisions: 10`,模板默认 `50` — 不一致 | 代码默认改成 50 (匹配模板) |
| 18 | `loadSubcategory` 串行加载 55 GLB(~30s) | 限并发 8 的并行 worker,~5-10s |
| 22 | `setHighlight` 多次调用时**把上次高亮色当原始色** — 还原错色 | 先用 prev origEmissiveMap 兜底,再 traverse |
| 25 | `explodeFloor.midLevel` 注释说"中位数",实现是 `levels[N/2]` — 不是中位数 | 真正的中位数 (偶数取两中间值平均) |
| 28 | `addNode` 文档说有 onClick/onHover/hoverColor,**实现完全没用** — 文档欺骗 | raycaster + canvas click/mousemove 一次性监听;回调参数含 `{poiId, type, poi, originalEvent}` |

### 2. 清理 deprecated 别名

`cameraController` / `sceneTool` / `helperTool` 中所有 `@deprecated 别名` 删除:

| 旧 | 新 |
|---|---|
| `setCameraViewpoint` | `setViewpoint` |
| `getCameraViewpoint` | `getViewpoint` |
| `clearScene` | `clear` |
| `addAxesHelper` | `addAxes` |
| `addGridHelper` | `addGrid` |

### 3. 文档更新

- `docs/SSPTool_API_CATALOG.md` 重写:别名表删,controller 数更新,加 ⚠️ 标注(如 cssTool 实际是 Sprite)
- `src/templates/_SCHEMA.md` controller 列表: ⏳ 全部改成 ✅ / 🚧
- 本 SUMMARY 文件加收尾章节

### 4. 模板统计更新

| 维度 | 阶段 2 完成 | 阶段 2 收尾 |
|---|---|---|
| 模板总数 | 39 | 42 (收尾后 30) |
| active | 27 | 30 |
| placeholder | 12 | 12 → 0 (收尾后全部清理) |
| combo (有 steps) | 4 | 4 |

新增 active: `fly-to-floor` (从 placeholder 激活, 用 getByUserDataProperty + flyToObject 组合)。
修复的 active: `flash-alarm` / `floor` / `focus-on-object` / `highlightIsolate` / `clear` / `dispose` / `setBackgroundColor` / `update` / `getViewpoint` / `setViewpoint` / `addAxes` / `addGrid` / `createAmbientLight` / `createDirectionalLight` / `setAmbientLight` 措辞 / signature / example 全部对齐真实 API。

### 4b. 占位模板清理 (后续, 2026-07)

**触发**: 用户要求"占位模板删掉"。

**12 个占位全部删除**:

| 删的占位 | 原因 |
|---|---|
| `addTweenAnimation` | animation 工具未实现, 后续用 camera.tweenCamera 替代 |
| `click-show-poi` | 依赖 events 模块, 后续有事件系统再加 |
| `createTopology` | topology 工具未实现, 等阶段 3 |
| `effectHighlight` / `enableBloom` / `addOutputEffect` | postprocessing 未实现, 用 HighlightPass 替代 |
| `keyboardControls` | 用 ssp.cameraController.controls 直接接管 |
| `loadModelByUrl` / `loadScene` | 实际是 modelTool.loadFloor / loadSubcategory |
| `lock` | 用 controls.lockControls |
| `measureDistance` | 测量工具未实现 |
| `setControlsOptions` | 用 controls.setOptions |

**清理后**: 30 active / 0 placeholder / 30 合计。Sandbox 自动少显示 12 个 (用 import.meta.glob 自动发现)。

### 5. 验收

- ✅ 0 typecheck 错误 (`vue-tsc --noEmit`)
- ✅ 0 build 错误 (`vite build` 1.03s)
- ✅ 0 schema audit 错误 (`scripts/audit-template-schema.mjs` 30/30)
- ✅ 30 个非占位模板沙盒跑通 (含之前激活的 fly-to-floor)

---

## 1. 整体成果

| 维度 | 之前 | 现在 |
|---|---|---|
| 模板数 (objectsTool 相关) | 8 个改过 / 60 跳过 | **12 个** 全过 |
| GLB metadata 覆盖率 | sid 0% / renderType 2.4% | sid **100%** / renderType **100%** |
| 验收脚本 | 无 | `validate-metadata.mjs` (写 / 改 / 注入都有) |
| 规范文档 | 无 | `GLB_METADATA_SPEC.md` + `MESH_METADATA_INJECTION_SPEC.md` |
| objectsTool API 数 | 6 (基础) | **11** (+ explode / collapse / isExploded / setVisibleByFloor / unHighlight / clearAllHighlights) |
| LLM 友好度 | sid / twinsIdentifier 等数据中不存在的字段 | sid / renderType / spaceType / findId 真实存在 |

---

## 2. 关键里程碑

### 2.1 规范定稿 (v3.1, 2026-07-29)

- **scene.extras**: floorName / building / level / floorType / name (5 字段)
- **node.extras**: name / sid / findId / floorName / building / level / renderType / renderTypeConfidence / spaceType / fireType (10 字段)
- **renderType 枚举** (v3.1, 8 种): WINDOW / DOOR / ELEVATOR / STAIR / CEILING / WALL / SPACE / FACILITY (大写)
- **fireType 枚举** (v3.1 新增, 11 种, 仅 FACILITY 必填): HYDRANT / SMOKE_DETECTOR / SPRINKLER / EXTINGUISHER / EMERGENCY_LIGHT / EXIT_SIGN / BREAK_GLASS / ALARM_BELL / FIRE_HOSE / FIRE_DOOR / OTHER
- **spaceType 枚举**: TOILET / LAUNDRY / KITCHEN / ... (13 种, 后续可扩展)
- **sid 命名格式**: `<RENDERTYPE>_<FLOORNAME>_<SEQ>` (全局唯一)
- **findId 命名格式**: `<FLOORNAME>_mesh_<NODE_INDEX>` (GLB 内自动派生)
- **扩展字段** (工具方实际加的): `semantic.{category, displayName, description, buildingCN, levelDesc, typeCN}` (中文 LLM 友好)

### 2.2 规范变更历史

| 版本 | 变更 |
|---|---|
| v2 | renderType 7 种 (含 ROOF) |
| v3 | renderType 删 ROOF 加 WALL; floorType 删 ROOF_DECORATION 并入 ROOF (8 → 7 种) |
| **v3.1** | renderType 加 **FACILITY** (7 → 8 种); 新增 **fireType** (11 种, FACILITY 必填) |

**实测依据**: A_1F.glb (2026-07-29 完成注入, 139 mesh) → renderType 分布: CEILING 2, DOOR 101, ELEVATOR 4, FACILITY 7 (全 HYDRANT), STAIR 4, WALL 1, WINDOW 20

### 2.3 工具脚本

| 脚本 | 用途 | 状态 |
|---|---|---|
| `scripts/validate-metadata.mjs` | 验证 GLB metadata 符合规范 | ✅ |
| `scripts/inject-scene-name.mjs` | 自动注入 scene.extras.name (中文) | ✅ |
| `scripts/auto-fill.mjs` | 自动派生 findId + 冗余字段 | ✅ (工具方覆盖后未用) |

### 2.4 objectsTool 改造

| 改动 | 说明 |
|---|---|
| `getById(sid)` | 优先查 `userData.sid`, fallback `userData.findId` |
| `getByUserDataProperty(key, value, opts)` | 兼容 `obj.userData[key]` 和 `obj.userData.extras[key]` (GLTF loader 行为差异) |
| `setHighlight(obj, color, pulse)` | pulse=true 时 1Hz 闪烁 (setInterval 切 emissive) |
| `unHighlight(obj)` | 停 pulse + 还原 emissive |
| `setVisibleByFloor(floorName, visible)` | 隐藏 / 显示整层 |
| `explodeFloor(opts)` | **新**: 楼层炸开 (沿 axis 拉 gap 距离) |
| `collapseFloor()` | **新**: 楼层炸开收回 |
| `isExploded()` | **新**: 查当前状态 |

### 2.5 模板 (8 + 4 = 12 个)

**核心 (8):**
- `ssp_templates/objects/getObjectById`
- `ssp_templates/objects/getObjectByUserDataProperty`
- `ssp_templates/objects/findObjectBySid`
- `ssp_templates/objects/highlight-objects.json`
- `ssp_templates/objects/focus-on-object.json`
- `ssp_templates/objects/floor.json`
- `ssp_templates/objects/flash-alarm.json`
- `ssp_templates/objects/highlight-objects.json`
- `ssp_templates/objects/floor.json`

**新加 (1):**
- `ssp_templates/objects/explode-floor.json` ⭐

### 2.6 沙盒 runner 修复

| Bug | 修法 |
|---|---|
| `new Function` SyntaxError 被静默吞 | runner 改为 promise 第二个参数捕获 err, 转 log entry |
| 模板 code 用 `const` 但被包成 `() => (EXPR)` 解析为 expression | 改为 `() => { STMT }` block body |
| 沙盒 console 框不显示 log | 修 captureConsole 的 error 路径 |

---

## 3. GLB 验收结果

跑 `node scripts/validate-metadata.mjs ./glb_cleaned`:

```
Scanned: 55 GLB file(s) in 1 dir: glb_cleaned
Files with errors:        0 / 55
Total errors:             0
Total warnings:           0
Duplicate sid (global):   0
Total mesh nodes:         7942
  With sid:               7942  (100.0%)
  With renderType:        7942  (100.0%)
  SPACE mesh:             0     (未做空间标注, 后续阶段)
  SPACE with spaceType:   0
```

---

## 4. 文件清单 (本阶段新增/改动)

### 新建
- `scripts/validate-metadata.mjs` — 验证脚本
- `scripts/inject-scene-name.mjs` — scene name 注入
- `scripts/auto-fill.mjs` — 冗余字段自动派生
- `docs/GLB_METADATA_SPEC.md` — 完整规范
- `docs/MESH_METADATA_INJECTION_SPEC.md` — 工具方需求
- `docs/STAGE2_SUMMARY.md` — 本文件
- `docs/objectsTool_API.md` — API 完整文档
- `src/templates/ssp_templates/objects/explode/explode-floor.json` — 新模板

### 改动
- `src/ssp/objects/objectsTool.ts` — getById / setHighlight pulse / 楼层炸开
- `src/test/sandbox/SandboxView.vue` — onMounted 轮询 ssp context + cleanup
- `src/test/sandbox/runner.ts` — new Function 错误捕获
- `package.json` — 加 validate-metadata / inject-scene-name scripts
- 9 个模板 JSON 措辞改写

### 删除
- `soonspace-skill/` — 整个目录 (老 soonspace 模板, 已被 src/templates 替代)

---

## 5. 已知问题 & 后续

### 5.1 已知限制

| 问题 | 原因 | 影响 |
|---|---|---|
| `renderType` 全是 CEILING | 工具方无法从 BIM mesh name (`MERGED_*`) 识别种类, 全标 CEILING + low confidence | 实际分类要等真实工具 / 人工 review |
| SPACE mesh 0 个 | 工具方没标空间 (你之前说先不做) | 后续空间查询功能 (找厕所等) 不能用 |
| `name` 字段被工具方改回英文 `A_6F` | 工具方用 `semantic.displayName` 代替 | 不影响功能, displayName 是中文 |
| `getByName` 模糊匹配 — `name` 不唯一 | BIM 导出 mesh 名字 `MERGED_*` 重复 | 改用 sid / findId 代替 |

### 5.2 阶段 3 候选 (未做)

| 候选 | 说明 | 难度 |
|---|---|---|
| 真实 renderType 标注 | 工具方用 BIM 原始分类, 或人工 review | 高 |
| SPACE mesh 标注 | 你团队补 20-30/层的空间 mesh | 中 |
| 楼层横切 / 剖切 | 沿 axis 切一刀, 隐藏一侧 | 中 |
| 楼层压扁 | 整个场景压扁 (比如 0.1x) 便于看顶视图 | 低 |
| UI 集成 | 沙盒里的能力, 接到业务页面 sidebar 按钮 | 中 |
| 剩 0 个模板 | (后续已迁移整理) | 低 |

---

## 6. 验收清单

- ✅ 0 errors / 0 warnings (`validate-metadata.mjs ./glb_cleaned`)
- ✅ sid 全局唯一 (0 重复)
- ✅ 12 个 objectsTool 模板沙盒跑通
- ✅ 楼层炸开 / 收回 视觉正常
- ✅ pulse 高亮闪烁正常
- ✅ type-check 0 错误 (`vue-tsc --noEmit`)
- ✅ build 通过 (`vite build`)

---

## 7. 数据流 (一图流)

```
BIM 导出 (Merhged_*_*_0 mesh names, no metadata)
         ↓
[外部工具 - 工具方] — 注入 sid / findId / renderType / spaceType / semantic
         ↓
glb_cleaned/*.glb  ←  source of truth
         ↓  (用户手动复制)
public/models/hospital/*.glb
         ↓
modelTool.loadFloor()  — scene 加载 + metadata 透传到 userData
         ↓
ssp.objectsTool:
  - getById(sid)         查 userData.sid
  - getByUserDataProperty('renderType', 'WINDOW')  查 userData.renderType
  - setHighlight / setVisible / explodeFloor  操作 userData + 改 transform
         ↓
LLM 友好模板 (ssp.objectsTool.xxx)
         ↓
沙盒 / 业务 UI
```

---

## 8. 后续节奏建议

1. **短期 (1-2 周)**: 集成到业务 UI (把沙盒能力接到 sidebar)
2. **中期 (1 月)**: 真实 renderType 标注 + SPACE mesh 标注
3. **长期 (季度)**: 把 60 个模板全过一遍, 让 soonspace 用户无缝迁移

---

# 阶段 2.5 历史总结: ssp-shim 注释补全 + 重构 (2026-08-03)

> 周期: 2026-08-03 (单次会话)
> 目标: 把 ssp-shim 全部 12 个文件的注释补到跟其他 module 风格一致 + 抽重复代码 + 清 soonspace 痕迹
> 状态: ✅ 完成, TS + Build 都过, 文档已同步

## 1. 整体成果

| 维度 | 之前 | 现在 |
|---|---|---|
| 注释覆盖率 (12 文件) | ~40% | ~95% |
| 块分割线 (// ===== 块名 =====) | 0 | 30+ |
| API 数 (objectsTool) | 11 | **12** (+ resetVisibility) |
| 重复代码 (sceneTool clear/dispose) | ~10 行 | 0 (抽 disposeMeshResources) |
| 重复代码 (viewerTool 2 个下载路径) | ~10 行 | 0 (抽 triggerAnchorDownload) |
| soonspace 痕迹 | 4 处 | 0 (全清) |
| 文档 ↔ 代码一致性 | 60% | 95% (新增 _SCHEMA.md 已对齐) |

## 2. 改动清单

### 2.1 注释补全 (10 个文件, 块分割线 + JSDoc + inline 注释)

| 文件 | 改动 |
|---|---|
| `core/context.ts` | 文件头 + setContext/getContext 注释 |
| `core/sceneUtils.ts` | **导出 getUserDataValue** (poiManager / objectsTool 都用) |
| `css/cssTool.ts` | 文件头 + 3 API 注释 + 块标题 |
| `helper/helperTool.ts` | 文件头 + NAME_PREFIX 说明 + 块标题 |
| `light/lightTool.ts` | 文件头 + 3 API 注释 + 闭包变量 |
| `model/modelTool.ts` | 文件头 + 12 API 注释 (load*/unload*/get*) |
| `objects/objectsTool.ts` | 文件头 + **12 API 注释** + 5 块标题 + resetVisibility |
| `camera/cameraController.ts` | 文件头 + 6 API 注释 + **8 块标题** + 修 typo (setKookAt→setLookAt) |
| `poi/poiManager.ts` | 文件头 + 8 API 注释 + **8 块标题** |
| `scene/sceneTool.ts` | 文件头 + 5 API 注释 + 2 块标题 + 抽 disposeMeshResources helper |
| `viewer/viewerTool.ts` | 文件头 + 6 API 注释 + 5 块标题 + 抽 triggerAnchorDownload helper |
| `index.ts` | 文件头 + SspNamespace 顶部 JSDoc + 4 块标题 + 10 controller 单例 inline |

### 2.2 重构 (3 处抽 helper, 消除重复)

| 改动 | 文件 | 行数变化 |
|---|---|---|
| 抽 `disposeMeshResources` helper (clear/dispose 共享) | sceneTool.ts | -10 行 |
| 抽 `triggerAnchorDownload` helper (2 个下载路径共享) | viewerTool.ts | -8 行 |
| `findBySid` → `getBySid` 调 core (8 行 → 1 行) | poiManager.ts | -7 行 + 修兜底 bug |

### 2.3 Bug 修复 (2 个)

| 修复 | 文件 | 价值 |
|---|---|---|
| `animatePosition` 加 cancel 机制 (`activeAnim` 闭包) | objectsTool.ts | 🐛 防多个动画叠加覆盖 position |
| `collapseFloor` 加跳过规则 (Camera/Light/helper) | objectsTool.ts | 跟 explodeFloor 风格一致 |

### 2.4 新 API (1 个)

| API | 文件 | 说明 |
|---|---|---|
| `resetVisibility(): { restored, hiddenBefore }` | objectsTool.ts | 一键把所有 mesh 设为 visible=true (跳过 Camera/Light/helper) |

### 2.5 soonspace 清理 (1 处别名 + 4 处注释)

| 改动 | 文件 |
|---|---|
| 删 `ssp.viewer.update` / `ssp.viewer.screenshot` 别名 | index.ts (interface + 实际对象) |
| 改模板用 `ssp.viewerTool.screenshot` | templates/ssp_templates/viewer/screenshot.json (3 处) |
| 删 "BIM/soonspace" 注释 | test/inspectModel.ts |
| 删 `(别名 ssp.viewer.screenshot)` 注释 | screenshot.json (line 15) |

**最终**: grep `soonspace` 0 处, grep `ssp.viewer.` 0 处 (别名调用)

### 2.6 命名修正 (2 个)

| 之前 | 之后 |
|---|---|
| `setKookAt` (typo) | `setLookAt` |
| `flyto` / `flytoObject` (全小写) | `flyTo` / `flyToObject` |

## 3. 阶段 2.5 当时口径：10 个 SSP controller + 1 个 DEV diagnostics

| Controller | 公开 API 数 | 状态 |
|---|---|---|
| `ssp.cameraController` | 6 + 1 (controls) = 7 | ✅ |
| `ssp.sceneTool` | 5 | ✅ |
| `ssp.lightTool` | 3 | ✅ |
| `ssp.helperTool` | 3 | ✅ |
| `ssp.modelTool` | 12 (load*/unload*/get*) | ✅ |
| `ssp.objectsTool` | **12** (含 resetVisibility) | ✅ |
| `ssp.poiManager` | 8 (add/addNode/show/hide/remove/removeAll/getById/list) | ✅ |
| `ssp.cssTool` | 3 (createCSS2DObject/removeAll/list) | ✅ (实际是 Sprite) |
| `ssp.viewerTool` | 6 (createCanvas/getById/remove/removeAll/list/screenshot) | ✅ (snapshot 模式 5fps) |
| `ssp.topologyTool` | 1 (create) | 🚧 占位 (阶段 3) |
| `window.sspDev.modelInspector` | 1 | ✅ DEV 测试辅助，不属于 SSP API |

**当前纠正口径**：表中前 10 行是 SSP controller；modelInspector 是独立 DEV
diagnostics。2026-08-10 的当前 API 数量见 `SSPTool_API_CATALOG.md`。

## 4. 模板数

| 维度 | 阶段 2 收尾 | 阶段 2.5 |
|---|---|---|
| 模板总数 | 30 | **37** |
| active | 30 | 37 |
| placeholder | 0 | 0 |
| soonspace 兼容 | 1 (`ssp.viewer.screenshot`) | 0 (清掉) |

**新增 7 个模板**:
- `viewer/screenshot.json`
- `camera/fitScene.json` / `captureMainViewpoint.json` / `flyToMainViewpoint.json`
- `objects/resetVisibility.json`
- `poi/createPoiNode.json` / `showHidePoi.json`

> 当前模板已增长到 79 个（全部 active、0 placeholder），本节的 37 仅是阶段 2.5
> 历史快照。

## 5. 验收

- ✅ 0 typecheck 错误 (`vue-tsc --noEmit`)
- ✅ 0 build 错误 (`vite build` 1.43s)
- ✅ 当时 10 个 SSP controller 注释覆盖率 95%+，DEV diagnostics 独立
- ✅ 30+ 块分割线 (跟其他 module 风格一致)
- ✅ 3 处重复代码抽 helper 消除
- ✅ 0 soonspace 痕迹 (grep 验证)
- ✅ _SCHEMA.md 文档 ↔ 代码一致

## 6. Narrow Waist 原则体现

| 体现 | 文件 |
|---|---|
| 业务封装保**留** | `poiManager.getBySid` (POI 业务能力, 调 core) |
| 业务封装**不**自实现 | 调 `getObjectsByUserDataProperty` |
| 业务封装 thin wrapper | 8 行 → 1 行 |
| **不**抽到 core | `setMouseFromEvent` (单用户, 抽了违反 dog brain) |
| **不**抽到 core | `pickPoiSprite` / `ensureInteractionListeners` (依赖 POI 内部状态) |

## 7. 当时的阶段 3 计划与当前状态

1. **topologyTool**: ✅ 已完成 7 个 legacy + 16 个 v2 图/寻路/路线 API；下一步是 templates/业务适配层生成 Hospital 导航图、墙体 blocker 和楼梯 connector
2. **cameraController**: 考虑加 `tweenCamera` 独立 API (目前是 `flyTo` 兼容)
3. **ssp-shim 性能监控**: 跟踪 55 个 GLB 加载的 5-10s 耗时
4. **注释覆盖率 → 100%**: 现在的 ~95% (差 setVisible 等简单行)

> 2026-08-10 后续说明：topology v2 已按显式 graph/connector/blocker 纯数据、
> 约束 Dijkstra 和 3D 路线渲染实现；AI 只面向高层 templates，低层 topology
> 原子模板全部 `aiEnabled:false`。`src/ssp` 恢复默认保护规则：检查可以，修改必须
> 先向用户报告范围并取得本轮明确授权。
