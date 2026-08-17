# Space AI Platform — 项目总结

> 更新：2026-08-14。本文只记录当前仓库事实；具体签名以源码和 API catalog 为准。

## 规模与分层

- 10 个 SSP controller，85 个 controller 方法；`cameraController.controls` 为属性。
- `src/ssp/core/context.ts` 另外提供 4 个 context 函数，顶层共 89 个可调用函数。
- `src/templates/ssp_templates/` 有 79 个 active JSON、0 个 placeholder、4 个 combo、9 个 AI-enabled。
- AI 层只选择并执行模板；`src/ai` 不直接导入 SSP。模板 runtime 是 AI 触达 SSP 的唯一入口。

```
src/
├── ssp/                         ← 10 个 controller + core/context
├── templates/ssp_templates/     ← 79 个模板（10 个实际模块目录）
├── ai/                          ← 解析、规划、模板执行与审计
├── composables/                 ← Three.js 场景初始化
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

审计基线：79 active、0 placeholder、4 combo（`flash-alarm`、`floor`、`focus-on-object`、`highlight-objects`）、9 AI-enabled。AI-enabled 名单当前为 `captureMainViewpoint`、`fitScene`、`flyToMainViewpoint`、`clearAllHighlights`、`collapse-floor`、`explode-floor`、`query-scene`、`resetVisibility`、`help`。

## AI 边界

`src/ai/parser/prompts.ts` 给模型展示的是 registry 的模板目录；`PlanExecutor` 以 `aiOnly: true`、参数校验调用 `templateRuntime`。因此 AI 不能直接调用 `window.ssp` 或编写 SSP 方法。模板默认可在 Sandbox 执行，是否暴露给 AI 由每个 JSON 的 `aiEnabled` 显式控制。

## topologyTool 边界

topology v2 由纯数据 graph API、约束寻路和 Three.js 路线生命周期组成，legacy 静态图 API 继续兼容。核心只接受显式 nodes/edges、connector 和 blocker 数据；不解析 GLB metadata、不遍历示例模型推断连接关系、不调用其他 controller。跨层路径必须经过输入图显式 connector 边。通用 metadata → world-space graph 适配层尚未实现，应放在应用/模板层而不是 topology 核心。

## 已完成

- 10 个 controller 与 context 单例已接入 `src/ssp/index.ts`。
- 模板 registry、runtime、AI 参数校验和边界审计已落地。
- topology legacy + v2 graph/route API 及回归脚本已落地。
- objectsTool 有界查询/描述、高亮租约、context/model 回收及回归脚本已落地。
- Sandbox 支持 Templates、Models、ssp 三个 tab。

## 待办（需用户确认后再改）

- 实现通用 GLB metadata 到 world-space 显式 topology graph 的适配层；不得绑定某个行业或示例模型。
- 按产品需求扩充并审核 AI-enabled 模板；默认保持 opt-in。
- 继续完善性能观测、模型 metadata 与应用层业务组合。

## 工作区注意事项

仓库使用多个 worktree 并行开发。不要执行清理、重置、移动 worktree 或无关提交；提交前按精确路径核对 staged 文件。审计命令默认只报告问题。
