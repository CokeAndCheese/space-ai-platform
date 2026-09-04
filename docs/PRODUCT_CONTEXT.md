# Space AI Platform — 产品与团队上下文

> 产品经理基线：2026-09-01。本文整合当前代码、权威项目文档及历史项目任务中的有效结论，作为后续各角色任务的共同产品上下文。代码契约仍以源码和 API catalog 为准。

治理入口：产品经理的长期角色、权限和汇报机制见 [`PRODUCT_MANAGER_CHARTER.md`](./PRODUCT_MANAGER_CHARTER.md)；最新组织架构见 [`ORG_CHART.md`](./ORG_CHART.md)；研发与备份流程见 [`DEVELOPMENT_WORKFLOW.md`](./DEVELOPMENT_WORKFLOW.md)；用户批准的长期决策见 [`DECISION_LOG.md`](./DECISION_LOG.md)。仓库任务的强制入口规则见根目录 [`AGENTS.md`](../AGENTS.md)。

## 1. 产品定位

Space AI Platform 是一个 AI 友好的 Three.js 空间能力平台：浏览器加载 GLB/BIM 场景，SSP 将场景能力封装成稳定的 controller，Template Registry 再把受控能力提供给 AI 和业务代码。

Space Model Studio 与 Space AI Platform 是两个独立产品：前者负责生产和校验标准模型，后者负责上层空间应用。两者不共享内部实现，只通过共同的版本化数据契约连接。用户已批准新增 Standard Model Package v1：Studio dual-write `3.3-semantic + embedded topology v1 + sidecar v1`，Platform dual-read 旧 v3.1 路径和新 package + 3.3 路径。原候选的双端机器实现和联合技术验收已完成；用户于 2026-09-01 进一步批准 v1/v2 TOWER/ROOF nullable-level 兼容修正，Studio `f653264` 与 Platform `acbf1f4`/`135be84` 已关闭 order 推测 P0 并完成修订 fixture 与自动矩阵，Platform 又在 `4ca8645bffc524d78e606eed6abfe24da608dda2` 验证基线完成 Studio 修订 v1/v2 ZIP 直导真实浏览器验收。当前只可称 Platform 任务分支机器技术封版；尚未获得用户兼容里程碑批准、尚未发布或合并，也不表示 Platform 本地 `main` 或 Studio/Forge/Platform 三端已兼容。v2 的既有 P0 精确机器值、补充决策、发布和临时兼容里程碑状态不变。边界见 [`CROSS_PROJECT_DATA_CONTRACT.md`](./CROSS_PROJECT_DATA_CONTRACT.md)，v1 联合设计见 [`STANDARD_MODEL_PACKAGE_V1.md`](./STANDARD_MODEL_PACKAGE_V1.md)，v2 过渡计划见 [`STANDARD_MODEL_PACKAGE_V2_TRANSITION.md`](./STANDARD_MODEL_PACKAGE_V2_TRANSITION.md)，Platform 独立验收见 [`STANDARD_MODEL_PACKAGE_TRRF_PLATFORM_ACCEPTANCE.md`](./STANDARD_MODEL_PACKAGE_TRRF_PLATFORM_ACCEPTANCE.md)。

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

Standard Model Package v1 原候选已经在双方任务分支和真实浏览器联合链路中通过技术验收；nullable 特殊层修订权威 fixture/index 已完成 Platform 同字节镜像、P0 回归、独立验签和 Studio 修订 ZIP → Platform v1/v2 真实浏览器验收。Platform 消费端技术门禁已关闭，但用户兼容里程碑、其他产品证据和各仓 local `main` 集成仍未完成，因此尚不能宣称修正后的三端兼容交付。普通 Studio 产物、旧 building-release ZIP 和没有显式 v1 manifest identity 的 ZIP 仍不能进入该链路。

能力声明型 v2 已冻结 P0 精确值，Platform 任务分支已有显式 v2 reader/lifecycle/capability/UI 消费候选。v2 必须是严格验证并最终回读的显式标准包，不接收 `*-unvalidated` 或旧 batch；候选未合入 local `main`、未发布，不能表述为已经放行的运行能力。

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
- R2 Standard Model Package v1 原候选已在 Platform checkpoint `786e3f3` 与 Studio producer checkpoint `02b560a` 完成机器实现和联合技术验收；双仓同字节 golden ZIP SHA-256 为 `d0662cdfb95656def2d553a727ddeb88a3b946c9f2ecbefe2558fd83723423b0`，SHA index 已分别验签，双方全门禁、真实浏览器联合验收及最终独立 Reviewer 均通过且 P0/P1/P2 为 0。该证据早于 nullable 特殊层修正；修订后的 Platform 消费端浏览器证据已于 2026-09-04 补齐，但当前仍是待其他产品联合收口、待用户里程碑确认的兼容候选，不是发布或 `main` 合并结论。
- Standard Model Package v2 P0 精确值已批准：合法 v2 显式声明 topology `ABSENT`，仅发布 Scene/Metadata ready，并对 topology 功能投影 `TOPOLOGY_UNAVAILABLE / PACKAGE_DECLARED_ABSENT`。Platform 消费候选检查点为 parser `e5b6462`、lifecycle `2033525`、capability gate `7733284`、UI `c498452`、fixture `f499da8`；未合入 local `main`、未发布。
- 2026-09-01 nullable 特殊层修正已在 Platform checkpoints `30e1b4e`（validator/Metadata/lifecycle）、`d4475ba`（Template 查询专项）、`acbf1f4`（修订 fixture/P0/fail-closed）和 `135be84`（真实 validated v2 查询）完成，并在 `4ca8645bffc524d78e606eed6abfe24da608dda2` 验证基线通过修订 v1/v2 真实浏览器消费端验收。TOWER/ROOF 要求非空 building，level 键必填且允许 `null` 或有限整数；其他 floorType 条件不变。v1 的 `A_T`/`A_RF` layer 无 `order`，`A_5F`/`A_6F` order 为 `5`/`6`；精确 floorName/floorType 查询可用，数字 level 与 level 派生能力对 `null` 不适用，不增加推导、排序、elevation、schema/version 或 topology。
- AI 只能选择 Registry 明确开放的模板，不能直接调用 SSP。
- 2026-08-27 用户批准的 R1 可见性 UX 修正已完成：`query-scene` hide 不再弹原生确认；hide/show/isolate 仅保留最新一步精确撤回；“全部显示”继续作为非撤回的全局恢复；模型切换或重载使旧撤回失效。随后发现的自然语言“撤回”缺陷也已闭环：聊天“撤回”现由确定性 host-only 路由处理，按钮与聊天共用同一 helper，不进入 Intent/Planner/AI catalog；host UI turns `llmVisible=false` 并与 context ring 解耦，审计语义保持一致。18 项 Template Runtime、A_1F/A_2F 真实浏览器路径、三轮 QA 和 `verify:r1` 10/10 均通过，最终无 P0/P1/P2，证据见 [`R1_VISIBILITY_UNDO_REPORT.md`](./R1_VISIBILITY_UNDO_REPORT.md)。
- 当前模型清单包含医院等测试场景；医院数据只能作为 fixture，不能成为通用产品契约。

## 4. 已整合的历史决策

### 跨项目数据契约

- Space Model Studio 是标准模型生产方，Space AI Platform 是上层应用消费方；两个产品独立演进、独立发布，目标上只通过共同版本化数据契约连接。
- Studio 的 legacy 生产基线仍是 Metadata `3.3-semantic` 与 GLB 内嵌 `scene.extras.sspTopology` v1；Platform 的 legacy 消费基线仍是 Metadata v3.1 与外置 topology sidecar v1。两个名为 v1 的 topology schema 仍不是同一接口；Standard Model Package v1 只通过显式 manifest 和正式 sidecar 建立新窄腰。
- 双方内部源码/API 不自动成为共享契约；现已具备独立 producer/consumer 实现、同字节 fixture、联合浏览器和 Reviewer 证据，但兼容里程碑仍待用户确认。
- 已发布版本不得单方静默修改。字段、枚举、ID、单位、坐标、发现或资产绑定等破坏性变化必须新版本、双端影响评估、共同 fixture/validator、迁移与回滚方案，并取得用户批准。
- Space AI Platform 优先以 SSP 外适配层吸收应用差异，不能为单个上层需求轻易要求 Studio 改动共享契约。
- 用户已批准 Standard Model Package v1：package manifest 显式声明 `3.3-semantic`、GLB/sidecar SHA-256、不可变 revision、资产与楼层身份；Studio 额外输出严格 sidecar v1，Platform 新增显式 3.3 reader 并保留 v3.1 reader。
- Platform 不读取 embedded topology 作为 fallback；新 reader、摘要核验和 AssetProof 集成都位于 `src/ssp/**` 之外。技术门禁已经通过，但用户里程碑确认前不得宣布跨项目兼容、发布或 `main` 已合并。
- 用户已批准 Studio V1「整体建筑导入」，但它仅是 Studio 的内部 authoring input profile：单个 raw `Building.glb` 在 Studio 内识别楼层并形成逐层只读源视图，再复用 Studio 既有 Metadata/SPACE/Topology 能力。raw `Building.glb` 不是 Standard Model Package、不是 Metadata/Topology 发布契约，也不是 Platform 输入；Platform 不扫描、不猜测、不直接读取该文件，不产生研发动作或人员变动。
- Studio SHA-256 `33150f24fae21f7c2e15a9f804bb9067c9b75200cd089dce4703355c493fe679` 的 metadata-free 单层 Source GLB naming authority、Building Source GLB 与 Building Source Bundle 都是 authoring 边界，Platform 均非消费者。该 Studio naming authority 只供 Forge 在限定 Studio 交付场景引用/镜像，不替换、迁移或重定义 Forge 自身 SHA 前缀 `8bdf440a` 的产品 authority。
- 「整体建筑导入」不得借内部拆层静默扩展跨层 connector/路由，也不改变 Package v1、Metadata v3.1/`3.3-semantic`、embedded topology v1 或 sidecar v1。Studio 仍须经过既有发布门禁输出标准模型；Standard Model Package v1 候选不提供跨层 routing，旧 building-release ZIP 也继续由 Platform 拒绝。
- 用户已批准独立 v2 临时路径及 P0 精确值。v2 不改变 v1 requiredness，不接收 `*-unvalidated` 或旧 batch，不使用空/伪 sidecar或 embedded fallback；Platform 只开放无 topology 能力。Platform 候选与同字节 fixture 证据已完成，但 local `main`/发布/里程碑门禁未完成，不能提前声明兼容。
- 用户已批准 v1/v2 Package 3.3 的 nullable 特殊层候选修正：`A_T`/TOWER/`null` 与 `A_RF`/ROOF/`null` 合法，既有整数 TOWER/ROOF 继续兼容；manifest、默认 scene 与所有 mesh node 的 floor identity 必须完全一致。FLOOR/BASEMENT/FACILITY 与 LANDSCAPE 条件不变，Platform 不猜 level。该修正不改变 legacy v3.1 reader、sidecar、embedded fallback 或 v2 topology unavailable 边界。

### Topology

- 采用 narrow waist：核心只消费调用方显式提供的 nodes、edges、connectors、blockers，不读取行业语义，不调用其他 SSP controller。
- `STAIR`、`FACILITY` 等信息可透传、可查询，但 topology 核心不解释其业务含义。
- 跨楼层必须经过显式 connector；路线保存完整三维 polyline，直接叠加在 Three.js 场景，而不是独立二维拓扑图。
- 墙体是应用/适配层生成 blocker 的依据，不是 topology 核心中的业务节点。
- “入口→满足必经设施→目标”使用带 requirement bitmask 的精确 Dijkstra，不使用贪心。
- factory + 闭包不妨碍模板原子化；模板依赖稳定的 `ssp.topologyTool.method()` 路径，而不是源码顶层 named export。
- 通用“GLB 基础 metadata + 外置 topology sidecar v1”→ world-space graph 适配器、非污染本地构建门禁、真实浏览器 P0、独立 QA、架构和产品验收均已在 R1 完成；2026-08-27 批准的可见性 UX 修正也已实现并重新通过门禁。当前只待本地检查点和用户外部手动备份确认后关闭 R1。

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

截至 2026-08-28 已通过：

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
- `npm run verify:r1` 已按顺序通过 topology 10/10、sidecar 18/18、场景生命周期 27/27、Quick Action 20/20、Template Runtime 18/18、三组边界审计、TypeScript 类型检查和 Vite 生产构建。用户 manifest 前后 SHA-256 均为 `2ed654ea23f091008e8bd91f2996077c938026ade8183dea972205997bea9fbc`，完整 Git porcelain 原始字节前后相同。
- R1 原候选版本及 2026-08-27 可见性 UX 修正版均已独立复核为 PASS，当前没有未关闭 P0/P1/P2；修正版证据见 [`R1_VISIBILITY_UNDO_REPORT.md`](./R1_VISIBILITY_UNDO_REPORT.md)，总体验收见 [`R1_FINAL_ACCEPTANCE.md`](./R1_FINAL_ACCEPTANCE.md)。
- R2 Platform consumer 实现检查点为 `786e3f3123d24dde264aca0536ef04f6e4fe8e07`，Studio producer 实现检查点为 `02b560a`；两端分别完成全门禁，且没有修改 Platform 旧 v3.1 reader、embedded fallback 或 `src/ssp/**`。
- 双仓同字节 golden ZIP 与 SHA index 已验签；ZIP SHA-256 为 `d0662cdfb95656def2d553a727ddeb88a3b946c9f2ecbefe2558fd83723423b0`。真实浏览器完成 Studio ZIP → Platform 直接解析导入、复用现有场景和 topology 功能的联合验收；最终独立 Reviewer P0/P1/P2 均为 0。
- v2 同字节 fixture ZIP SHA-256 为 `be0b7734ebbb3effb1f220f601d047d69dcf849c5d16bf7fdc1cd54f4f90e0c7`，SHA index 为 `c559d47222f6d7d61160d74676885e61ea0c0a462f0f67d6c7e5cdd2cc78a91c`，canonical revision 为 `96fee045700e5bbe18c4b196ae96821a84508860460c3cd2e59455594bc61b22`。自动验收通过 v2 parser 16、v2 lifecycle 5、home 13、capability 9、Quick Action 22、v1 parser 33、v1 lifecycle 10、legacy 27、sidecar 18、templates 18、typecheck/build/`verify:r1`/审计；真实浏览器显式导入 v2 后 2 floors、Scene/Metadata ready、无 graph、Topology 稳定 unavailable，仅有两条权威最小 GLB 的 Three loader min/max warning、无 error。
- nullable 特殊层修订权威来自 Studio `f653264`，Platform checkpoints 为 `acbf1f4` 与 `135be84`。authority document/index/source `Building.glb`/v1 ZIP/v2 ZIP SHA-256 依次为 `c41dedc540037cfadbae828e82da4f170a97732e7a96d2ff14744ef75e4446ae`、`085a3a08f54fb7f02ee9ef6e16242e47d7741bb5821fdc95869df10ef6cc4485`、`86244b9a40f75e11397cf8ebc65dc0509ffb0337eece3c2a8ba2e1d32a04b864`、`1080cc8717eed98d18eb7a1c8708596ac43c90a7181c28fb55ac5a69df3b3e76`、`a07fe215f0c878d407378d033328f8ad7d3602b94c89701c2266896ac41ef77c`；v1 package/sidecar revision 为 `482a129ffeef87de842d86ecb62e9e2d2f693ebcc0ae194543ab6e82c7f142bb`，v2 canonical revision 为 `b89bdf4c02f7c99182483a3f5119a4ed10141c11889108108bc47cf260f7c8d4`。最终矩阵 v1/v2 parser 35/18、v1/v2 lifecycle 13/8、Template 20、sidecar 18、capability 9、Quick Action 22、home 13、legacy lifecycle 27、topology 10、typecheck/build/`verify:r1` 10/10 均 PASS；`4ca8645bffc524d78e606eed6abfe24da608dda2` 基线的 v1/v2 修订浏览器直导、同会话切换及精确 T/RF 查询也 PASS，控制台 error 为 0。报告见 [`STANDARD_MODEL_PACKAGE_TRRF_PLATFORM_ACCEPTANCE.md`](./STANDARD_MODEL_PACKAGE_TRRF_PLATFORM_ACCEPTANCE.md)。
- 旧 `35161cc`/`dbceba4` 及其 authority/index/v1 ZIP/revision SHA `7df85d3992559ba299b08ce8e55917c732291a519175de6c71c4b422eb128f0f`、`f72befd8dc538095fdca43d5979c968b57b87d1c8650a81ecb8a337405a80ef1`、`b2cc39d73504f2f8ed2535305785f9a32e3b93493eebbb52737ce90b404b2be4`、`dddc3c9f5c3ee48d3e8123d8ae1d9b5ea591d1eced7ebf3bfcda8ce6e4b4c147` 因 nullable T/RF 的 `order: 0` 推测缺陷已 superseded，仅作历史证据，不得用于最终兼容声明。

未作为本轮证据：目标部署环境中的 LLM 通路、CI/CD、浏览器堆/GPU 指标和生产性能。生产构建已通过，但 Vite 仍报告大于 500 kB 的 chunk 警告，尚未设定发布性能预算。

## 6. 产品风险与优先级

### P0 — 发布前必须解决

1. **生产 LLM 后端未闭环**：仓库只有 Vite 开发代理，静态生产构建没有对应的 API 服务、认证、限流、密钥托管和可观测性。
2. **交付门禁仍不完整**：R1 已有本地统一 gate，但仍没有 CI workflow、浏览器 E2E、覆盖率门槛和发布级构建制品验证。
3. **凭据治理**：本地环境存在真实 LLM 凭据配置；必须轮换并确认不会进入构建、日志或备份。
4. **本地备份纪律**：暂停 GitHub 后，里程碑外部手动备份成为磁盘或目录级故障的主要恢复保障，必须在进入下一里程碑前确认完成。
5. **跨项目兼容候选尚待用户确认**：Standard Model Package v1 的双端任务分支实现、共同 fixtures/validators、真实浏览器联合验收和独立 Reviewer 已通过，但尚未获得用户里程碑确认、尚未发布或合并到 `main`。确认前继续阻断兼容发布声明，并保持 legacy reader 不猜版本。
6. **v2 候选尚未成为交付基线**：P0 精确值与 Platform 消费候选已经完成，但尚未合入 local `main`、发布或获得临时兼容里程碑批准。继续阻断未批准的运行放行，并保持 v1/legacy、unvalidated 拒绝、显式入口和无 Graph-ready 误报。
7. **nullable 特殊层三端里程碑门禁未闭环**：order 推测 P0、修订权威 fixture 同字节镜像、独立验签、最终自动矩阵和 Platform 消费端真实浏览器验收均已完成，但其他产品联合证据、用户兼容里程碑和各仓 local `main` 集成尚未完成。完成前不得宣称 Studio/Forge/Platform 三端兼容、发布、合并或 `main` 已兼容。

### P1 — 形成可用产品

1. 在 R1 UX 修正重新验收、用户关闭和手动备份后，扩展更多非医院模型 fixture。
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
2. **R2 Standard Model Package v1（Platform 任务分支机器技术封版，待用户里程碑与三端收口）**：原联合技术验收、Platform nullable 实现、P0 order 纠正、`acbf1f4` 修订权威 v1 fixture 验签及 `4ca8645bffc524d78e606eed6abfe24da608dda2` 基线真实浏览器消费端验收均已完成。候选尚未发布、合并或进入 `main` 兼容基线。
3. **Standard Model Package v2 临时过渡（Platform 任务分支机器技术封版，待用户里程碑与三端收口）**：显式 topology `ABSENT`、严格 reader/lifecycle/capability/UI 门禁、修订权威 v2 fixture 验签、`135be84` 真实 validated 查询覆盖及 `4ca8645bffc524d78e606eed6abfe24da608dda2` 基线真实浏览器消费端验收均已完成。候选尚未合入 local `main`、发布或获用户临时兼容里程碑批准；停发/停收、存量迁移和最终 reader 移除仍须双方共同门禁与用户批准。
4. **后续发布基础（未批准）**：生产 LLM gateway、凭据治理、CI/CD、生产构建制品和发布级 E2E。
5. **后续 AI Runtime 收敛（未批准）**：完成 Phase 2，迁移关键 combo/query，降低 v2 动态执行面。
6. **后续产品化（未批准）**：项目/场景管理、权限、服务端审计、远端模型库、多人协作和产品级可观测性。

## 9. 各角色共同约束

- 人员任务统一命名为“职责-分工内容”，例如“前端工程师-Three.js体验”；同职责新增人员时以新的具体分工内容区分，不使用人员编号。唯一例外是当前主对话 `space AI platform产品经理-项目总控`。
- 产品经理可依据阶段目标、工作量和专业边界提出新增、拆分、合并或撤销人员任务。任何人事变动必须向用户汇报变动内容、原因、影响和预期成本；不得静默调整团队编制。
- 开始工作先读本文、`README.md`、`PROJECT_SUMMARY.md` 和对应模块契约。
- 所有结论以当前代码和可复现验证为准，历史聊天只作决策背景。
- 不擅自修改受保护的 `src/ssp/**`；先提交范围、影响和验证方案给产品经理。
- 不触碰 `src/model-manifest.json` 的既有用户修改。
- 只按轻量 Git 流程创建经验证的本地检查点/里程碑 commit；不自行 push、合并远端历史、部署或处理凭据。
