# Space AI Platform — 产品与团队上下文

> 产品经理基线：2026-08-22。本文整合当前代码、权威项目文档及历史项目任务中的有效结论，作为后续各角色任务的共同产品上下文。代码契约仍以源码和 API catalog 为准。

治理入口：产品经理的长期角色、权限和汇报机制见 [`PRODUCT_MANAGER_CHARTER.md`](./PRODUCT_MANAGER_CHARTER.md)；最新组织架构见 [`ORG_CHART.md`](./ORG_CHART.md)；研发与备份流程见 [`DEVELOPMENT_WORKFLOW.md`](./DEVELOPMENT_WORKFLOW.md)；用户批准的长期决策见 [`DECISION_LOG.md`](./DECISION_LOG.md)。仓库任务的强制入口规则见根目录 [`AGENTS.md`](../AGENTS.md)。

## 1. 产品定位

Space AI Platform 是一个 AI 友好的 Three.js 空间能力平台：浏览器加载 GLB/BIM 场景，SSP 将场景能力封装成稳定的 controller，Template Registry 再把受控能力提供给 AI 和业务代码。

Space Model Studio 与 Space AI Platform 是两个独立产品：前者负责生产和校验标准模型，后者负责上层空间应用。两者不共享内部实现，只通过共同的版本化数据契约连接。用户已批准新增 Standard Model Package v1：Studio dual-write `3.3-semantic + embedded topology v1 + sidecar v1`，Platform dual-read 旧 v3.1 路径和新 package + 3.3 路径。双端实现与共同验证尚未完成，仍禁止宣称已经兼容；边界见 [`CROSS_PROJECT_DATA_CONTRACT.md`](./CROSS_PROJECT_DATA_CONTRACT.md)，联合设计见 [`STANDARD_MODEL_PACKAGE_V1.md`](./STANDARD_MODEL_PACKAGE_V1.md)。

当前目标用户首先是空间应用开发者和方案实施人员，而不是已经具备账户、权限、项目管理和多人协作的终端 SaaS 用户。

## 2. 核心用户链路

目标跨项目链路（契约收敛后）为：

```text
Space Model Studio 产出符合共享契约的标准模型包
→ Space AI Platform 选择场景/楼层 GLB
→ Three.js 加载并建立 SSP context
→ 用户输入自然语言或 Quick Action
→ 确定性规则 / Intent 缓存 / 同源 LLM 代理
→ Zod Intent 校验与 Planner
→ 统一 Template Runtime
→ SSP controller
→ 场景动作、查询结果与本地审计记录
```

当前 Studio 产物仍不能直接进入这条 Platform 链路并宣称契约兼容；在 package v1 双端实现和共同验证前，两边继续按各自冻结基线工作。

应用目前提供两个主要界面：3D 场景主页和 Template/Models/SSP Sandbox。模型选择、Intent 审计和 Sandbox 状态主要保存在浏览器 `localStorage`。

## 3. 当前能力基线

- 10 个 SSP controller、85 个 controller 方法；另有 4 个 context 函数，总调用面 89。
- 79 个 v2 active 模板：4 个 combo、8 个 AI-enabled、0 个 placeholder。
- 4 个 Manifest 约束的 v3 atomic 模板，同 ID 采用 v3-first。
- `objectsTool` 已具备有界查询/描述及不透明 HighlightLease 生命周期。
- `topologyTool` 有 23 个 API，支持显式图、跨层 connector、blocker、约束 Dijkstra、路线渲染与回收。
- R1 已具备版本化外置 topology sidecar v1 适配、可信资产证明、world-space graph 编译和 Three.js 场景生命周期；正式 A_1F/A_2F sidecar 分别提供可达与显式 blocker 无路 fixture。
- ChatPanel 已具备受控路径 Quick Action：仅从当前会话显式选择端点，并经注册模板完成查路、渲染与精确清除；不经过 LLM，也不直连 SSP。
- R1 已具备非污染本地验收入口：开发与构建不再隐式生成模型清单，固定 gate 在 dirty 基线上校验 manifest 原始字节与完整 Git porcelain 前后不变。
- AI 只能选择 Registry 明确开放的模板，不能直接调用 SSP。
- 当前模型清单包含医院等测试场景；医院数据只能作为 fixture，不能成为通用产品契约。

## 4. 已整合的历史决策

### 跨项目数据契约

- Space Model Studio 是标准模型生产方，Space AI Platform 是上层应用消费方；两个产品独立演进、独立发布，目标上只通过共同版本化数据契约连接。
- 当前 Studio 生产基线是 Metadata `3.3-semantic` 与 GLB 内嵌 `scene.extras.sspTopology` v1；Platform 消费基线是 Metadata v3.1 与外置 topology sidecar v1。两端尚未对齐，两个名为 v1 的 topology schema 也不是同一接口。
- 双方内部源码/API 不自动成为共享契约；Platform R1 的内部验收有效，但不构成 Studio → Platform 端到端兼容证据。
- 已发布版本不得单方静默修改。字段、枚举、ID、单位、坐标、发现或资产绑定等破坏性变化必须新版本、双端影响评估、共同 fixture/validator、迁移与回滚方案，并取得用户批准。
- Space AI Platform 优先以 SSP 外适配层吸收应用差异，不能为单个上层需求轻易要求 Studio 改动共享契约。
- 用户已批准 Standard Model Package v1：package manifest 显式声明 `3.3-semantic`、GLB/sidecar SHA-256、不可变 revision、资产与楼层身份；Studio 额外输出严格 sidecar v1，Platform 新增显式 3.3 reader 并保留 v3.1 reader。
- Platform 不读取 embedded topology 作为 fallback；新 reader、摘要核验和 AssetProof 集成都位于 `src/ssp/**` 之外。共同 fixtures/validators 通过前不得宣布跨项目兼容。

### Topology

- 采用 narrow waist：核心只消费调用方显式提供的 nodes、edges、connectors、blockers，不读取行业语义，不调用其他 SSP controller。
- `STAIR`、`FACILITY` 等信息可透传、可查询，但 topology 核心不解释其业务含义。
- 跨楼层必须经过显式 connector；路线保存完整三维 polyline，直接叠加在 Three.js 场景，而不是独立二维拓扑图。
- 墙体是应用/适配层生成 blocker 的依据，不是 topology 核心中的业务节点。
- “入口→满足必经设施→目标”使用带 requirement bitmask 的精确 Dijkstra，不使用贪心。
- factory + 闭包不妨碍模板原子化；模板依赖稳定的 `ssp.topologyTool.method()` 路径，而不是源码顶层 named export。
- 通用“GLB 基础 metadata + 外置 topology sidecar v1”→ world-space graph 适配器、非污染本地构建门禁、真实浏览器 P0、独立 QA、架构和产品验收均已在 R1 完成；当前只待用户批准关闭、创建本地里程碑记录并手动备份。

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

截至 2026-08-22 已通过：

- 79/79 模板 schema 审计，0 问题；AI-enabled 实际值为 8。
- Phase 0 能力分类：10 controllers / 85 methods / 0 unclassified。
- v3 审计：4 atomic / 4 Manifest binding / 0 issue。
- AI/template 与 topology 依赖边界审计。
- v3 Runtime 12 项、objects 13 项、topology 10 项回归。
- R1 topology sidecar v1 适配器 18 项专项回归：封闭 schema、资源预算、加载/proof 分层、世界坐标、connector/blocker 和诊断去敏均通过。
- R1 Three.js 场景生命周期 27 项专项回归：视觉加载与 proof 解耦、多资产部分成功、sidecar 失败优先级、同响应字节 handoff、原子 graph 补偿、A→B 失效和资源清理均通过；三视角独立复审无 P0/P1，1 个 P2 已关闭。
- R1 Quick Action 20 项专项回归：固定 Registry 模板链路、显式端点、NO_PATH、同 graph ID 重载、清除竞态、陈旧渲染补偿、route ID 所有权、诊断去敏和组件卸载均通过；其中 1 项使用真实 Template Runtime + SSP context 验证完整 `findPath → renderRoute → removeRoute`。三视角独立复审无 P0/P1，2 个 P2 已关闭。
- R1 本地 gate 自测通过 package wiring、dirty 基线、fail-fast / 真实退出码、manifest 漂移不恢复和 Git porcelain 漂移检查。
- R1 浏览器 P0 已通过 A_1F 可达路线及清除、A_2F `NO_PATH`、A_3F 缺失/非法 sidecar、页面与模型快速切换、结构化失败反馈和控制台检查；报告见 [`R1_BROWSER_P0_REPORT.md`](./R1_BROWSER_P0_REPORT.md)。
- `npm run verify:r1` 已按顺序通过 topology 10/10、sidecar 18/18、场景生命周期 27/27、Quick Action 20/20、三组边界审计、TypeScript 类型检查和 Vite 生产构建。用户 manifest 前后 SHA-256 均为 `2ed654ea23f091008e8bd91f2996077c938026ade8183dea972205997bea9fbc`，完整 Git porcelain 原始 Buffer 前后相同。
- R1 独立 QA 与架构终验均为 PASS，0 个未关闭 P0/P1/P2；产品范围核对无漂移，可以提交用户验收。三方结论见 [`R1_FINAL_ACCEPTANCE.md`](./R1_FINAL_ACCEPTANCE.md)。

未作为本轮证据：目标部署环境中的 LLM 通路、CI/CD、浏览器堆/GPU 指标和生产性能。生产构建已通过，但 Vite 仍报告大于 500 kB 的 chunk 警告，尚未设定发布性能预算。

## 6. 产品风险与优先级

### P0 — 发布前必须解决

1. **生产 LLM 后端未闭环**：仓库只有 Vite 开发代理，静态生产构建没有对应的 API 服务、认证、限流、密钥托管和可观测性。
2. **交付门禁仍不完整**：R1 已有本地统一 gate，但仍没有 CI workflow、浏览器 E2E、覆盖率门槛和发布级构建制品验证。
3. **凭据治理**：本地环境存在真实 LLM 凭据配置；必须轮换并确认不会进入构建、日志或备份。
4. **本地备份纪律**：暂停 GitHub 后，里程碑外部手动备份成为磁盘或目录级故障的主要恢复保障，必须在进入下一里程碑前确认完成。
5. **跨项目契约尚未实现**：Standard Model Package v1 方向已批准，但 package/exporter、3.3 reader、共同 fixtures/validators 和双端端到端验证尚未交付。完成前必须阻断跨项目兼容发布声明，并防止 legacy reader 自动猜版本。

### P1 — 形成可用产品

1. 在 R1 用户验收与手动备份后，扩展更多非医院模型 fixture。
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

负责通用 metadata→world-space graph 适配器、connector/blocker 数据生产、与 Space Model Studio 协同的共享数据契约、兼容矩阵和寻路数据质量。

### 后端 / 平台 / DevOps 工程师

负责生产 LLM gateway、认证限流、密钥管理、CI/CD、模型资产/CDN、日志监控、部署与回滚。当前仓库没有独立后端，因此该岗位是新增的 P0 能力。

### QA 与安全工程师

负责测试策略、Playwright/E2E、回归矩阵、发布验收，以及代理暴露面、动态代码执行、依赖和供应链安全。早期可一人兼任，发布前需保持独立验收权。

### R1 终验临时代理（2026-08-22）

因原技术负责人和 QA 任务完成检查后未保存可读取结论，且补发触发任务额度限制，当前临时启用 `技术负责人-R1终验代理` 与 `QA工程师-R1终验代理`，只对冻结的 R1 候选版本出具可审计终验结论。两项代理不取得代码写入权或长期编制，R1 用户验收关闭后自动撤销；常设六岗位及汇报关系不变。

## 8. 建议近期里程碑

1. **R1 通用空间链路可验收版（研发完成，待用户验收）**：采用版本化外置 topology sidecar v1，在不修改 SSP 核心的前提下完成“GLB 基础 metadata + sidecar”→ world-space graph 适配、Three.js 路线显示、受控触发链路、非污染本地构建、浏览器 P0、独立 QA 和架构验收。合同见 [`R1_MILESTONE.md`](./R1_MILESTONE.md)，终验结论见 [`R1_FINAL_ACCEPTANCE.md`](./R1_FINAL_ACCEPTANCE.md)。
2. **R2 Standard Model Package v1（方案已批准，联合设计已确认）**：下一门禁为共同机器 schema、diagnostics 与 fixture SHA index，随后执行 Studio exporter/producer validator → Platform package/3.3 reader → 双端交叉验证与浏览器验收。R1 关闭和手动备份完成前不启动高风险实现。
3. **后续发布基础（未批准）**：生产 LLM gateway、凭据治理、CI/CD、生产构建制品和发布级 E2E。
4. **后续 AI Runtime 收敛（未批准）**：完成 Phase 2，迁移关键 combo/query，降低 v2 动态执行面。
5. **后续产品化（未批准）**：项目/场景管理、权限、服务端审计、模型资产服务和生产可观测性。

## 9. 各角色共同约束

- 人员任务统一命名为“职责-分工内容”，例如“前端工程师-Three.js体验”；同职责新增人员时以新的具体分工内容区分，不使用人员编号。唯一例外是当前主对话 `space AI platform产品经理-项目总控`。
- 产品经理可依据阶段目标、工作量和专业边界提出新增、拆分、合并或撤销人员任务。任何人事变动必须向用户汇报变动内容、原因、影响和预期成本；不得静默调整团队编制。
- 开始工作先读本文、`README.md`、`PROJECT_SUMMARY.md` 和对应模块契约。
- 所有结论以当前代码和可复现验证为准，历史聊天只作决策背景。
- 不擅自修改受保护的 `src/ssp/**`；先提交范围、影响和验证方案给产品经理。
- 不触碰 `src/model-manifest.json` 的既有用户修改。
- 只按轻量 Git 流程创建经验证的本地检查点/里程碑 commit；不自行 push、合并远端历史、部署或处理凭据。
