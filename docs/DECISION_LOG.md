# Space AI Platform — 决策日志

> 仅记录用户批准、撤销或替换的长期产品、架构、人员、风险和发布决策。按时间追加，不覆盖历史。当前产品事实见 `PRODUCT_CONTEXT.md`。

## 2026-08-21 — 任命产品经理与项目总控

- **状态**：有效。
- **决策**：用户任命 `产品经理-项目总控` 为本项目产品经理，负责全量理解项目、整合上下文、组织研发和最终产品验收。
- **影响**：该任务成为产品决策、跨角色协调和验收的单一主入口。

## 2026-08-21 — 用户只处理决策问题

- **状态**：有效。
- **决策**：产品经理只向用户汇报需要拍板的产品、范围、架构、重大风险、人员和发布事项。
- **授权**：决策通过后，产品经理自行拆解工作、安排人员、协调依赖和组织验收。
- **边界**：提交、推送、合并、部署、外部发送、凭据处理和破坏性操作仍需对应明确授权。

## 2026-08-21 — 人员任务命名规则

- **状态**：有效。
- **决策**：人员任务统一命名为 `职责-分工内容`。
- **示例**：`前端工程师-Three.js体验`。
- **扩编规则**：同职责新增人员时以新的具体分工内容区分，不使用编号。

## 2026-08-21 — 产品经理的人事提议权

- **状态**：有效。
- **决策**：产品经理可提出新增、拆分、合并或撤销人员任务。
- **汇报要求**：所有人事变动必须向用户说明变动内容、原因、影响、预期成本和建议；不得静默调整团队编制。

## 2026-08-21 — 组织架构持续固化与反馈

- **状态**：有效。
- **决策**：沟通过程中一旦涉及岗位、职责、汇报关系或人员结构优化，产品经理必须及时同步固化。
- **执行方式**：提议与生效架构分别维护在 `ORG_CHART.md`；获批并执行后同步产品上下文和决策日志。
- **反馈要求**：每次生效变更后向用户反馈完整最新组织架构，而不只报告差异。

## 2026-08-21 — 单工作区、轻量 Git 与里程碑手动备份

- **状态**：有效。
- **决策**：停止多 worktree 与日常 PR 工作流；所有研发使用保存的单一项目目录。
- **执行方式**：产品经理维护单一任务分支和写入队列；同一时刻只允许一个实现任务写入，只读分析和评审可并行。
- **Git 授权**：允许在精确范围核对和相关验证通过后创建本地检查点或已验收里程碑 commit；不包含 push、远端历史合并或部署。
- **备份责任**：每个里程碑验收和本地 commit 后，用户手动执行外部项目备份并确认；模型资产与敏感配置按清单分别保护。
- **影响**：团队编制不变；并行写入速度降低，流程复杂度、冲突和误操作风险下降。

## 2026-08-21 — Codex 管理本地任务分支

- **状态**：有效。
- **授权**：Codex 可以在单一工作区创建、命名、切换和关闭本地任务分支，默认使用 `codex/` 前缀。
- **合入规则**：任务分支通过相关验证和产品验收后，可合入本地 `main`。
- **边界**：同一时刻只允许一个任务分支写入；push、远程分支删除、远端历史合并和部署仍需单独授权。
- **用户改动保护**：如果分支操作需要移动、暂存、提交或覆盖用户现有改动，必须停止并取得对应授权。

## 2026-08-21 — 暂停 GitHub，全部本地研发

- **状态**：有效。
- **决策**：项目当前不连接 GitHub，全部研发、任务分支、提交和里程碑历史保存在本地。
- **禁止操作**：不执行 fetch、pull、push、PR、远程分支检查/删除或其他 GitHub 协作操作。
- **恢复条件**：只有用户未来明确作出新决策后，才重新评估远端同步方式。
- **影响**：已记录的本地/远端分叉不再阻塞本地研发；里程碑手动备份成为外部故障恢复的必要门禁。

## 2026-08-21 — 产品经理主对话命名例外

- **状态**：有效。
- **决策**：本项目产品经理主对话固定命名为 `space AI platform产品经理-项目总控`。
- **例外范围**：仅此主对话不使用纯粹的 `职责-分工内容` 格式，以便与其他项目的产品经理对话区分。
- **其他人员**：所有研发人员仍继续使用 `职责-分工内容` 命名规则。

## 2026-08-21 — 批准 R1 通用空间链路可验收版

- **状态**：有效。
- **背景**：核心 Three.js / SSP、模板和 Topology 原型已有验证证据，但通用 GLB metadata 适配和本地产品验收链路尚未闭环。
- **决策**：用户批准研发里程碑 R1「通用空间链路可验收版」。
- **范围**：实现通用 metadata → world-space topology graph、Three.js 路线显示、Quick Action 或受控模板触发，以及非污染本地构建和浏览器 P0 验收。
- **边界**：R1 不扩张到生产 LLM gateway、线上部署、账户权限、完整 Template Phase 2 或 GitHub 协作。
- **执行**：产品经理自主拆解、分工、管理本地 `codex/r1-generic-spatial-chain` 分支和单一写入队列，并组织架构复核与独立 QA。
- **关闭条件**：用户完成里程碑验收后创建本地里程碑 commit，并在进入下一里程碑前完成外部手动备份。

## 2026-08-22 — 确立 Space Model Studio 与 Space AI Platform 的共享数据契约边界

- **状态**：有效。
- **产品关系**：Space Model Studio 负责提供和校验标准模型；Space AI Platform 负责上层空间应用。两个产品相互独立，架构上只允许由用户批准的同一套版本化数据契约连接；当前实现尚未完成该收敛。
- **当前事实**：Studio 生产基线为 Metadata `3.3-semantic` 与 GLB 内嵌 `scene.extras.sspTopology` v1；Platform 消费基线为 Metadata v3.1 与外置 topology sidecar v1。两者当前未对齐，不得声明为可直接互操作的同一机器契约。
- **变更规则**：任何一方不得单独、静默改变已发布版本的字段、枚举、ID、坐标、发现、引用或资产绑定语义。破坏性变化必须发布新版本，完成双端影响评估、共同 fixture/validator、兼容迁移和回滚方案，并取得用户明确批准。
- **责任**：Model Studio 对生产端符合性负责；AI Platform 对消费、校验、兼容和 SSP 外适配负责；技术负责人维护跨项目契约变更门禁，空间数据工程师维护双端 fixture 与兼容矩阵。
- **记录**：完整边界与流程见 [`CROSS_PROJECT_DATA_CONTRACT.md`](./CROSS_PROJECT_DATA_CONTRACT.md)。
- **待决事项**：选择冻结隔离、新增标准模型包契约，或由 Platform 新增独立 3.3/embedded adapter；在用户决定前双方维持现有基线。

## 2026-08-22 — 批准方案 B：建立 Standard Model Package v1

- **状态**：有效。
- **背景**：Studio `3.3-semantic + embedded topology v1` 与 Platform `v3.1 + sidecar v1` 无法直接互操作，但两个产品必须通过同一套版本化数据契约连接。
- **决策**：用户批准方案 B，新增独立 `space-model-package` schema v1。Studio 保留 embedded topology 并额外输出严格 Platform sidecar v1；Platform 保留旧 v3.1 reader，并新增 package v1 + `3.3-semantic` 的显式 reader/validator。
- **冻结边界**：不就地修改 Metadata v3.1、`3.3-semantic`、Studio embedded topology v1 或 Platform sidecar v1；Platform 不读取 embedded topology 作为 fallback，不修改 `src/ssp/**`。
- **交付门禁**：共同 JSON contract、golden success/failure fixtures、producer/consumer validators、兼容矩阵、迁移与回滚、双端自动验证和独立 QA 全部通过前，不得声明跨项目兼容。
- **执行**：两个项目总控直接协同；Studio 负责 package/exporter/producer validation，Platform 负责 package reader、3.3 adapter、AssetProof/sidecar 集成与 consumer validation。
- **人员影响**：无新增或撤销编制；两端现有技术负责人、模型/空间数据工程师和 QA 承担联合工作。
- **实施顺序**：Platform R1 完成用户关闭和手动备份前，只固化联合设计，不启动新的高风险实现写入。
- **记录**：联合设计基线见 [`STANDARD_MODEL_PACKAGE_V1.md`](./STANDARD_MODEL_PACKAGE_V1.md)。
- **设计结果**：两个项目总控已完成九项逐条确认，当前无剩余契约设计冲突；下一门禁是共同机器 schema、diagnostic envelope 与同字节 fixture SHA-256 index。
- **替换关系**：解决上一条决策中的“待决事项”；长期产品分离与变更门禁继续有效。

## 2026-08-26 — 确认 Studio V1「整体建筑导入」为生产侧内部输入能力

- **状态**：有效。
- **背景**：用户批准 Space Model Studio 从单个 raw `Building.glb` 自动识别楼层、创建 floors，并逐层复用现有 Metadata/SPACE/Topology authoring 能力。
- **决策**：该能力是 Studio 内部 authoring input profile，不是 Standard Model Package、Metadata `3.3-semantic`、topology sidecar 或 Space AI Platform 输入。
- **Platform 边界**：Platform 不扫描、猜测或直接读取 raw `Building.glb`，不新增 reader、adapter、SSP、模板或 UI 研发动作。
- **契约影响**：不改变 Standard Model Package v1、Metadata v3.1/`3.3-semantic`、Studio embedded topology v1 或 Platform sidecar v1；不借内部拆层扩展跨层 connector/路由语义。
- **交付门禁**：Studio 最终仍按既有标准模型和未来 Package 门禁发布；共同 fixtures/validators 完成前不得宣称 Package 兼容。
- **人员影响**：Platform 无新增、撤销或职责迁移。

## 2026-08-27 — R1 收口前修正 query-scene 可见性撤回 UX

- **状态**：有效。
- **背景**：R1 收口前复核发现，`query-scene` 的 hide 原生确认会打断受控可见性操作，而把全局可见性恢复动作当作撤回会丢失操作前的精确可见性状态。
- **决策**：用户批准取消 `query-scene` hide 的原生确认；hide、show、isolate 操作完成后提供一个最新的一步精确可见性撤回入口，撤回只恢复该次操作涉及对象的操作前状态。
- **保留与边界**：保留显式“全部显示”作为全局可见性恢复动作，但它不等同于撤回；不做多步撤回或 redo。模型切换或重载后，旧撤回入口失效。
- **交付影响**：这是 R1 收口前的 UX 修正。实现完成后必须重新执行相关可见性/模型生命周期回归和 R1 检查；通过后才可创建本地检查点并重新提交 R1 收口验收。在实现和回归证据完成前，不得把旧 R1 证据解释为已覆盖本修正。
- **替换关系**：替换此前设计草案中的确认与全局恢复替代撤回规范；显式“全部显示”全局恢复能力继续保留。






## 2026-08-27 — 具体实施优先委派与产品经理主线程聚焦

- **状态**：有效。
- **背景**：用户明确要求：“具体实施啊，无论大小，能往下分就往下分，你的上下文和精力要放在有价值的事情上”。需要把这一长期工作机制固化，减少日常实施噪音占用产品经理主线程。
- **决策**：具体实施无论大小，只要能形成独立、可验收的下级工作包，就默认优先委派给已有合适人员任务。产品经理主线程聚焦需求与产品决策、架构边界、冲突裁决、集成验收和用户汇报。
- **责任与边界**：委派只转移执行，不扩展权限、不转移最终责任；产品经理仍负责范围、风险、依赖、集成结果、最终验收和对用户的结论。
- **例外**：当委派成本明显高于直接执行，且无法形成有意义的独立工作包时，小型实施可留在产品经理主线程；该例外不构成新的授权。
- **人员影响**：不新增、拆分、合并或撤销人员任务，不改变现有职责、汇报关系或组织架构。

## 2026-08-27 — 长期角色对话优先于主对话临时子 Agent

- **状态**：有效。
- **背景**：用户进一步明确，项目内既有长期角色对话的职责分工，优先于产品经理主对话内部的临时小队或子 Agent 分工；需要避免临时执行机制替代项目组织或形成隐形编制。
- **决策**：产品经理拆解已批准工作后，先匹配并派发给现有 `职责-分工内容` 长期角色对话。只有没有合适角色、需要一次性新鲜独立审查、对应角色不可用或受限，或上下文隔离具有明确价值时，才使用主对话内部临时子 Agent。
- **同步与边界**：每个临时子 Agent 必须映射到现有岗位职责，必要结论、证据、风险、依赖和阻塞必须同步给对应长期角色；若确无对应角色，由产品经理接收结论并判断是否提出正式人员调整。临时子 Agent 不取得长期岗位、持续所有权或独立汇报关系。产品经理继续负责拆解、调度、冲突裁决、单一写入队列、集成验收和用户汇报。
- **写入约束**：多角色对话优先复用不改变单工作区规则；任一时刻仍只有一个实施任务拥有写入权，其他任务只能只读并行，直至产品经理明确交接。
- **人员影响**：本决策不新增、拆分、合并、撤销人员任务，不迁移职责，不改变汇报关系或组织架构，因此不触发 `ORG_CHART.md` 变更。
- **替换关系**：本决策补充并细化同日“具体实施优先委派与产品经理主线程聚焦”决策，不撤销其余内容。

## 2026-08-28 — Standard Model Package v1 形成兼容候选，待用户里程碑确认

- **状态**：有效；技术候选，未发布、未合并。
- **背景**：用户已批准 Standard Model Package v1 方案 B；双方现已完成任务分支机器实现、共同 fixture/validator、双端全门禁、真实浏览器联合验收和最终独立复核。
- **候选检查点**：Platform consumer 为 `786e3f3123d24dde264aca0536ef04f6e4fe8e07`；Studio producer 为 `02b560a`。
- **共同证据**：双仓同字节 golden ZIP SHA-256 为 `d0662cdfb95656def2d553a727ddeb88a3b946c9f2ecbefe2558fd83723423b0`，双方 SHA index 已分别验签；最终独立 Reviewer P0/P1/P2 均为 0。
- **当前结论**：Standard Model Package v1 已形成可提交用户里程碑确认的兼容候选。该结论不等于用户已确认里程碑，不构成发布批准，也不表示候选已合并或任一仓库 `main` 已兼容。
- **保留边界**：Platform 旧 v3.1 reader 保持不变；Platform 不读取 embedded topology fallback；旧 Studio building-release ZIP 继续拒绝；v1 不提供跨层 routing。
- **人员影响**：不新增、撤销或调整人员、职责和汇报关系，不触发 `ORG_CHART.md` 或 `PRODUCT_MANAGER_CHARTER.md` 变更。

## 2026-08-28 — 批准能力声明型 Standard Model Package v2 作为临时放行

- **状态**：有效；方向已批准，机器契约和双端实现尚未完成。
- **背景**：完整 topology 的 Studio authoring 与 Platform consumer 尚未形成可用于真实整栋交付的共同闭环，但需要临时交付已经完成严格几何、Metadata `3.3-semantic` 与 SPACE/语义验证的整栋标准包。
- **决策**：新增独立版本身份的能力声明型 Standard Model Package v2。v2 必须显式声明 topology `ABSENT` 语义，同时继续严格验证 GLB 几何与自包含资源、Metadata 3.3、SPACE/语义、最终发布物回读、URI、SHA-256、不可变 revision、package/asset/floor identity、唯一性和资源限制。
- **拒绝边界**：v2 不是 `*-unvalidated` 包；不接受旧 building-release ZIP、无显式身份 ZIP、v1 topology 失败降级、缺省猜测、空/伪 sidecar或 embedded topology fallback。v1 继续强制 strict sidecar topology；v1 reader/fixtures 和旧 v3.1 reader 保持不变。
- **能力边界**：Platform 对合法 v2 只开放 scene、Metadata 和其他不依赖 topology 的能力。routing、route rendering、connector、blocker、topology AI 与 Quick Action 必须投影为结构化 `TOPOLOGY_UNAVAILABLE` 产品语义，不得把正常能力缺席误报为加载失败、`NO_PATH` 或 Graph ready。
- **回滚决策**：只有 Studio authoring 与 Platform consumer 的完整 topology、共同 fixtures、真实整栋联合验收和用户里程碑批准全部满足，双方才同步停止新生产/新接收 v2。存量 v2 只读迁移，回 Studio 补 topology 后重发新的 v1 revision；最终删除 v2 reader仍需用户明确批准，任何一方不得单方回滚。
- **当前门禁**：本轮仅固化过程设计。v2 machine schema、精确字段、manifest discovery、fixtures、diagnostics 和 producer/consumer code 尚未联合冻结或实现；当前 Platform 不得宣称接受或兼容 v2。
- **记录**：过程、影响矩阵、实施工作包和待对齐机器字段见 [`STANDARD_MODEL_PACKAGE_V2_TRANSITION.md`](./STANDARD_MODEL_PACKAGE_V2_TRANSITION.md)。
- **人员影响**：不新增、撤销或迁移人员、职责和汇报关系，不触发组织架构变更。
- **替换关系**：不替换 Standard Model Package v1、Metadata v3.1/`3.3-semantic`、Studio embedded topology v1 或 Platform sidecar v1；只新增临时、显式隔离的 v2 路径。

## 新决策模板

```markdown
## YYYY-MM-DD — 决策标题

- **状态**：有效 / 已替换 / 已撤销。
- **背景**：为什么需要决定。
- **决策**：用户批准的内容。
- **影响**：范围、架构、人员、成本、风险或交付影响。
- **替换关系**：如适用，指出替换或撤销的旧决策。
```
