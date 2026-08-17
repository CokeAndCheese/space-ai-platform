# 交接提示词 — Space AI Platform（2026-08-14）

> 将下文作为新对话的第一条消息，可直接开始接手。先核对仓库事实，再决定是否改动。

## 首读顺序

1. `README.md`：项目边界、命令和当前数量基线。
2. `PROJECT_SUMMARY.md`：分层、AI 边界、topology 边界与待办。
3. `docs/SSPTool_API_CATALOG.md`：10 个 controller 的完整 API。
4. `src/ssp/index.ts`、`src/ssp/core/context.ts`：顶层 namespace 和 4 个 context 函数。
5. `src/ssp/topology/types.ts`、`src/ssp/topology/topologyTool.ts`：v2 graph/route 契约。
6. `src/templates/_SCHEMA.md`、`src/templates/registry.ts`：模板字段、registry 和 AI opt-in 规则。

## 文档权威级别

| 文档 | 用途 |
|---|---|
| `README.md` / `PROJECT_SUMMARY.md` / 本文 | 2026-08-14 当前状态与交接入口 |
| `SSPTool_API_CATALOG.md` / `objectsTool_API.md` / `topologyTool_API.md` | 当前公开 API 与模块边界 |
| `src/templates/_SCHEMA.md` | 当前模板契约、数量和 AI opt-in 规则 |
| `GLB_METADATA_SPEC.md` / `MESH_METADATA_INJECTION_SPEC.md` / `BLENDER_METADATA_GUIDE.md` | 当前 metadata 规范与操作说明 |
| `AI_LAYER_VERIFICATION.md` | 下一轮手工验收清单；未勾选项不是失败结论 |
| `AI_LAYER_DESIGN.md` | 第 0-11 节是历史方案，顶部和第 12 节以后记录当前落地差异 |
| `STAGE2_SUMMARY.md` / `MODEL_METADATA_AUDIT_PROMPT.md` | 历史过程快照，不能替代当前 API/模板数量 |
| `SPACE_STRATEGY.md` | SPACE A/B 方案决策记录，需求触发后再重评 |

## 当前事实

- 10 个 controller，85 个 controller 方法；`cameraController.controls` 是实例属性。
- 顶层还有 4 个 context 函数：`setContext`、`getContext`、`hasContext`、`clearContext`；合计 89 个可调用函数。
- 模板：79 active、0 placeholder、4 combo、9 AI-enabled。实际目录只有 `camera`、`scene`、`light`、`helper`、`model`、`objects`、`poi`、`css`、`viewer`、`topology`。
- topology API 共 23 个：legacy 图 7、v2 graph 8、路线 8。
- AI 只面向模板。`src/ai` 不得直接导入 `src/ssp` 或调用 `window.ssp`；`templateRuntime` 是唯一执行入口，并默认 `aiOnly: true`。
- `src/ssp` 的检查默认只报告；任何 `src/ssp/**` 实现变更都要先报告范围并取得用户对本轮的明确授权。模板/应用层按用户任务单独处理。
- 通用 GLB metadata → world-space topology graph 适配层尚未实现。医院模型只是测试样例；生产能力必须适用于任何满足同一数据契约的 GLB。topology 核心只处理调用方显式提供的 graph、connector、blocker 和路线，不解析模型、不推断连接关系、不调用其他 controller。
- `objectsTool.query/describe` 与 `applyHighlight/releaseHighlight` 已获用户单独授权进入 SSP 实施；查询只接受编译期字段白名单和有界 `equals/in`，高亮采用不透明租约、后写优先、共享材质 clone-on-write 与 context/model 生命周期回收。

## 接手验证命令

```bash
cd "/Users/mac/Documents/Codex/space AI platform"
git status --short
npm run audit:templates
npm run audit:ai-boundary
npm run test:objects
npm run test:topology
npm run audit:topology-boundary
npm run typecheck
npm run build
```

模板审计应报告 `79 / active 79 / placeholder 0 / combo 4 / AI enabled 9 / 问题 0`。`npm run build` 的 prebuild 会运行 `list-models` 并可能更新 `src/model-manifest.json`；运行前后请检查 `git status`，不要覆盖并行改动。

## 已完成

- SSP 10 controller 单例、context 桥接和 `window.ssp` 门面。
- 79 个模板 registry/runtime；AI 参数校验与 AI/template boundary audit。
- topology legacy 兼容层、v2 graph/寻路/路线生命周期及回归脚本。
- objectsTool 有界查询/描述、高亮租约与独立回归脚本。
- Sandbox Templates、Models、ssp 三个 tab。

## 待办

1. 在应用/模板层实现通用 GLB metadata 到 world-space 显式 topology graph 的适配器；不得绑定医院、建筑名或单一业务模型。
2. 合入模板 Phase 0 迁移：`query-scene` 改走 `query/describe` 或受控动作，接入 execution-local highlight capability，并撤销 AI 对宿主紧急 `clearAllHighlights` 的直接调用。
3. 按需求评审新增 AI-enabled 模板，保持危险能力 opt-in。
4. 继续按实际数据补齐性能和 metadata 观测。

## SSP 保护规则

- 不擅自修改已经稳定的 `src/ssp/**`；先报告问题、说明影响，等待用户确认。
- 不恢复废弃别名，不新增不存在的占位模板目录，不把业务推断塞进 topology 核心。
- 保持 `ssp.xxxTool.xxx()` 窄腰调用方式；业务组合放模板/应用层。
- 不清理、重置、移动或提交并行任务的文件。仓库使用多个 worktree；提交前按精确路径核对 staged 文件。

## 快速定位

```text
src/ssp/index.ts                         顶层 namespace（10 controller + context）
src/ssp/<module>/*.ts                    controller 实现与 interface
src/ssp/topology/types.ts                graph/route 公开类型
src/templates/ssp_templates/**/*.json    79 个模板
src/templates/registry.ts                registry、AI opt-in、参数校验
src/ai/parser/prompts.ts                 模型只见模板目录
src/ai/executor/PlanExecutor.ts          只经 templateRuntime 执行
scripts/audit-template-schema.mjs        模板静态审计（只报告）
scripts/audit-ai-boundary.mjs            AI/template 边界审计（只报告）
scripts/test-objects.mjs                  objectsTool 查询与高亮租约回归
```

**TL;DR**：先按首读顺序和命令确认 79/0/4/9 基线；AI 只能走模板；topology 只处理显式通用图，通用 GLB world-space 适配器仍待实现；共享 worktree 不清理、不重置、不提交。
