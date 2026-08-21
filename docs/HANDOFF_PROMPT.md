# 历史交接提示词 — Space AI Platform（已归档）

> 本文已于 2026-08-22 归档，不再作为新任务入口。当前接手必须先读根目录 `AGENTS.md`、`docs/PRODUCT_MANAGER_CHARTER.md`、`docs/PRODUCT_CONTEXT.md`、`docs/ORG_CHART.md`、`docs/DECISION_LOG.md` 与 `docs/DEVELOPMENT_WORKFLOW.md`；下文仅保留历史定位线索。

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
| `AGENTS.md` / `PRODUCT_CONTEXT.md` / `DEVELOPMENT_WORKFLOW.md` | 当前状态、治理与交接入口 |
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
- 模板：79 active、0 placeholder、4 combo、8 AI-enabled。实际目录只有 `camera`、`scene`、`light`、`helper`、`model`、`objects`、`poi`、`css`、`viewer`、`topology`。
- topology API 共 23 个：legacy 图 7、v2 graph 8、路线 8。
- AI 只面向模板。`src/ai` 不得直接导入 `src/ssp` 或调用 `window.ssp`；`templateRuntime` 是唯一执行入口，并默认 `aiOnly: true`。
- `src/ssp` 的检查默认只报告；任何 `src/ssp/**` 实现变更都要先报告范围并取得用户对本轮的明确授权。模板/应用层按用户任务单独处理。
- R1 已实现版本化外置 topology sidecar v1 → world-space graph 适配、可信场景生命周期和受控 Quick Action。医院模型仍只是测试样例；topology 核心只处理调用方显式提供的 graph、connector、blocker 和路线，不解析模型、不推断连接关系、不调用其他 controller。
- `objectsTool.query/describe` 与 `applyHighlight/releaseHighlight` 已获用户单独授权进入 SSP 实施；查询只接受编译期字段白名单和有界 `equals/in`，高亮采用不透明租约、后写优先、共享材质 clone-on-write 与 context/model 生命周期回收。

## 接手验证命令

```bash
cd "/Users/mac/Documents/Codex/space AI platform"
git status --short
npm run verify:r1
```

模板审计应报告 `79 / active 79 / placeholder 0 / combo 4 / AI enabled 8 / 问题 0`。`dev`、`build` 与 `verify:r1` 不会运行 `list-models`；只有用户明确要求、已备份并确认差异后，才可执行会写回 `src/model-manifest.json` 的 `npm run list-models`。

## 已完成

- SSP 10 controller 单例、context 桥接和 `window.ssp` 门面。
- 79 个模板 registry/runtime；AI 参数校验与 AI/template boundary audit。
- topology legacy 兼容层、v2 graph/寻路/路线生命周期及回归脚本。
- objectsTool 有界查询/描述、高亮租约与独立回归脚本。
- Sandbox Templates、Models、ssp 三个 tab。
- R1 sidecar 适配、可信场景生命周期、受控 Quick Action 与非污染本地 gate。

## 待办

1. R1 已完成浏览器 P0、独立 QA、架构与产品验收；等待用户批准关闭、本地里程碑记录和外部手动备份。
2. 推进 Template Phase 2：迁移组合/query 模板、execution-local capability、取消/超时与 finally 释放。
3. 按需求评审新增 AI-enabled 模板，保持危险能力 opt-in。
4. 继续按实际数据补齐性能和 metadata 观测。

## SSP 保护规则

- 不擅自修改已经稳定的 `src/ssp/**`；先报告问题、说明影响，等待用户确认。
- 不恢复废弃别名，不新增不存在的占位模板目录，不把业务推断塞进 topology 核心。
- 保持 `ssp.xxxTool.xxx()` 窄腰调用方式；业务组合放模板/应用层。
- 不清理、重置、移动或提交其他任务的文件。项目使用单一保存工作区、单一任务分支和写入队列；提交前按精确路径核对 staged 文件。

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

**TL;DR**：本文已归档；以当前治理文档为准。当前基线为 79/0/4/8，AI 只能走模板，topology 只处理显式通用图；R1 内部验收已 PASS，待用户批准关闭和手动备份。
