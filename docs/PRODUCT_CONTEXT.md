# Space AI Platform — 产品与团队上下文

> 产品经理基线：2026-08-21。本文整合当前代码、权威项目文档及历史项目任务中的有效结论，作为后续各角色任务的共同产品上下文。代码契约仍以源码和 API catalog 为准。

治理入口：产品经理的长期角色、权限和汇报机制见 [`PRODUCT_MANAGER_CHARTER.md`](./PRODUCT_MANAGER_CHARTER.md)；最新组织架构见 [`ORG_CHART.md`](./ORG_CHART.md)；研发与备份流程见 [`DEVELOPMENT_WORKFLOW.md`](./DEVELOPMENT_WORKFLOW.md)；用户批准的长期决策见 [`DECISION_LOG.md`](./DECISION_LOG.md)。仓库任务的强制入口规则见根目录 [`AGENTS.md`](../AGENTS.md)。

## 1. 产品定位

Space AI Platform 是一个 AI 友好的 Three.js 空间能力平台：浏览器加载 GLB/BIM 场景，SSP 将场景能力封装成稳定的 controller，Template Registry 再把受控能力提供给 AI 和业务代码。

当前目标用户首先是空间应用开发者和方案实施人员，而不是已经具备账户、权限、项目管理和多人协作的终端 SaaS 用户。

## 2. 核心用户链路

```text
选择场景/楼层 GLB
→ Three.js 加载并建立 SSP context
→ 用户输入自然语言或 Quick Action
→ 确定性规则 / Intent 缓存 / 同源 LLM 代理
→ Zod Intent 校验与 Planner
→ 统一 Template Runtime
→ SSP controller
→ 场景动作、查询结果与本地审计记录
```

应用目前提供两个主要界面：3D 场景主页和 Template/Models/SSP Sandbox。模型选择、Intent 审计和 Sandbox 状态主要保存在浏览器 `localStorage`。

## 3. 当前能力基线

- 10 个 SSP controller、85 个 controller 方法；另有 4 个 context 函数，总调用面 89。
- 79 个 v2 active 模板：4 个 combo、8 个 AI-enabled、0 个 placeholder。
- 4 个 Manifest 约束的 v3 atomic 模板，同 ID 采用 v3-first。
- `objectsTool` 已具备有界查询/描述及不透明 HighlightLease 生命周期。
- `topologyTool` 有 23 个 API，支持显式图、跨层 connector、blocker、约束 Dijkstra、路线渲染与回收。
- AI 只能选择 Registry 明确开放的模板，不能直接调用 SSP。
- 当前模型清单包含医院等测试场景；医院数据只能作为 fixture，不能成为通用产品契约。

## 4. 已整合的历史决策

### Topology

- 采用 narrow waist：核心只消费调用方显式提供的 nodes、edges、connectors、blockers，不读取行业语义，不调用其他 SSP controller。
- `STAIR`、`FACILITY` 等信息可透传、可查询，但 topology 核心不解释其业务含义。
- 跨楼层必须经过显式 connector；路线保存完整三维 polyline，直接叠加在 Three.js 场景，而不是独立二维拓扑图。
- 墙体是应用/适配层生成 blocker 的依据，不是 topology 核心中的业务节点。
- “入口→满足必经设施→目标”使用带 requirement bitmask 的精确 Dijkstra，不使用贪心。
- factory + 闭包不妨碍模板原子化；模板依赖稳定的 `ssp.topologyTool.method()` 路径，而不是源码顶层 named export。
- 尚缺通用 GLB metadata → world-space graph 适配器，这是当前最重要的产品能力缺口之一。

### Objects 与模板 Runtime

- `objectsTool.query/describe` 只允许编译期字段白名单、有界 `equals/in` 和强制 limit。
- HighlightLease 使用不透明 handle、后写优先、clone-on-write、context/model 回收。
- `clearAllHighlights` 仅允许宿主紧急恢复，不进入 AI 或组合模板。
- Phase 1 v3 atomic Runtime 已完成；Phase 2 的封闭组合 Runtime、`query-scene` 迁移、execution-local capability 和取消/超时/finally 释放仍待完成。
- v2 兼容 Runtime 仍使用动态编译，应逐步迁移并最终移除。

### Git 与交付

- 历史 SSP 查询/租约和模板 Phase 0/1 已提交并合入当前 `main`。
- 当前 `main` 相对已记录的 `origin/main` 为 ahead 6、behind 2；由于项目已决定暂停 GitHub，这只作为历史远端状态记录，不影响本地研发，也不得为核对此状态主动 fetch/pull。
- `src/model-manifest.json` 有用户已有未提交修改，任何角色都不得擅自覆盖或提交。
- 2026-08-21 起采用单工作区：停止新增或使用多 worktree 和日常 PR 流程。所有写入进入保存的项目目录，由产品经理维护单一任务分支和写队列。
- Codex 获准管理本地 `codex/*` 任务分支；同一时刻只允许一个任务分支写入。通过验证和产品验收后可合入本地 `main`。
- Git 仅用于本地任务分支、差异审查、精确恢复、检查点和已验收里程碑 commit。项目暂不连接 GitHub；禁止 fetch、pull、push、PR 和远程分支操作，直到用户重新决策。
- 每个里程碑在本地 commit 和验收汇报后，由用户完成外部手动备份；模型资产和加密凭据备份按独立清单处理。

## 5. 当前验证证据

2026-08-21 已通过：

- 79/79 模板 schema 审计，0 问题；AI-enabled 实际值为 8。
- Phase 0 能力分类：10 controllers / 85 methods / 0 unclassified。
- v3 审计：4 atomic / 4 Manifest binding / 0 issue。
- AI/template 与 topology 依赖边界审计。
- v3 Runtime 12 项、objects 13 项、topology 10 项回归。
- TypeScript 类型检查。

未作为本轮证据：生产构建、真实浏览器端到端验收、目标部署环境中的 LLM 通路、CI/CD 和生产性能。

## 6. 产品风险与优先级

### P0 — 发布前必须解决

1. **生产 LLM 后端未闭环**：仓库只有 Vite 开发代理，静态生产构建没有对应的 API 服务、认证、限流、密钥托管和可观测性。
2. **缺少交付门禁**：没有 CI workflow、统一 test 命令、浏览器 E2E、覆盖率门槛和构建产物验证。
3. **凭据治理**：本地环境存在真实 LLM 凭据配置；必须轮换并确认不会进入构建、日志或备份。
4. **本地备份纪律**：暂停 GitHub 后，里程碑外部手动备份成为磁盘或目录级故障的主要恢复保障，必须在进入下一里程碑前确认完成。

### P1 — 形成可用产品

1. 实现通用 GLB metadata → world-space topology graph 适配器，并用多个模型 fixture 验证。
2. 完成 Template Phase 2，迁移组合模板和 `query-scene`，收敛动态代码执行。
3. 把 AI_LAYER_VERIFICATION 的关键路径转为浏览器 E2E，并完成人工验收签字。
4. 定义模型资产的对象存储/CDN、版本、哈希、metadata 校验与回滚流程。
5. 建立首屏、模型加载、内存释放、低端设备和大场景性能预算。

### P2 — 从平台原型走向 SaaS

账户与权限、项目/场景管理、服务端持久化、远端模型库、多人协作、运营后台和产品级可观测性目前均未实现。

## 7. 团队角色与职责

### space AI platform产品经理-项目总控（当前主任务）

维护产品范围、优先级、验收标准、跨角色决策与发布闸门；不直接替代各技术角色做所有实现。

### 技术负责人 / 架构师

维护 SSP–Template–AI 的窄腰边界、接口评审、ADR、跨模块方案和代码质量；重点推进 Phase 2 与生产架构收敛。

### 前端与 Three.js 工程师

负责 Home/Chat/Sandbox 体验、模型加载、场景交互、路线/高亮可视化、性能、资源回收和浏览器兼容性。

### AI 与 Template Runtime 工程师

负责 Intent/Planner、v2→v3 迁移、组合 Runtime、能力权限、结果投影、超时取消和 LLM 行为评测。

### Topology 与空间数据工程师

负责通用 metadata→world-space graph 适配器、connector/blocker 数据生产、跨模型契约和寻路数据质量。

### 后端 / 平台 / DevOps 工程师

负责生产 LLM gateway、认证限流、密钥管理、CI/CD、模型资产/CDN、日志监控、部署与回滚。当前仓库没有独立后端，因此该岗位是新增的 P0 能力。

### QA 与安全工程师

负责测试策略、Playwright/E2E、回归矩阵、发布验收，以及代理暴露面、动态代码执行、依赖和供应链安全。早期可一人兼任，发布前需保持独立验收权。

## 8. 建议近期里程碑

1. **R1 通用空间链路可验收版（已批准，研发中）**：完成 metadata→graph 适配器、Three.js 路线显示、受控触发链路、非污染本地构建和浏览器 P0 验收。合同见 [`R1_MILESTONE.md`](./R1_MILESTONE.md)。
2. **后续发布基础（未批准）**：生产 LLM gateway、凭据治理、CI/CD、生产构建制品和发布级 E2E。
3. **后续 AI Runtime 收敛（未批准）**：完成 Phase 2，迁移关键 combo/query，降低 v2 动态执行面。
4. **后续产品化（未批准）**：项目/场景管理、权限、服务端审计、模型资产服务和生产可观测性。

## 9. 各角色共同约束

- 人员任务统一命名为“职责-分工内容”，例如“前端工程师-Three.js体验”；同职责新增人员时以新的具体分工内容区分，不使用人员编号。唯一例外是当前主对话 `space AI platform产品经理-项目总控`。
- 产品经理可依据阶段目标、工作量和专业边界提出新增、拆分、合并或撤销人员任务。任何人事变动必须向用户汇报变动内容、原因、影响和预期成本；不得静默调整团队编制。
- 开始工作先读本文、`README.md`、`PROJECT_SUMMARY.md` 和对应模块契约。
- 所有结论以当前代码和可复现验证为准，历史聊天只作决策背景。
- 不擅自修改受保护的 `src/ssp/**`；先提交范围、影响和验证方案给产品经理。
- 不触碰 `src/model-manifest.json` 的既有用户修改。
- 只按轻量 Git 流程创建经验证的本地检查点/里程碑 commit；不自行 push、合并远端历史、部署或处理凭据。
