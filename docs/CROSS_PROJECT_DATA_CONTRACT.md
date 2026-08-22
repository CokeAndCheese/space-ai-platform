# Space Model Studio ↔ Space AI Platform 跨项目数据契约

## 决策记录

- 生效日期：`2026-08-22`
- 状态：产品分离与契约治理原则已批准；具体契约收敛方案待用户决策
- 生产方：Space Model Studio
- 消费方：Space AI Platform
- Studio 当前实现基线：Metadata `3.3-semantic`；GLB 内嵌 `scene.extras.sspTopology` schema v1
- Platform 当前实现基线：GLB Metadata v3.1；外置 `space-ai-platform/topology-sidecar` schema v1
- 当前兼容结论：**未对齐，不得声明为可直接互操作的同一机器契约**

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
- 当前双端实现尚未对齐；用户所要求的“同一套数据契约连接”是必须完成的目标架构，不是已经满足的现状。
- 任一方不得为快速对齐，在已发布版本名下静默改变字段、枚举、必填性、坐标、单位、ID、发现、资产绑定、connector、blocker 或摘要语义。

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

## 4. 当前发布冻结

在用户批准契约收敛方案前：

1. Studio 继续按 `3.3-semantic + embedded sspTopology v1` 实现和验证自身发布物。
2. Platform 继续按 `v3.1 + topology sidecar v1` fail closed。
3. Studio 当前发布物不得标注为已经通过 Platform 冻结基线的兼容交付。
4. 不允许把 embedded topology 改名或复制后冒充 sidecar v1。
5. 不允许把 Studio 输出静默降级为 v3.1，也不允许 Platform 猜测 3.3。
6. Platform R1 的内部适配和浏览器验收仍有效，但不构成 Studio → Platform 端到端兼容证据。
7. 当前差异阻断跨项目兼容发布声明，不要求任一方回滚已冻结的内部里程碑实现。

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

## 6. 待用户决策的迁移方案

### 方案 A：冻结隔离

Studio 保持 `3.3-semantic + embedded v1`，Platform 保持 `v3.1 + sidecar v1`，不做跨端投产。

- 优点：零静默变更，风险最低。
- 缺点：违背“两个产品由同一数据契约连接”的目标状态，只能作为临时冻结。

### 方案 B：新增标准模型包契约（建议）

定义新的版本化 package contract，至少声明 metadata contract identity、最终 GLB SHA-256/revision、topology 载体与 schema、资产绑定和兼容矩阵。过渡期可以：

- 保留 Studio embedded topology 供 Studio 回开。
- 由同一 Domain topology 额外编译严格符合 Platform sidecar v1 的正式 sidecar，Platform 继续只消费 sidecar。
- Platform 新增对 Studio `3.3-semantic` 的显式 reader/validator 支持，同时保留旧 v3.1 reader，不把 3.3 伪装成 v3.1。
- 若完全遵循现有 Platform sidecar v1，则不得改变其 schema identity、`ASSET_LOCAL`、assets/connectors/blockers 或发现语义。
- 如果这些规则不适合 Studio，则发布 sidecar v2，而不是修改 v1。
- metadata 明确选择新的联合版本或显式支持 3.3，不能把 3.3 标成 v3.1。

优点是把“标准模型包”设为真正跨项目窄腰，可双发、回滚和逐步迁移；缺点是需要 package manifest/exporter、共享 fixtures、双端 validators 和迁移测试。

### 方案 C：Platform 新增独立 3.3/embedded adapter

Platform 以新的显式 reader 支持 Studio `3.3-semantic` 和 embedded topology；旧 v3.1/sidecar reader 保持不变。

- 优点：Studio 输出变化较少。
- 缺点：Platform 必须接受新的载体、资产绑定与坐标安全模型；不能复用 sidecar v1 名称掩盖差异。

产品经理建议优先选择方案 B。它最符合产品分离和共享窄腰原则，也不会就地篡改任一已发布版本。

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
| 2026-08-22 | Studio `3.3-semantic + embedded v1` 与 Platform `v3.1 + sidecar v1` 如何收敛 | 待用户决策 | 取决于方案 |
