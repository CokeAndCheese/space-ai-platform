# Space AI Platform

> AI 友好的 Three.js 能力平台：把 Three.js 能力封装成 ssp-shim controller，再通过结构化 JSON 模板提供给 LLM 和业务代码。

Space Model Studio 是独立的标准模型生产方，本项目是上层应用消费方；目标上两者只通过版本化共享数据契约连接，不共享内部实现。当前 Studio 与 Platform 契约尚未对齐，不得宣称直接兼容；差异、冻结规则和变更门禁见 [docs/CROSS_PROJECT_DATA_CONTRACT.md](./docs/CROSS_PROJECT_DATA_CONTRACT.md)。

## 当前状态（2026-08-22）

- SSP 暴露 10 个 controller，共 85 个 controller 方法；`cameraController.controls` 是一个底层实例属性，不计入方法数。
- 顶层 context 工具 4 个（`setContext` / `getContext` / `hasContext` / `clearContext`），合计 89 个可调用函数。
- v2 兼容目录 `src/templates/ssp_templates/` 有 79 个 active、0 个 placeholder、4 个组合模板、8 个 `aiEnabled` 模板；`clearAllHighlights` 已改为 host-only。
- v3 已落地 4 个 Manifest 约束的一一映射原子模板；独立 machine contract 同时锁定模板 allow-list、参数 schema 和返回 schema，其中 `resetVisibility` 面向 AI；同 ID 由 v3 优先遮蔽 v2。
- AI 的模型面能力仅来自统一模板目录；纯目录构建不导入 SSP，执行时由应用层注入 SSP。
- `topologyTool` 提供 23 个 API（legacy 图、v2 图与路线）；R1 已落地版本化 topology sidecar v1 到 world-space graph 的通用适配、可信资产证明、场景生命周期和受控 Quick Action 链路。

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
| `npm run dev` | 启动开发服务；不会自动刷新模型清单 |
| `npm run typecheck` | `vue-tsc --noEmit` |
| `npm run build` | 类型检查并执行生产构建；不会自动刷新模型清单 |
| `npm run verify:r1` | 按固定顺序运行 R1 回归、边界审计、类型检查和生产构建，并核对 manifest 与 Git porcelain 前后完全一致 |
| `npm run test:r1-local-gate` | 在临时 Git fixture 中回归 R1 本地门禁自身的成功、失败和污染检测语义 |
| `npm run list-models` | **有意写回命令**：扫描 `public/models/` 并覆盖生成 `src/model-manifest.json` |
| `npm run audit:templates` | 只报告模板 schema、数量和引用问题，不修改文件 |
| `npm run phase0:generate` | 从当前 SSP 与模板事实重新生成 Capability Manifest 和 Phase 0 文档 |
| `npm run audit:phase0` | 校验生成清单没有漂移且 SSP 方法全部完成策略分类 |
| `npm run audit:v3` | 校验 v3 schema、Manifest 映射、策略与封闭调用语法 |
| `npm run audit:ai-boundary` | 只报告 AI → 模板边界违规，不修改文件 |
| `npm run test:templates-v3` | 运行 v3 原子 Runtime、ObjectRef、结果投影与宿主边界契约测试 |
| `npm run test:objects` | objectsTool 有界查询、租约重叠与资源回收回归 |
| `npm run test:topology` | topology 纯图、寻路和路线生命周期回归 |
| `npm run audit:topology-boundary` | 检查 topology 依赖边界 |
| `npm run compress` | 压缩 GLB |
| `npm run validate-metadata` | 验证 GLB metadata |

> **写回警告：**`npm run list-models` 会有意重建并写回 `src/model-manifest.json`。只有在用户明确要求刷新清单，且已经备份现有文件并确认预期差异后才能运行。常规 `dev`、`build` 和 `verify:r1` 都不会调用它。

## 模板

v2 兼容模板目录名与 controller 模块对应，当前只使用以下 10 个目录：

```
src/templates/ssp_templates/
├── camera/ scene/ light/ helper/ model/
├── objects/ poi/ css/ viewer/ topology/
```

所有 79 个 v2 JSON 均为 active；4 个组合模板是 `flash-alarm`、`floor`、`focus-on-object`、`highlight-objects`；8 个 AI 模板由 registry 显式许可。v3 原子模板位于 `src/templates/v3/atomic/`，当前迁移 `getViewpoint`、`setBackgroundColor`、`setFog`、`resetVisibility`。统一 Registry 采用 v3-first，同 ID 的隐藏 v3 不回退 v2。模板 schema 见 [src/templates/_SCHEMA.md](./src/templates/_SCHEMA.md)。

## 模型与拓扑边界

`public/models/<scene>/` 下的每个子目录是一个独立场景；运行时从 `src/model-manifest.json` 读取模型入口，路径不写死。该清单只通过显式 `npm run list-models` 刷新，不再由 `dev` 或 `build` 隐式改写。GLB 的 `scene.extras` 保存楼层 metadata，mesh 的 `userData.renderType` 保存构件类型。

GLB Metadata v3.1 和外置 topology sidecar v1 是本项目当前消费基线；Studio 当前使用不同的 `3.3-semantic` 与 GLB 内嵌 topology v1。不得为了单个应用需求就地改变任一已发布版本的字段、枚举、ID、单位、坐标、发现或资产绑定语义；收敛必须采用明确版本并完成双端兼容评审与共同 fixture 验证。

`topologyTool` 是窄腰：只接收调用方显式提供的 graph、connector、blocker 数据，负责通用寻路和 Three.js 路线渲染；不解析 GLB metadata、不从示例模型推断连接关系、不调用其他 SSP controller。跨层连接必须由输入图显式提供；通用 metadata → world-space graph 适配器留在应用/模板层。

## 开发约束

1. SSP 统一以 `ssp.xxxTool.xxx()` 调用；AI 只能选择统一 Registry 中显式开放的模板。
2. 新增模板必须使用 v3 声明式 schema 和 Manifest 静态映射；v2 `code` 编译器只保留为未迁移模板的隔离兼容路径。
3. `cameraController` 使用 `useThreeScene` 注入的同一个 CameraControls 实例。
4. 审计命令只报告；`src/ssp/**` 检查默认不修改，需要变更时必须先报告范围并取得用户对本轮的明确确认。
5. 所有研发写入使用保存的单一项目目录，由产品经理维护单一任务分支和写入队列；不要清理、重置、移动或提交不属于当前任务的改动，提交前按精确路径核对 staged 文件。
6. `clearAllHighlights` 只允许宿主紧急恢复，AI、组合模板和补偿流程均不得调用。

## 技术栈与许可

Vite 5、Vue 3、TypeScript、Three.js r165+、camera-controls（本地化）、vue-router 4。项目代码 MIT；模型资产按其所有权使用。
