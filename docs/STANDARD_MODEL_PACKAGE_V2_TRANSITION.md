# Standard Model Package v2 — 能力声明型临时过渡方案

> 日期：2026-08-28
>
> 状态：用户已批准采用能力声明型 Standard Model Package v2 作为临时放行方向；本文仅固化过程设计与实施计划
>
> 当前门禁：机器 schema、字段拼写、manifest 发现规则、fixtures、diagnostics 和双端代码尚未联合冻结或实现，Platform 当前不得宣称已经接受 v2
>
> 临时性：v2 只服务于“严格几何与 Metadata 已完成、Topology 明确缺席”的过渡交付，不替代完整 topology 的长期目标
>
> 生产方：Space Model Studio
>
> 消费方：Space AI Platform

## 1. 已批准决策与目标

用户批准新增能力声明型 Standard Model Package v2，使 Studio 能在完整 topology 尚未共同就绪期间，交付经过严格验证的整栋几何与 Metadata 包，由 Platform 显式识别其能力边界并复用不依赖 topology 的现有功能。

这不是对 Standard Model Package v1 的放宽，也不是把中间产物改名为标准包：

- v1 继续要求 manifest 指向严格 Platform topology sidecar v1，并完成摘要、预绑定、AssetProof、编译和 graph 原子提交；
- v1 reader、共同 fixtures、旧 Platform Metadata v3.1 reader 及其接受/拒绝结果保持不变；
- v2 必须是完成严格生产校验和发布回读的标准包，不能承载 Studio `*-unvalidated` 中间产物；
- v2 只能通过新的显式版本身份与能力声明被选择，不能由 v1 缺字段、sidecar 失败、basename、目录扫描或内容形状猜测得到；
- v2 的 topology 能力明确为 `ABSENT` 语义，不允许缺省、不允许空或伪 sidecar，也不读取 GLB embedded topology 作为 fallback。

本文中的大写能力语义用于描述已批准行为方向。除 `TOPOLOGY_UNAVAILABLE` 的产品语义外，任何示例名称都不是已冻结的 JSON 字段、枚举值或 diagnostic code；精确机器表达必须由 Studio 与 Platform 后续联合冻结。

## 2. 冻结边界与非目标

### 2.1 保持不变

- Standard Model Package v1 仍是 `3.3-semantic GLB + strict sidecar v1 + graph` 的完整 topology package；v2 不修改 v1 manifest、sidecar、fixtures 或 diagnostics。
- Platform 旧 v3.1 + 外置 sidecar v1 链路保持原样。
- Studio legacy embedded topology 与 Platform external sidecar 仍是不同 schema；Platform 不消费 embedded topology fallback。
- `src/ssp/**`、SSP–Template–AI 窄腰、Topology core 和已有注册模板契约不因 v2 改写。
- 旧 Studio building-release ZIP、无显式 Standard Package 身份的 ZIP、普通 GLB 和 `*-unvalidated` 产物继续拒绝进入 v2。

### 2.2 v2 仍须严格验证

v2 仅免除 topology 数据本身，不免除标准模型质量或资源安全。生产端与消费端仍须严格处理：

- 每个 GLB 的几何结构、自包含资源和最终可加载性；
- Metadata `3.3-semantic` 的 scene/node 必填字段、floor identity、稳定 SID/findId、SPACE 及其他条件语义；
- Studio 导出后对最终 ZIP 精确字节的重新打开、重新解析和完整校验；
- manifest/package identity、显式 URI、canonical URI、SHA-256、不可变 revision、asset identity、楼层身份、唯一性和资源预算；
- ZIP 路径、条目、压缩、大小、重复/碰撞、同源和去敏诊断门禁；
- Platform 对实际消费字节的独立摘要与 Metadata 校验，不信任 basename 或非规范审计附件代替验证。

### 2.3 非目标

- 不从几何、Metadata、名称、SID、SPACE、楼层关系或行业语义推断 topology。
- 不创建空 graph、占位 node/edge、伪 connector/blocker 或用于通过 v1 reader 的空 sidecar。
- 不提供 routing、route rendering、connector、blocker、topology Quick Action 或 topology AI 能力。
- 不在本轮确定完整 topology 的作者工具、跨层路由语义或永久包格式。
- 不把 v2 描述为 v1 的超集、替代品或长期唯一标准。

## 3. 目标处理链路

目标 v2 链路必须保持显式、原子和 fail-closed：

```text
显式选择 v2 package identity
→ 验证封闭 manifest、版本与明确的 topology ABSENT 能力声明
→ 验证 ZIP、URI、identity、revision、资源预算和每个资源 SHA-256
→ 验证每个 GLB 自包含、几何结构与 Metadata 3.3/SPACE 语义
→ 使用已验证的同一资源字节加载全部 GLB并建立资源级可信证明
→ 所有资产成功后原子发布 Scene/Metadata ready 会话
→ graphId 保持为空，Topology 能力投影为结构化 TOPOLOGY_UNAVAILABLE
```

任一非 topology 校验或资产加载失败都使整个 v2 package 导入失败并清理部分资源。只有被 v2 明确声明且通过机器校验的 topology 缺席，才是正常的能力不可用状态。

## 4. 接受与拒绝矩阵

下表描述目标行为；在 v2 机器契约和代码完成前，当前 Platform 仍不接受任何 v2 包。

| 输入/状态 | 目标 reader | 目标结果 | 当前状态 |
|---|---|---|---|
| 合法 v1 manifest + strict sidecar v1 | v1 | 按冻结 v1 完整校验、建图并 Graph ready | 已有候选实现，不变 |
| 合法 v2 身份 + topology 明确 `ABSENT` + 全部几何/Metadata/资源门禁通过 | v2 | Scene/Metadata ready；Topology 结构化不可用 | 已批准方向；尚未实现，当前拒绝 |
| v2 缺少 topology 能力声明或声明未知值 | v2 | fail closed，不加载或发布部分会话 | 待冻结 fixture/diagnostic |
| v2 使用空、伪造或占位 sidecar 表示“无 topology” | v2 | 拒绝 | 待冻结 fixture/diagnostic |
| v2 试图以 embedded topology 满足 Platform topology | v2 | 拒绝 fallback；不得产生 graph | 待联合确定 embedded 内容本身是禁止还是仅忽略 |
| v1 manifest 缺 topology，或 v1 sidecar 缺失/非法 | v1 | 保持 v1 fail closed；不得降级为 v2 | 现有行为不变 |
| GLB 几何、Metadata 3.3、SPACE/语义或自包含门禁失败 | v2 | 拒绝整个包 | 待实现；不得视为 topology 缺席 |
| URI、SHA-256、revision、identity、唯一性或资源预算失败 | v2 | 拒绝整个包 | 待实现；沿用严格原则 |
| Studio `*-unvalidated` GLB/ZIP | producer/v2 | Producer 不得发布；Platform 不以文件名替代验证且不提供特殊放行 | 明确拒绝标准交付 |
| 旧 building-release ZIP 或无显式 package identity 的 ZIP | v1/v2 | 拒绝，不猜版本 | 现有旧 ZIP 拒绝边界不变 |
| 未知 package 版本、未知字段或同时携带冲突 manifest identity | discovery | fail closed | 待联合冻结 v2 发现与冲突规则 |

## 5. Producer 与 Consumer 影响

### 5.1 Space Model Studio producer

Studio 后续实现至少需要：

1. 独立的 v2 显式导出入口，不能把 v1 导出失败自动改写为 v2。
2. 在导出前完成几何、Metadata `3.3-semantic`、SPACE/语义、自包含资源和 identity 校验。
3. 生成确定性 ZIP 后，对最终 ZIP 精确字节重新打开并重复执行 manifest、URI、摘要、revision、GLB 和资源限制校验。
4. 只有产品流程明确选择临时 v2、且 topology 缺席原因符合批准范围时，才生成 v2；`*-unvalidated` 中间态不得进入 exporter。
5. 明确 v2 的临时 provenance、revision 与未来回 Studio 补 topology 重发 v1 的可追踪关系。
6. 在共同回滚触发后同步停止生产新的 v2 revision，并为存量 v2 提供回开、补 topology 和重发 v1 的迁移路径。

### 5.2 Space AI Platform consumer

Platform 后续实现至少需要：

1. 新增只由显式 v2 identity 选择的独立 adapter/reader；不得修改或复用 v1 失败分支作为 v2 fallback。
2. 尽量复用已经过验证的 ZIP、URI、SHA-256、Metadata 3.3 和资源预算基础能力，但保持 v1 接受/拒绝结果逐字节不变。
3. 建立不依赖 topology 的 package asset/session 生命周期，保持模型加载登记、缓存 lease、迟到请求取消、原子发布和严格清理。
4. 向 UI、Template Runtime 和 AI capability 投影明确的 topology 不可用状态；不得伪造 graphId、nodes 或 Graph ready。
5. 保留 SSP–Template–AI 窄腰。非 topology AI 能力仍只能经过既有 Registry/Template Runtime；topology AI 不得绕过能力门禁直接调用 SSP。
6. 在共同回滚触发后同步停止接受新的 v2 revision；存量 v2 仅以只读迁移模式保留，直到用户批准删除 reader。

## 6. AssetProof 与 Lifecycle 设计边界

### 6.1 资源证明

v1 的 `TopologyAssetProof` 证明 sidecar 声明的资产与实际已加载 GLB 的 canonical URI、root、selection generation、digest/revision 强绑定。v2 没有 sidecar，因此：

- 仍须为每个已加载 GLB 保留资源级证明：精确消费字节的 SHA-256、canonical URI、不可变 revision、实际 root 和当前 selection generation；
- 该证明用于 package 资源完整性、模型会话和后续无 topology 功能，不能声称已经证明 sidecar 或 graph；
- 设计时优先抽象 SSP 外的通用 package resource proof，再由 v1 topology binding 适配使用；不得通过伪造 sidecar asset 来复用现有编译器；
- loader 私有 transport URL 不得泄露成 package canonical identity，且临时缓存 lease 必须在加载完成后撤销。

以上是类型与职责边界，不是已批准的 TypeScript 接口名称。

### 6.2 生命周期与会话状态

v2 生命周期应保持以下不变量：

- 新选择开始时失效旧 generation，并按既有顺序清理 routes、graphs、legacy topology 和 models；
- manifest、全部资源摘要、Metadata 和 topology capability 声明在任何模型加载前完成校验；
- 多资产加载必须全部成功才能发布会话，任一失败清理全部已加载根和登记；
- 模型切换、重载、文件读取迟到和 loader 迟到结果不得覆盖当前会话；
- v2 成功态是 Scene/Metadata ready，而不是现有 topology `ready + graphId + nodes` 的同义词；
- v2 会话必须携带明确能力投影，`graphId` 为空、topology nodes 为空，且不会调用 sidecar compiler 或 `createGraph`；
- 从 v1 切换到 v2 时仍须清除旧 route/graph；从 v2 卸载或切换时仍须清理全部模型资源。

具体 session 类型、状态枚举和 UI 文案尚未冻结。实现不得简单复用当前 Graph-ready 状态后再把 `graphId` 留空。

## 7. 功能能力矩阵

| Platform 功能面 | v1 strict topology | v2 topology `ABSENT` | v2 要求 |
|---|---|---|---|
| Three.js scene 加载、观察与基础交互 | 可用 | 可用 | 全部资产原子加载成功 |
| Metadata 3.3、楼层与 SPACE/语义读取 | 可用 | 可用 | 仅使用已验证显式数据，不推断 topology |
| 不依赖 graph 的对象查询、可见性与高亮 | 可用 | 可用 | 继续经过既有 SSP/Template 权限边界 |
| Package assetId/floor 映射 | 可用 | 可用 | 来自已验证 manifest 与 GLB identity |
| Topology graph 与 nodes | 可用 | 不可用 | 不创建空 graph，不发布 Graph ready |
| findPath / routing | 可用 | 不可用 | 返回结构化 `TOPOLOGY_UNAVAILABLE` 语义 |
| renderRoute / removeRoute | 可用 | 不可用 | 不尝试渲染；不得把缺 graph 当 loader 故障 |
| connector / blocker | 可用 | 不可用 | 不从 Metadata/SPACE 推断 |
| Topology Quick Action | 可用 | 禁用 | UI 明示能力不可用；不得出现可执行入口 |
| Topology AI / Planner 能力 | 仅受控模板可用 | 不向 AI 暴露 | 不允许 raw SSP fallback |
| 非 topology AI/Template 能力 | 按现有 catalog | 按现有 catalog | 仅在其前置条件不依赖 graph 时开放 |

## 8. 错误、能力不可用与降级语义

### 8.1 正常能力不可用

当且仅当 v2 manifest 以未来冻结的机器字段明确声明 topology `ABSENT`，且其他所有验证与加载成功时：

- package 导入成功并进入 Scene/Metadata ready；
- topology 相关查询、模板和 UI 返回或显示结构化 `TOPOLOGY_UNAVAILABLE` 产品语义；
- 该状态不是加载失败、sidecar 404、graph commit failure 或 `NO_PATH`；
- `NO_PATH` 仍只表示一张合法 graph 中没有满足约束的路径，不能用于表达 topology 缺席；
- exact diagnostic code、phase、path、result envelope 和 UI 文案须由双方后续冻结。

### 8.2 必须失败的情况

以下情况不得降级为 Scene/Metadata ready：

- 未声明 topology capability、声明未知/冲突值或试图按缺字段猜 `ABSENT`；
- v1 topology 缺失、摘要错误、sidecar 无效或资产绑定失败；
- v2 几何、Metadata、SPACE/语义、URI、digest、revision、identity、resource budget 或资产加载失败；
- 使用空/伪 sidecar、embedded topology、basename 或 `producer-validation.json` 冒充 v2 能力证明；
- 未知 schema/version、冲突 manifest、重复资源或部分加载。

错误 envelope 必须去敏，不能暴露 loader transport URL、凭据、查询参数、原始异常或本地路径。

## 9. 兼容、迁移与共同回滚

### 9.1 并存期

- v1、v2 和旧 v3.1 reader 必须由显式 identity/入口分派；禁止相互猜测或在失败后自动重试另一 reader。
- v1 revision 继续绑定完整 GLB + sidecar；v2 revision 绑定完整 GLB + manifest 能力状态。两种 revision 都不可局部替换资源。
- v2 不自动升级或降级 v1，也不把旧 building-release ZIP 包装为 v2。
- 存量 v2 必须可追踪回 Studio authoring source，以便补 topology 后重新发布新的完整 v1 revision。

### 9.2 共同回滚触发

只有以下条件同时满足，才能启动 v2 退出：

1. Studio authoring 已能稳定产出完整、严格 topology；
2. Platform consumer 已能完整消费对应 topology；
3. 双方内容相同的完整 topology 共同 fixtures 与 validators 全部通过；
4. Studio→Platform 真实整栋包联合验收通过，覆盖加载、graph、routing、资源回收和失败路径；
5. 用户批准完整 topology 里程碑及 v2 退出窗口。

### 9.3 协同退出流程

触发后双方必须按同一已批准切点执行，不得单方回滚：

1. Studio 停止生产新的 v2 package/revision；Platform 同步停止接受新的 v2 package/revision。
2. 冻结并盘点存量 v2 revision、来源、使用方和迁移状态；不得继续修改原 revision。
3. 存量 v2 进入只读迁移期，Platform 只为迁移保留读取能力，不再扩大功能或新建依赖。
4. 每个存量包回到 Studio 补齐严格 topology，通过完整 producer 门禁后以新的 v1 revision 重发。
5. Platform 用冻结 v1 reader 验证并接收新 v1，确认 Scene/Metadata 与 topology 功能及回滚证据。
6. 所有存量迁移完成并经双方验收后，提出删除 v2 reader 的独立变更；最终删除仍须用户明确批准。

任一触发条件或迁移证据不满足时，不得单方停止另一端仍依赖的能力，也不得用修改 v1、伪 sidecar或清理存量数据代替协调回滚。

## 10. 共同 Fixtures 与 Diagnostics 计划

### 10.1 必需成功 fixtures

- 最小单资产 v2：严格几何、Metadata 3.3/SPACE、显式 topology `ABSENT`。
- 真实整栋多楼层 v2：多 GLB、唯一 asset/floor identity、全部 SHA-256 和最终回读通过。
- 与 v1 同一合法 GLB 资源的对照 fixture：证明 v2 只改变声明能力，不放宽几何/Metadata validator。
- Scene/Metadata ready 的浏览器 fixture：模型可见、无 graph、所有 topology 入口稳定返回不可用。

### 10.2 必需失败 fixtures

- capability 缺失、未知、冲突或非法大小写/类型；
- v1 缺 topology 不得被 v2 reader 接管；
- 空/伪 sidecar、embedded-only topology、冲突 manifest identity；
- GLB 几何、Metadata、SPACE/语义、自包含和最终回读失败；
- asset/URI/digest/revision/floor identity 不一致、重复 canonical URI、未知 ZIP entry 与资源超限；
- 旧 building-release ZIP、无 manifest ZIP 和 Studio producer 未通过验证的中间产物；
- 多资产中途失败、A→B 迟到、清理失败和部分场景污染；
- v2 会话错误发布 graphId、nodes、Graph ready 或启用 topology Quick Action/AI。

### 10.3 Diagnostics 待冻结面

- v2 identity/schema/version 不支持；
- topology capability 声明缺失、未知或冲突；
- `TOPOLOGY_UNAVAILABLE` 的正常结果 envelope；
- 资源、Metadata、加载、生命周期与 stale failure 的 code/phase/path；
- UI 与 Template Runtime 对“能力不可用”“无路”“包加载失败”的稳定区分；
- 去敏 envelope 与双方 fixture 中的精确预期。

当前不得复用任意现有 code 并宣称已经冻结 v2 diagnostics。

## 11. 分阶段工作包

### Phase 0 — 联合机器契约对齐

- 两端产品经理和技术负责人确认 v2 临时范围、退出触发和不变边界。
- 冻结 machine identity、manifest discovery、capability 表达、closed schema、diagnostics 和版本协商。
- 先形成内容相同的 success/failure fixture 规范与 SHA index 规则。

停止条件：所有待对齐机器字段关闭，且明确记录用户已批准范围内的最终联合设计。

### Phase 1 — Studio producer

- 实现显式 v2 exporter、严格 preflight、确定性 ZIP 和最终发布物回读。
- 保证 `*-unvalidated` 不进入 v2 exporter；记录 v2→Studio source→未来 v1 revision 的迁移映射。
- 产出权威 golden ZIP、failure vectors、validator 结果和 SHA index。

停止条件：Studio 独立 producer gates 全部通过，尚不宣称 Platform 已兼容。

### Phase 2 — Platform consumer

- 新增 SSP 外 v2 reader、资源证明、asset session、能力投影和 UI/Template/AI 门禁。
- 保持 v1 fixtures、旧 v3.1 reader、`src/ssp/**` 和既有接受/拒绝结果不变。
- 完成 package/Metadata/lifecycle/capability/非污染专项测试。

停止条件：Platform consumer gates 与 v1/legacy 回归通过，尚不宣称双端交付完成。

### Phase 3 — 双端联合验收

- 双方交换同字节 fixtures 并分别验签 SHA index。
- 使用真实 Studio 整栋 ZIP 完成 Platform 浏览器验收，覆盖 Scene/Metadata ready、Topology unavailable、切换/卸载和失败路径。
- 技术负责人完成架构边界复核，QA 完成独立验收，产品经理完成范围和证据收口。

停止条件：P0/P1 清零、遗留风险明确，并提交用户临时兼容里程碑确认。

### Phase 4 — 临时放行与退出准备

- 只有用户确认里程碑后，才按获准范围启用 v2 生产与消费。
- 建立 v2 revision 台账、使用方、迁移责任和共同退出监控。
- 持续推进完整 topology authoring/consumer/fixtures，不在 v2 上扩张 topology 替代能力。

停止条件：满足第 9.2 节共同回滚触发，转入协同退出流程。

## 12. 待 Studio 联合对齐的机器字段

以下均为必须关闭的问题，不是已冻结字段：

1. v2 的精确 `schema` 字符串、整数版本、固定 manifest basename 与 ZIP 根发现规则。
2. topology capability 所在对象、字段名、枚举精确拼写，以及是否只允许唯一 `ABSENT` 值。
3. v2 是否完全禁止 topology entry；未知或冲突 entry 的 diagnostic 与 JSON Pointer。
4. GLB 内存在 embedded topology 时，是 producer 禁止输出还是允许保留但 consumer 必须忽略；初始安全建议为禁止产生声明歧义。
5. v1 的 assets、metadata、floor、URI、digest、revision 和资源预算字段哪些逐字复用，哪些必须在 v2 schema 中重新声明。
6. 多楼层/整栋 package identity、revision 与 asset/floor identity 的稳定性和唯一性规则。
7. producer 最终回读证据是仅由强制 producer gate 保证，还是还需要规范化的发布证明；任何审计附件是否继续保持非规范。
8. v2 reader 的显式选择入口、v1/v2 同时存在时的冲突处理和未知版本 fail-closed 行为。
9. Platform package asset session、capability projection、Scene/Metadata ready 与 graph-ready 的精确类型和状态机。
10. `TOPOLOGY_UNAVAILABLE` 的 code/result envelope、phase/path、UI 文案、Template/AI 错误投影与去敏字段。
11. 共同 fixture 文件名、golden ZIP、failure vectors、SHA index schema 和权威维护方。
12. 新生产/新接收 v2 的共同停止切点、revision 判定方式、存量只读迁移标志和 reader 删除门禁。

这些问题由双方联合设计关闭后，必须先更新共同契约和 fixtures，再进入机器实现；不得由任一仓库单方用代码事实反向定义共享契约。

## 13. 当前结论

- 用户已批准 v2 临时方向，允许进入联合设计和后续获准实施流程。
- 本文只建立过程、边界、风险、验证和回滚计划，不是 machine-readable contract。
- 当前 Platform 没有 v2 reader，不得接受或宣称兼容 v2。
- v1 strict topology 候选结论、v1 fixtures、旧 v3.1 reader 与旧 ZIP 拒绝边界均保持不变。
- 本决策无新增、撤销或职责迁移，不改变组织架构。
