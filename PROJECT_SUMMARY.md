# Space AI Platform — 项目总结

> 更新：2026-08-22。本文只记录当前仓库事实；产品范围、组织与研发流程以 `docs/PRODUCT_CONTEXT.md`、`docs/ORG_CHART.md` 和 `docs/DEVELOPMENT_WORKFLOW.md` 为准，具体签名以源码和 API catalog 为准。

Space Model Studio 是独立的标准模型生产方，Space AI Platform 是上层应用消费方；目标上两者只通过版本化共享数据契约连接。当前 Studio `3.3-semantic + embedded topology v1` 与 Platform `v3.1 + external sidecar v1` 尚未对齐，不得宣称直接兼容；差异和变更门禁见 [docs/CROSS_PROJECT_DATA_CONTRACT.md](./docs/CROSS_PROJECT_DATA_CONTRACT.md)。

## 规模与分层

- 10 个 SSP controller，85 个 controller 方法；`cameraController.controls` 为属性。
- `src/ssp/core/context.ts` 另外提供 4 个 context 函数，顶层共 89 个可调用函数。
- v2 兼容目录有 79 个 active JSON、0 个 placeholder、4 个 combo、8 个 AI-enabled；v3 有 4 个 Manifest 约束的 atomic 模板，其中 1 个向 AI 开放。
- AI 层只选择并执行统一模板目录；纯 Registry 不导入 SSP，应用 Runtime 是 AI 触达 SSP 的唯一入口。

```
src/
├── ssp/                         ← 10 个 controller + core/context
├── templates/ssp_templates/     ← 79 个 v2 兼容模板（10 个实际模块目录）
├── templates/v3/atomic/         ← 4 个 v3 一一映射原子模板
├── ai/                          ← 解析、规划、模板执行与审计
├── adapters/topology/           ← topology sidecar v1 到 world-space graph 适配
├── composables/                 ← Three.js 场景初始化、可信 topology 生命周期与 Quick Action
└── test/                        ← 沙盒和回归脚本
```

## Controller API

| Controller | 方法数 | 说明 |
|---|---:|---|
| cameraController | 6 | 飞行、视角、环绕、fit；另有 `controls` 属性 |
| sceneTool | 5 | 背景、雾、清理、释放、更新 |
| lightTool | 3 | 环境光、平行光、灯光移除 |
| helperTool | 3 | 坐标轴、网格、清理 |
| modelTool | 12 | 楼层/子类别加载、卸载、查询 |
| objectsTool | 16 | 有界场景查询/描述、高亮租约、legacy 高亮、显隐、楼层炸开/合拢 |
| poiManager | 8 | POI 创建、显示、隐藏、移除、查询 |
| cssTool | 3 | Sprite 标签创建、清理、列表 |
| viewerTool | 6 | 子画布生命周期和截图 |
| topologyTool | 23 | legacy 静态图 7；v2 graph 8；路线 8 |

context 函数为 `setContext`、`getContext`、`hasContext`、`clearContext`。完整 API 列表见 [docs/SSPTool_API_CATALOG.md](./docs/SSPTool_API_CATALOG.md)。

## 模板清单

实际目录只有：

```
camera/ scene/ light/ helper/ model/
objects/ poi/ css/ viewer/ topology/
```

v2 审计基线：79 active、0 placeholder、4 combo（`flash-alarm`、`floor`、`focus-on-object`、`highlight-objects`）、8 AI-enabled。统一 AI 目录当前为 `captureMainViewpoint`、`fitScene`、`flyToMainViewpoint`、`collapse-floor`、`explode-floor`、`query-scene`、`resetVisibility`、`help`；其中 `resetVisibility` 走同 ID v3 路径。`clearAllHighlights` 仅保留为宿主紧急恢复动作。

## AI 边界

`src/ai/parser/prompts.ts` 给模型展示的是 v3-first 统一目录；`PlanExecutor` 以 `aiOnly: true` 和参数校验调用模板 Runtime。v3 原子调用由 Manifest 静态绑定，未迁移 ID 才进入隔离的 v2 兼容编译器，因此 AI 不能直接调用 `window.ssp` 或编写 SSP 方法。`clearAllHighlights` 通过显式宿主适配器执行，不进入 Intent 或 AI fallback。

## topologyTool 边界

topology v2 由纯数据 graph API、约束寻路和 Three.js 路线生命周期组成，legacy 静态图 API 继续兼容。核心只接受显式 nodes/edges、connector 和 blocker 数据；不解析 GLB metadata、不遍历示例模型推断连接关系、不调用其他 controller。跨层路径必须经过输入图显式 connector 边。R1 已在 SSP 外实现版本化 topology sidecar v1 → world-space graph 适配、AssetProof 和场景生命周期，保持核心窄腰不变。

## 已完成

- 10 个 controller 与 context 单例已接入 `src/ssp/index.ts`。
- 模板 registry、runtime、AI 参数校验和边界审计已落地。
- topology legacy + v2 graph/route API 及回归脚本已落地。
- objectsTool 有界查询/描述、高亮租约、context/model 回收及回归脚本已落地。
- Phase 0 Capability Manifest 与 v2 冻结审计已落地。
- Phase 1 v3 原子 Runtime、4 个首批迁移、独立参数/返回 machine contract、ObjectRef 与有界公共结果投影已落地。
- Sandbox 支持 Templates、Models、ssp 三个 tab。
- R1 已完成 topology sidecar v1 适配、正式可达/无路 fixture、可信多资产场景生命周期和受控 Quick Action 模板闭环。
- `npm run verify:r1` 已提供 dirty 基线可用的非污染本地 gate；`dev` / `build` 不再隐式写回模型清单。
- R1 真实浏览器 P0、独立 QA、架构和产品范围验收均已 PASS；当前状态为研发完成、待用户批准关闭。

## 后续阶段

- 用户批准关闭 R1 后完成本地里程碑记录与外部手动备份；随后扩展更多非医院模型 fixture。
- Phase 2 实现封闭组合 Runtime，迁移 4 个 v2 combo 与 `query-scene`，并接入 execution-local HighlightLease capability table、取消/超时/finally 释放。
- 继续将 v2 一一映射迁移到 v3；AI 暴露默认保持 opt-in。
- 继续完善性能观测、模型 metadata 与应用层业务组合。

## 工作区注意事项

项目使用单一保存工作区、轻量本地 Git 和单一任务分支写入队列，不连接 GitHub。不要执行清理、重置或无关提交；`src/model-manifest.json` 的用户修改必须始终排除，提交前按精确路径核对 staged 文件。审计命令默认只报告问题。
