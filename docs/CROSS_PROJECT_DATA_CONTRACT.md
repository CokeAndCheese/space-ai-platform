# Space Model Studio ↔ Space AI Platform 跨项目数据契约

## 决策记录

- 生效日期：`2026-08-22`
- 状态：产品分离、契约治理和方案 B 已批准；双端任务分支机器实现与联合技术验收完成，形成待用户里程碑确认的兼容候选
- 生产方：Space Model Studio
- 消费方：Space AI Platform
- Studio 当前实现基线：Metadata `3.3-semantic`；GLB 内嵌 `scene.extras.sspTopology` schema v1
- Platform 当前实现基线：GLB Metadata v3.1；外置 `space-ai-platform/topology-sidecar` schema v1
- 当前兼容结论：**双端技术候选已通过共同验证，但尚未获得用户里程碑确认、尚未发布或合并，不得提前声明 `main` 已兼容**
- v2 过渡状态：用户已批准能力声明型 Standard Model Package v2 的临时方向；当前仅有过程设计，机器 schema/code/fixtures/diagnostics 尚未联合冻结或实现

本记录只固化长期产品边界、当前事实和变更门禁，不修改任何现有字段、枚举、坐标、ID、发现或绑定语义。

## 1. 产品事实

```text
Space Model Studio
  生产、校验并交付标准模型
            ↓
  用户批准的版本化数据契约
            ↓
Space AI Platform
  加载、验证并用于上层应用
```

- 两个产品保持代码库、运行时、发布节奏和内部架构分离。
- Studio 的 Domain Model、编辑器状态和 Three.js 投影不是 Platform API。
- Platform 的 SSP、Template、AI、数据库和 UI 状态不是 Studio 的生产依赖。
- 双方应共享版本化机器契约、兼容承诺、golden fixture 和 validator 预期，而不是源代码。
- Standard Model Package v1 已在双方任务分支完成机器实现和联合技术验收，满足提交用户里程碑确认的技术条件；在用户确认前，它仍是候选而不是已发布兼容承诺。
- 用户已批准以独立 v2 身份临时承载“严格几何与 Metadata 已验证、topology 明确缺席”的标准包。该批准允许进入联合设计和后续获准实施，不表示当前 Platform 已能接受 v2；过程与回滚基线见 [`STANDARD_MODEL_PACKAGE_V2_TRANSITION.md`](./STANDARD_MODEL_PACKAGE_V2_TRANSITION.md)。
- 任一方不得为快速对齐，在已发布版本名下静默改变字段、枚举、必填性、坐标、单位、ID、发现、资产绑定、connector、blocker 或摘要语义。

### Studio 内部 authoring 输入不进入共享契约

- 2026-08-26，用户批准 Studio V1「整体建筑导入」：Studio 可把单个 raw `Building.glb` 作为内部 authoring input，自动识别楼层、建立逐层只读源视图，并复用其既有 Metadata/SPACE/Topology 流程。
- raw `Building.glb`、楼层识别规则和内部拆层视图都不是 Standard Model Package、Metadata `3.3-semantic`、topology sidecar 或 Platform 输入接口。
- Platform 不扫描目录、不猜楼层、不直接读取或适配 raw `Building.glb`；本决策不产生 Platform reader、adapter、SSP、模板或 UI 研发动作。
- Studio 内部拆层不得生成未经发布契约声明的跨层 connector/路由，也不得改变 Package v1、Metadata v3.1/`3.3-semantic`、embedded topology v1 或 sidecar v1 的既有语义。
- Studio 最终产物仍须经过既有标准模型发布门禁；整体建筑 authoring input 与旧 building-release ZIP 不因 Package v1 候选而自动升级，Platform 仍拒绝缺少显式 v1 manifest identity 的旧 ZIP。
- 后续 v2 若完成联合机器契约与实现，只消费 Studio 严格验证并最终回读的显式 v2 package；Platform 仍不直接读取 raw `Building.glb`，也不把旧 building-release ZIP、`*-unvalidated` 中间产物或 v1 topology 失败自动升级为 v2。

## 2. 当前 Metadata 差异

| 契约面 | Studio `3.3-semantic` | Platform v3.1 | 兼容判断 |
|---|---|---|---|
| 版本身份 | Project 固定 `metadataSpecVersion = 3.3-semantic`；最终 GLB 未携带独立 metadata version 字段 | 消费基线名为 v3.1，当前规范未与 3.3 建立显式协商 | GLB 本身不能安全协商版本，阻断 |
| 枚举集合 | 8 renderType、7 floorType、13 spaceType、11 fireType | 文档枚举集合相同 | 表面对齐，仍需共同 validator/golden |
| scene requiredness | `floorName/floorType/name` 严格；普通楼层 `building/level` 严格，景观必须为 null | `floorName/floorType` 必填；`building/level/name` 多数为推荐 | Studio 更严格，但不是同一声明 |
| node requiredness | `sid/findId/floorName/building/level/floorType/name/renderType/renderTypeConfidence` 严格；SPACE/FACILITY 有条件字段 | `sid/findId/renderType` 与条件字段为核心；冗余楼层字段、name、confidence 多为推荐，node 表未定义 floorType | 更严格超集的可能性尚未由共同 reader 证明 |
| confidence | 必须为 `high` 或 `low` | 同值域，但为推荐 | 值域一致、必填性不同 |
| findId | `<floorName>_mesh_<实际 node index>` | 同格式 | 字符串格式一致；不能作为 topology 稳定 ID |
| SID | 方向型 DOOR/WINDOW/STAIR/ELEVATOR 必带八方向与两位序号；WALL 无方向；SPACE/FACILITY 带 subtype | 主规范与历史 A_1F 注入说明存在不同 tail/方向口径 | 不能假定与 3.3 等价 |

## 3. 当前 Topology 差异

两边的 `schemaVersion: 1` 不是同一个 schema，不能因数字相同推断兼容。

| 契约面 | Studio embedded v1 | Platform sidecar v1 | 兼容判断 |
|---|---|---|---|
| 载体 | 默认 scene 的 `extras.sspTopology` | 外置 UTF-8 JSON；GLB extras 明确不是 fallback | 直接不兼容 |
| identity | `schemaVersion: 1` | `schema: space-ai-platform/topology-sidecar` + `schemaVersion: 1` | 不同 schema identity |
| 发现 | 随 GLB scene extras 读取 | `topology.v1.json` 或 `<name>.topology.v1.json` | 不同发现规则 |
| 图范围 | `graphs[]`，当前每楼层一图 | 一个 sidecar 一张图，可绑定多个 GLB | 结构与跨层所有权不同 |
| 坐标 | `MODEL_LOCAL` | `ASSET_LOCAL`、`meter`、`Y`，加载端恰好一次 world transform | 缺 assetId/unit/upAxis/transform 对应关系 |
| 资产绑定 | topology 与同一 GLB 一体；没有 sidecar `assets[]` | URI + SHA-256 digest 或可信 revision，与 loaded root/generation/AssetProof 强绑定 | 不同绑定模型 |
| via | 裸 `{x,y,z}` | 每个 via 必带 `assetId + position` | 不兼容 |
| connector | node 可带 `connectorId` | 顶层 `connectors[]` 是唯一真源，显式 nodeIds/edgeIds | 不兼容 |
| blocker | edge `initialState.blockerIds` | 顶层 `blockers[]` 是唯一真源 | 不兼容 |
| 容量与稳定性 | embedded validator 有图结构、ID 和几何门禁 | sidecar 另有文本、实体、字符串和 JSON 深度上限 | 约束集合不同 |

## 4. 兼容候选确认前的发布冻结

Standard Model Package v1 已完成双端技术验收，但在用户确认兼容里程碑前：

1. Studio legacy 路径继续按 `3.3-semantic + embedded sspTopology v1` 工作；Package v1 只由显式 package identity 选择。
2. Platform 旧入口继续按 `v3.1 + topology sidecar v1` fail closed，旧 reader 的接受/拒绝结果不变。
3. 双端任务分支候选不得标注为已发布、已合并或 `main` 已兼容。
4. 不允许把 embedded topology 改名或复制后冒充 sidecar v1。
5. 不允许把 Studio 输出静默降级为 v3.1，也不允许 Platform 猜测 3.3。
6. Platform R1 的内部适配和浏览器验收仍有效，但不构成 Studio → Platform 端到端兼容证据。
7. 用户确认前继续阻断跨项目兼容发布声明，不要求任一方回滚已通过技术验收的任务分支实现。

## 5. 变更门禁

任何共享契约变更必须：

1. 形成跨项目变更请求，说明用户价值和机器可观察差异。
2. 同时评估 Studio 生产、存量模型、迁移工具与发布成本。
3. 同时评估 Platform reader、适配层、上层应用和安全影响。
4. 判断 backward compatible 或 breaking；破坏性变化必须使用新版本或新 schema identity。
5. 先建立双方内容相同的 golden success/failure fixtures、兼容矩阵和 validator 预期。
6. 明确 dual-read/dual-write 或一次性 cutover、存量资产迁移、失败回滚触发和恢复路径。
7. 获得用户批准后，双方在各自仓库实现并交叉验证。
8. 两端尚未同步实现和通过验证前，不宣布新版本可交付。

## 6. 已批准的迁移方案

### 方案 B：新增 Standard Model Package v1

用户于 2026-08-22 批准方案 B。联合设计基线见 [`STANDARD_MODEL_PACKAGE_V1.md`](./STANDARD_MODEL_PACKAGE_V1.md)。实施边界为：

- 新增独立 `space-model-package` schema v1，以 manifest 显式声明 Metadata `3.3-semantic`、GLB/sidecar SHA-256、不可变 revision、资产与楼层身份。
- Studio 保留 embedded topology 供本端回开，并从同一 Domain topology 额外编译严格符合 Platform sidecar v1 的正式 sidecar。
- Platform 保留旧 v3.1 reader，并新增 package v1 + 3.3 的显式 reader/validator；Platform 仍只消费 sidecar，不读取 embedded topology 作为 fallback。
- 已冻结的四个既有契约均不就地修改；若 sidecar v1 无法承载未来语义，则另发 v2。
- 两端共同 fixture/validator、exporter/reader、交叉验证与浏览器验收均已完成；用户里程碑确认前不宣布兼容发布。

2026-08-22，两个项目总控已逐项确认 package identity、manifest 字段、URI/摘要、版本与资源限制、Metadata dual-read、embedded→sidecar 映射、diagnostics、fixture 权威索引和非规范审计附件，没有遗留设计分歧。2026-08-28，双方任务分支已完成机器实现、共同 fixture/validator、交叉验证、真实浏览器联合验收与独立复核；下一门禁是用户兼容里程碑确认。

### 6.1 当前候选证据

- Platform consumer 检查点：`786e3f3123d24dde264aca0536ef04f6e4fe8e07`（`codex/r2-standard-model-package`）。
- Studio producer 检查点：`02b560a`（Studio 对应任务分支）。
- 双仓同字节 golden ZIP SHA-256：`d0662cdfb95656def2d553a727ddeb88a3b946c9f2ecbefe2558fd83723423b0`；SHA index 已由两端分别验签。
- 两端全门禁与真实浏览器联合验收通过；最终独立 Reviewer 结论为 P0/P1/P2 均为 0。
- 候选保持 Platform 旧 v3.1 reader 不变，不读取 embedded topology fallback，拒绝旧 Studio building-release ZIP；Standard Model Package v1 不提供跨层 routing。

### 6.2 临时方案：能力声明型 Standard Model Package v2

用户于 2026-08-28 批准 v2 临时方向，详细过程设计见 [`STANDARD_MODEL_PACKAGE_V2_TRANSITION.md`](./STANDARD_MODEL_PACKAGE_V2_TRANSITION.md)。长期边界为：

- v1 继续强制 strict sidecar topology；v1 reader/fixtures 与旧 v3.1 reader 不变。
- v2 以新版本身份显式声明 topology `ABSENT` 语义；不得缺省猜测、使用空/伪 sidecar或读取 embedded topology fallback。
- v2 不是 unvalidated package。GLB 几何、Metadata `3.3-semantic`、SPACE/语义、最终发布物回读、URI、SHA-256、revision、identity 与资源限制仍须由 Studio 和 Platform 分别严格验证。
- Platform 只开放 scene、Metadata 和其他不依赖 topology 的能力；routing/rendering/connector/blocker/topology AI/Quick Action 以结构化 `TOPOLOGY_UNAVAILABLE` 产品语义关闭，不得误报包加载失败或 Graph ready。
- 当前只完成批准方向和过程计划；machine schema、字段拼写、manifest 发现、fixtures、diagnostics 与双端代码均未冻结或实现，因此不得宣布 v2 已可交付或 Platform 已兼容。
- v2 退出必须由完整 topology 的 Studio authoring、Platform consumer、共同 fixtures、真实整栋验收和用户里程碑批准共同触发。双方同步停止新生产/新接收，存量只读迁移回 Studio 补 topology 后重发 v1；最终删除 v2 reader 仍需用户批准，不得单方回滚。

### 未采用方案

- 方案 A「长期冻结隔离」未采用；仅作为双端实现完成前的临时运行状态。
- 方案 C「Platform 直接消费 3.3 + embedded topology」未采用；Platform 不新增 embedded fallback。

## 7. 双方责任

- Space Model Studio 对生产端符合性、版本声明、发布物回读和资产完整性负责。
- Space AI Platform 对消费端 fail-closed、兼容 reader、SSP 外适配和上层应用影响负责。
- 两个项目的技术负责人共同维护契约变更门禁。
- Studio 的模型数据工程师与 Platform 的空间数据工程师共同维护 golden fixture、兼容矩阵和双端 validator 预期。
- 用户决定重大或破坏性契约方向；任何项目经理不得把未决方案表述为已批准。

## 8. 决策日志

| 日期 | 决策 | 状态 | 人员影响 |
|---|---|---|---|
| 2026-08-22 | Studio 为标准模型生产端，Platform 为上层应用消费端；产品、代码和运行时分离，只通过版本化数据契约连接 | 已批准 | 无新增编制 |
| 2026-08-22 | 破坏性变化必须新版本；双端影响、共同 golden/validator、迁移、回滚和用户批准成为强制门禁 | 已批准 | 两端现有技术/数据岗位增加协同职责 |
| 2026-08-22 | 采用方案 B，新增 Standard Model Package v1；Studio dual-write，Platform dual-read，保留四个既有契约 | 已批准 | 无新增编制；现有岗位承担联合实现 |
| 2026-08-26 | Studio V1「整体建筑导入」属于 Studio 内部 authoring input profile；raw `Building.glb` 不进入 Platform 或共享发布契约 | 已批准 | Platform 无研发动作、无人员变动 |
| 2026-08-28 | 双端任务分支机器实现和联合技术验收完成，形成待用户里程碑确认的 Standard Model Package v1 兼容候选 | 技术候选；未发布、未合并 | 无人员变动 |
| 2026-08-28 | 新增能力声明型 Standard Model Package v2 作为 topology 明确缺席时的临时严格标准包；v1 与 legacy reader 不变 | 方向已批准；机器契约与实现待完成 | 无人员变动 |
