# 模板 Schema（v3 current / v2 legacy）

## v3 当前规范

新模板只能写入 `src/templates/v3/atomic/<namespace>/<id>.json`，机器规范为
`src/templates/v3/schema/template-v3.schema.json`。Phase 1 仅开放 `kind: "atomic"`：

- 一个 atomic 模板恰好绑定一个 Manifest 允许的公开 SSP 方法；
- `src/templates/manifest/v3-capability-contracts.json` 独立审批模板 id、每个参数 schema 与返回形态；缺失/空映射或 schema 不一致均硬失败；
- `call.method` 是静态 `namespace.method`，`call.args` 只能使用 `$input` 或 `$literal`；
- 不允许 `code`、`steps`、`flow`、`window`、`THREE`、Store 或动态方法名；
- `input` / `output` 使用封闭 JSON Schema，object 必须声明 `additionalProperties:false`；
- 同 ID 时 v3 始终遮蔽 v2，隐藏 v3 不会回退到 legacy；
- `clearAllHighlights` 是宿主紧急恢复能力，Manifest policy 禁止建立 v3 模板。
- 通用 `executeTemplate` 即使传 `aiOnly:false` 也拒绝 host-only；只有显式宿主动作适配器可执行紧急全局恢复。
- `timeoutMs` 仅允许异步只读原子调用，语义是等待返回超时，不会取消底层 Promise；有副作用取消留到 Phase 2。

当前首批迁移：`getViewpoint`、`setBackgroundColor`、`setFog`、`resetVisibility`。

```bash
npm run audit:v3
npm run test:templates-v3
npm run typecheck
```

下面的 v2 文档只用于维护尚未迁移的兼容模板；Phase 0 基线禁止新增或重命名含
`code` 的 v2 文件。

## v2 legacy 规范

## 文件命名 — 目录式

```
ssp_templates/<category>/<id>.json
```

- `category` — 一级分类: `camera` / `css` / `helper` / `light` / `model` / `objects` / `poi` / `scene` / `topology` / `viewer`
- `subcategory` — JSON 内的展示分组字段，不增加目录层级。
- `id` — 文件名, 格式 `kebab-case` 或 `camelCase`, 文件名去掉 `.json` 后就是模板 `id`

例:
- `ssp_templates/camera/flyTo.json` → id = `flyTo`
- `ssp_templates/scene/setBackgroundColor.json` → id = `setBackgroundColor`
- `ssp_templates/objects/query-scene.json` → id = `query-scene`

> `id` 必须全局唯一，且必须与文件名一致；Registry 遇到重复 id 会直接报错。

## 字段

### 必填

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 唯一 id |
| `category` | string | 一级分类 |
| `subcategory` | string | 二级分类 |
| `code` | string | 受信任的本地可执行代码，由共享 TemplateRuntime 注入 `ssp` / `THREE` / `params` 后执行 |

### 强推荐（模板检索与维护质量）

| 字段 | 类型 | 说明 |
|---|---|---|
| `intent` | string[] | 多角度自然语言, AI 用它做语义检索 |
| `method` | string | 调用的方法名, e.g. `ssp.cameraController.flyTo` |
| `signature` | string | 方法签名, e.g. `flyTo(position: Vec3Like, options?: FlyToOptions)` |
| `params` | array | 参数表 |

### 可选

| 字段 | 类型 | 说明 |
|---|---|---|
| `sdk` | string | 所属 SDK, 默认 `ssp-shim` |
| `returns` | string | 返回值说明 |
| `example` | string | 更复杂的调用示例 |
| `guard` | string[] | 错误条件 / 注意事项 |
| `seeAlso` | string[] | 关联模板 id |
| `tags` | string[] | 自定义标签, 沙盒可按 tag 过滤 |
| `aiEnabled` | boolean | 是否允许 AI 选择；缺省为 `false`。危险模板及 topology 原子模板必须保持 `false` |
| `testParams` | object | Sandbox 冒烟测试参数；仅用于需要必填参数的模板 |

## 字段示例

`intent` 必须**多角度**:

```json
"intent": ["fly to", "navigate", "聚焦", "飞向POI", "go to POI"]
```

`code` 必须是**完整可执行** 的受信任本地代码。AI 看不到也不能复制 `code`，只能选择 Registry 公布的模板 id 并提供参数:

```json
"code": "await ssp.cameraController.flyTo(params.position); return { message: 'done' };"
```

`params` 字段:

```json
"params": [
  {
    "name": "position",
    "type": "{ x: number, y: number, z: number }",
    "required": true,
    "desc": "目标相机位置"
  },
  {
    "name": "options",
    "type": "{ enableTransition?: boolean }",
    "required": false,
    "desc": "可选配置",
    "default": "{ enableTransition: true }"
  }
]
```

## 验证方式

沙盒页面 `/sandbox` 选中模板 → 点 ▶ 执行 → 看 console 区:
- 红色 = 报错 (模板 code 错 或 ssp-shim 缺 API)
- 白色 = 成功

## v2 兼容模板维护

1. 不得新增或重命名含 `code` 的 v2 模板；新能力按上面的 v3 规范实现。
2. 修复既有 v2 时保持 id/path 不变，并运行 `npm run audit:phase0`。
3. `/sandbox` 仍可用于未迁移 v2 的兼容验收。

---

## v2 重要约束 (2026-08-10 封版)

### `code` 字段必须是可执行的语句块 (不是单个 expression)

**v1 写法** (错, 会在沙盒里 SyntaxError):
```js
"code": "const obj = ssp.objectsTool.getById('xxx'); if (obj) console.log(obj.name);"
```

`new Function('ssp', 'THREE', \`return (async () => (${code}))();\`)` 包装时,
`const` 声明是 statement, 不是 expression, 会 throw。

**v2 修法** (runner 已改, 用 block body):
```js
"code": "const obj = ssp.objectsTool.getById('xxx'); if (obj) console.log(obj.name);"
```

现在 v2 兼容编译器 `legacyRuntime.ts` 内部：
```js
new Function('ssp', 'THREE', 'params', `return (async () => { ${code} })();`)
```

`{ }` 是 block body, 接受 statement (const / if-else / throw 等)。AI 参数通过 `params` 对象传入，禁止字符串拼接进代码。✅

当前数量和语法结果统一以 `npm run audit:templates` 为准。

### 封版目录与 AI 边界

当前 `src/templates/ssp_templates` 按实际一级目录统计如下：

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

审计封版结果为 active `79`、placeholder `0`、组合模板 `4`、`aiEnabled:true`
`8`。Topology 的 23 个模板对应 7 个 legacy + 16 个 v2 callable 原子方法，全部
显式 `aiEnabled:false`；AI 若需完成消防路线等任务，应调用经过参数校验的高层
组合模板，不应直接选择 topology 原子模板。

建议在改动模板后依次运行：

```bash
npm run audit:templates       # schema、数量、组合引用与 aiEnabled 基础检查
npm run audit:ai-boundary     # AI 可选模板与危险/原子能力边界
npm run audit:topology-boundary
```

三项均应通过；`audit:templates` 应保持 `问题总数: 0`。需要验证 topology 运行
时再运行 `npm run test:topology`。

### `code` 的返回值与日志

Sandbox 会自动把模板返回值打印为 `[template result]`；`console.log` 只用于模板自己的过程日志:
```js
// ✅ 返回值会自动显示
"code": "return ssp.objectsTool.getById('CEILING_A_6F_1');"

// ✅ 需要过程信息时再显式记录
"code": "const obj = ssp.objectsTool.getById('CEILING_A_6F_1'); console.log('found', Boolean(obj)); return obj;"
```

### 字段约束 (基于 GLB v2 metadata 规范)

`code` 中引用的字段必须真实存在 GLB metadata:

| ❌ 错 (数据中不存在) | ✅ 对 (v2 规范字段) |
|---|---|
| `getByUserDataProperty('sid', 'CRVDGXY9OB0K')` | `getById('DOOR_A_6F_1')` 走 sid 优先 |
| `getByUserDataProperty('renderType', 'ROOM')` | `getByUserDataProperty('renderType', 'WINDOW')` (v3.1: 8 种之一) |
| `getByUserDataProperty('twinsIdentifier', ...)` | `getByUserDataProperty('renderType', ...)` 或 `spaceType` |
| `getByUserDataProperty('name', 'Door_001')` (BIM 内部名, 不可靠) | `getById('DOOR_A_6F_1')` (sid) |
| `ssp.setObjectColor(obj, '#ff0000')` (API 不存在) | `ssp.objectsTool.setHighlight(obj, '#ff0000')` |
| `ssp.flashObject(list, ...)` (API 不存在) | `ssp.objectsTool.setHighlight(obj, color, true)` (pulse) |
| `ssp.flyToObj(obj, ...)` (老 API) | `ssp.cameraController.flyToObject(obj)` |

**详细 GLB 规范**: [../../docs/GLB_METADATA_SPEC.md](../../docs/GLB_METADATA_SPEC.md)
**objectsTool 完整 API**: [../../docs/objectsTool_API.md](../../docs/objectsTool_API.md)
**本阶段总结**: [../../docs/STAGE2_SUMMARY.md](../../docs/STAGE2_SUMMARY.md)

## ssp-shim 当前已实现的 controller (2026-08-14)

| Controller | 实现状态 |
|---|---|
| `ssp.cameraController` | ✅ flyTo / flyToObject / setViewpoint (含 rotation) / getViewpoint / surroundOnTarget / fitScene / controls |
| `ssp.sceneTool` | ✅ setBackgroundColor / setFog / clear / dispose / update |
| `ssp.lightTool` | ✅ createAmbientLight / createDirectionalLight (含 castShadow) / removeLight |
| `ssp.helperTool` | ✅ addAxes / addGrid / removeAll |
| `ssp.modelTool` | ✅ loadFloor / loadSubcategory (并发 8) / loadAll / unload* / get* |
| `ssp.objectsTool` | ✅ getByName/getById/getByUserDataProperty / query/describe（受控 Runtime） / setHighlight(unHighlight/clearAll) / applyHighlight/releaseHighlight（不透明 capability） / setVisible(setVisibleByFloor/resetVisibility) / explodeFloor/collapseFloor/isExploded |
| `ssp.poiManager` | ✅ add / addNode (含 onClick/onHover/hoverColor) / show/hide/remove/removeAll/getById/list |
| `ssp.cssTool` | ✅ createCSS2DObject / removeAll / list (实际是 Sprite,不是真 CSS2D) |
| `ssp.viewerTool` | ✅ createCanvas / getById / remove / removeAll / list (snapshot 模式 5fps) / screenshot |
| `ssp.topologyTool` | ✅ 7 个 legacy 静态图 API + 16 个 v2 路网/寻路/路线 API（共 23；原子模板全部 aiEnabled=false） |

完整 API + 状态: [docs/SSPTool_API_CATALOG.md](../../docs/SSPTool_API_CATALOG.md)
模板审计：`npm run audit:templates`（数量以审计输出为准）

只写**已实现**的 controller 模板。Topology 的低层原子 API 模板默认
`aiEnabled:false`，用于 Sandbox 验收，不直接暴露给 AI；消防路线等高层业务应另建
组合模板，再按需设置 `aiEnabled:true` 和严格参数校验。
