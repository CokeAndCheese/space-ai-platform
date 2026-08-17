# Space AI Platform

> AI 友好的 Three.js 能力平台：把 Three.js 能力封装成 ssp-shim controller，再通过结构化 JSON 模板提供给 LLM 和业务代码。

## 当前状态（2026-08-14）

- SSP 暴露 10 个 controller，共 85 个 controller 方法；`cameraController.controls` 是一个底层实例属性，不计入方法数。
- 顶层 context 工具 4 个（`setContext` / `getContext` / `hasContext` / `clearContext`），合计 89 个可调用函数。
- 模板位于 `src/templates/ssp_templates/`：79 个 active、0 个 placeholder、4 个组合模板、9 个 `aiEnabled` 模板。
- AI 的模型面能力仅是模板目录；AI 运行时不会直接导入或调用 `src/ssp`。
- `topologyTool` 提供 23 个 API（legacy 图、v2 图与路线）；通用 GLB metadata 到 world-space topology graph 的适配层尚未实现，现有医院模型仅作测试 fixture。

## SSP API

| Controller | 方法数 | 公开方法/属性 |
|---|---:|---|
| `ssp.cameraController` | 6 + `controls` | `flyTo`、`flyToObject`、`setViewpoint`、`getViewpoint`、`surroundOnTarget`、`fitScene` |
| `ssp.sceneTool` | 5 | `setBackgroundColor`、`setFog`、`clear`、`dispose`、`update` |
| `ssp.lightTool` | 3 | `createAmbientLight`、`createDirectionalLight`、`removeLight` |
| `ssp.helperTool` | 3 | `addAxes`、`addGrid`、`removeAll` |
| `ssp.modelTool` | 12 | `loadFloor`、`loadSubcategory`、`loadAll`、`unloadFloor`、`unloadSubcategory`、`unloadAll`、`getLoadedFloors`、`getLoadedSubcategories`、`getFloorInfo`、`getFloorNamesByBuilding`、`getFloorNameByLevel`、`getSubcategories` |
| `ssp.objectsTool` | 16 | 有界查询/描述、高亮租约、legacy 高亮、可见性、楼层炸开/合拢及状态查询 |
| `ssp.poiManager` | 8 | `add`、`addNode`、`show`、`hide`、`remove`、`removeAll`、`getById`、`list` |
| `ssp.cssTool` | 3 | `createCSS2DObject`、`removeAll`、`list`（实现为 Sprite） |
| `ssp.viewerTool` | 6 | `createCanvas`、`getById`、`remove`、`removeAll`、`list`、`screenshot` |
| `ssp.topologyTool` | 23 | legacy 图 7 个；v2 图 8 个；路线 8 个 |

完整签名以 [docs/SSPTool_API_CATALOG.md](./docs/SSPTool_API_CATALOG.md) 和各 `src/ssp/**` interface 为准。

## 快速开始

```bash
npm install
npm run dev            # http://localhost:5173/
```

`/` 打开 3D 场景；`/#/sandbox` 打开模板测试沙盒。Sandbox 的 Templates、Models、ssp 三个 tab 分别用于模板执行、模型构件树和 controller 源码浏览。

## 命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 启动开发服务 |
| `npm run typecheck` | `vue-tsc --noEmit` |
| `npm run build` | 类型检查并执行生产构建（会先运行 `list-models`） |
| `npm run list-models` | 扫描 `public/models/`，生成 `src/model-manifest.json` |
| `npm run audit:templates` | 只报告模板 schema、数量和引用问题，不修改文件 |
| `npm run audit:ai-boundary` | 只报告 AI → 模板边界违规，不修改文件 |
| `npm run test:objects` | objectsTool 有界查询、租约重叠与资源回收回归 |
| `npm run test:topology` | topology 纯图、寻路和路线生命周期回归 |
| `npm run audit:topology-boundary` | 检查 topology 依赖边界 |
| `npm run compress` | 压缩 GLB |
| `npm run validate-metadata` | 验证 GLB metadata |

## 模板

模板目录名与 controller 模块对应，当前只使用以下 10 个目录：

```
src/templates/ssp_templates/
├── camera/ scene/ light/ helper/ model/
├── objects/ poi/ css/ viewer/ topology/
```

所有 79 个 JSON 均为 active；4 个组合模板是 `flash-alarm`、`floor`、`focus-on-object`、`highlight-objects`；9 个 AI 模板由 registry 显式许可。模板 schema 见 [src/templates/_SCHEMA.md](./src/templates/_SCHEMA.md)。

## 模型与拓扑边界

`public/models/<scene>/` 下的每个子目录是一个独立场景，模型通过 `src/model-manifest.json` 自动发现，路径不写死。GLB 的 `scene.extras` 保存楼层 metadata，mesh 的 `userData.renderType` 保存构件类型。

`topologyTool` 是窄腰：只接收调用方显式提供的 graph、connector、blocker 数据，负责通用寻路和 Three.js 路线渲染；不解析 GLB metadata、不从示例模型推断连接关系、不调用其他 SSP controller。跨层连接必须由输入图显式提供；通用 metadata → world-space graph 适配器留在应用/模板层。

## 开发约束

1. SSP 统一以 `ssp.xxxTool.xxx()` 调用；AI 只能选择 AI-enabled 模板。
2. 模板代码在受控 runtime 中执行，模板之间相互隔离。
3. `cameraController` 使用 `useThreeScene` 注入的同一个 CameraControls 实例。
4. 审计命令只报告；`src/ssp/**` 检查默认不修改，需要变更时必须先报告范围并取得用户对本轮的明确确认。
5. 仓库通过多个 worktree 并行开发。不要清理、重置、移动或提交不属于当前任务的改动；提交前按精确路径核对 staged 文件。

## 技术栈与许可

Vite 5、Vue 3、TypeScript、Three.js r165+、camera-controls（本地化）、vue-router 4。项目代码 MIT；模型资产按其所有权使用。
