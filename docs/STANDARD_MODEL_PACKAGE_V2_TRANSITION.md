# Standard Model Package v2 — 能力声明型临时过渡方案

> 日期：2026-08-28
>
> 状态：用户已批准能力声明型 Standard Model Package v2 的 P0 精确机器值、补充决策及 2026-09-01 TOWER/ROOF nullable-level 兼容修正；Platform 实现、权威 fixture 同字节镜像与独立验签已完成，新的联合真实浏览器验收和用户兼容里程碑仍待完成
>
> 当前门禁：候选尚未合入 Platform local `main`、尚未发布，也未获得临时兼容里程碑批准；不得把任务分支候选表述为已交付能力
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
- 除 2026-09-01 经用户批准、在 v1/v2 同步应用的 TOWER/ROOF nullable-level 显式接受值域外，v1 topology/identity、既有 fixture 结果和旧 Platform Metadata v3.1 reader 的接受/拒绝结果保持不变；修正后的共同 fixture 已由 Studio 提供，并在 Platform `35161cc` 完成同字节镜像与独立验签；
- v2 必须是完成严格生产校验和发布回读的标准包，不能承载 Studio `*-unvalidated` 中间产物；
- v2 只能通过新的显式版本身份与能力声明被选择，不能由 v1 缺字段、sidecar 失败、basename、目录扫描或内容形状猜测得到；
- v2 的 topology 能力明确为 `ABSENT` 语义，不允许缺省、不允许空或伪 sidecar，也不读取 GLB embedded topology 作为 fallback。

P0 机器表达已经冻结：`schema = "space-model-package"`、`schemaVersion = 2`、manifest basename 为 `space-model-package.v2.json`、`profile = "TOPOLOGY_ABSENT_TRANSITION"`；封闭 `capabilities` 仅接受 `scene.status = AVAILABLE`、`metadata.status = AVAILABLE`、`space.status = AVAILABLE`、`space.completion = CONFIRMED`、`topology.status = ABSENT`。正常 topology 缺席结果固定为 `TOPOLOGY_UNAVAILABLE / PACKAGE_DECLARED_ABSENT`。这些值只属于临时 v2，不改变 v1。

## 2. 冻结边界与非目标

### 2.1 保持不变

- Standard Model Package v1 仍是 `3.3-semantic GLB + strict sidecar v1 + graph` 的完整 topology package；除用户批准并由 v1/v2 共同采用的 nullable 特殊层条件矩阵外，v2 不修改 v1 manifest、sidecar、既有 fixture 结果或 diagnostics。
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

2026-09-01 获批的 floor identity 条件矩阵只修正特殊层的可空值域，不降低 requiredness：

| `floorType` | `building` | `level` |
|---|---|---|
| `TOWER` / `ROOF` | 键必须存在且为非空字符串 | 键必须存在；允许 `null` 或既有有限整数 |
| `FLOOR` / `BASEMENT` / `FACILITY` | 键必须存在且为非空字符串 | 必须为有限整数 |
| `LANDSCAPE_TERRAIN` / `LANDSCAPE_FACADE` | 必须为 `null` | 必须为 `null` |

`A_T` / `TOWER` / `null` 与 `A_RF` / `ROOF` / `null` 是当前特殊层候选。既有整数 TOWER/ROOF 继续兼容，但其整数不得被解释为 Platform 从 elevation、文件名或楼层顺序推导的值。Manifest、默认 scene 与所有 mesh node 必须对 `floorName/building/level/floorType` 完全一致；不新增 schema/version/elevation/order/topology 字段，也不定义隐式排序。

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

下表描述已冻结的候选行为。当前实现只存在于 Platform 任务分支，未合入 local `main`、未发布；“候选接受”不等于已交付接受。

| 输入/状态 | 目标 reader | 目标结果 | 当前状态 |
|---|---|---|---|
| 合法 v1 manifest + strict sidecar v1 | v1 | 按冻结 v1 完整校验、建图并 Graph ready | 已有候选实现，不变 |
| 合法 v2 身份 + topology 明确 `ABSENT` + 全部几何/Metadata/资源门禁通过 | v2 | Scene/Metadata ready；Topology 结构化不可用 | Platform 消费候选已实现并验收 |
| 合法 v2 + TOWER/ROOF 非空 building + 显式 `level: null` 或有限整数 | v2 | 按声明值发布 Scene/Metadata ready；不补算 level | Platform 本地修正候选已实现；共同 fixture 待验签 |
| TOWER/ROOF 缺失 level、building 为 null，或其他非景观类型 level 为 null | v2 | fail closed | Platform 本地专项已覆盖；共同 fixture 待验签 |
| v2 缺少 topology 能力声明或声明未知值 | v2 | fail closed，不加载或发布部分会话 | 已实现专项拒绝 |
| v2 使用空、伪造或占位 sidecar 表示“无 topology” | v2 | 拒绝 | 已实现封闭 ZIP allowlist 拒绝 |
| v2 GLB 携带 `scene.extras.sspTopology` | v2 | 拒绝整个包；不得忽略、fallback 或产生 graph | 已实现 `PACKAGE_EMBEDDED_TOPOLOGY_FORBIDDEN` |
| v1 manifest 缺 topology，或 v1 sidecar 缺失/非法 | v1 | 保持 v1 fail closed；不得降级为 v2 | 现有行为不变 |
| GLB 几何、Metadata 3.3、SPACE/语义或自包含门禁失败 | v2 | 拒绝整个包 | 已实现；不得视为 topology 缺席 |
| URI、SHA-256、revision、identity、唯一性或资源预算失败 | v2 | 拒绝整个包 | 已实现 fail closed |
| Studio `*-unvalidated` GLB/ZIP | producer/v2 | Producer 不得发布；Platform 不以文件名替代验证且不提供特殊放行 | 明确拒绝标准交付 |
| 旧 building-release ZIP 或无显式 package identity 的 ZIP | v1/v2 | 拒绝，不猜版本 | 现有旧 ZIP 拒绝边界不变 |
| 未知 package 版本、未知字段或同时携带冲突 manifest identity | discovery | fail closed | 显式 v2 入口与封闭 schema/ZIP 已实现；v1 失败不降级 |

## 5. Producer 与 Consumer 影响

### 5.1 Space Model Studio producer

Studio producer 继续承担：

1. 独立的 v2 显式导出入口，不能把 v1 导出失败自动改写为 v2。
2. 在导出前完成几何、Metadata `3.3-semantic`、SPACE/语义、自包含资源和 identity 校验。
3. 生成确定性 ZIP 后，对最终 ZIP 精确字节重新打开并重复执行 manifest、URI、摘要、revision、GLB 和资源限制校验。
4. 只有产品流程明确选择临时 v2、且 topology 缺席原因符合批准范围时，才生成 v2；`*-unvalidated` 中间态不得进入 exporter。
5. 明确 v2 的临时 provenance、revision 与未来回 Studio 补 topology 重发 v1 的可追踪关系。
6. 在共同回滚触发后同步停止生产新的 v2 revision，并为存量 v2 提供回开、补 topology 和重发 v1 的迁移路径。

### 5.2 Space AI Platform consumer

Platform 消费候选已经完成以下边界，后续不得反向放宽：

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

当前 Platform 以 SSP 外的 `PackageAssetResourceProofV2` 实现该职责边界；接口名称是消费候选事实，不是要求 Studio 复用的跨项目源码契约。

### 6.2 生命周期与会话状态

v2 生命周期应保持以下不变量：

- 新选择开始时失效旧 generation，并按既有顺序清理 routes、graphs、legacy topology 和 models；
- manifest、全部资源摘要、Metadata 和 topology capability 声明在任何模型加载前完成校验；
- 多资产加载必须全部成功才能发布会话，任一失败清理全部已加载根和登记；
- 模型切换、重载、文件读取迟到和 loader 迟到结果不得覆盖当前会话；
- v2 成功态是 Scene/Metadata ready，而不是现有 topology `ready + graphId + nodes` 的同义词；
- v2 会话必须携带明确能力投影，`graphId` 为空、topology nodes 为空，且不会调用 sidecar compiler 或 `createGraph`；
- 从 v1 切换到 v2 时仍须清除旧 route/graph；从 v2 卸载或切换时仍须清理全部模型资源。

Platform 候选使用独立 `scene-ready` 状态与 v2 package-session discriminator；`graphId` 和 topology nodes 保持为空。该状态不与 Graph-ready `ready` 混用。

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

当且仅当 v2 manifest 以已冻结机器字段明确声明 topology `ABSENT`，且其他所有验证与加载成功时：

- package 导入成功并进入 Scene/Metadata ready；
- topology 相关查询、模板和 UI 返回或显示结构化 `TOPOLOGY_UNAVAILABLE` 产品语义；
- 该状态不是加载失败、sidecar 404、graph commit failure 或 `NO_PATH`；
- `NO_PATH` 仍只表示一张合法 graph 中没有满足约束的路径，不能用于表达 topology 缺席；
- capability/result envelope 固定为 `TOPOLOGY_UNAVAILABLE / PACKAGE_DECLARED_ABSENT`；包校验失败继续使用结构化、去敏的 `PACKAGE_*` code/phase/path，不得混用正常能力缺席语义。

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
- 不建立持久化 v2 revision registry。运行时回滚通过用户重新导入获准包完成；共同退出时的存量迁移证据由 Studio source、包字节/摘要和既定流程承担，不在 Platform 新增长期 registry。

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
2. 以现有 Studio source、包字节/摘要和使用方证据盘点存量 v2 及迁移状态；不得继续修改原 revision，也不得为此新增 Platform 持久 revision registry。
3. 存量 v2 进入只读迁移期，Platform 只为迁移保留读取能力，不再扩大功能或新建依赖。
4. 每个存量包回到 Studio 补齐严格 topology，通过完整 producer 门禁后以新的 v1 revision 重发。
5. Platform 用冻结 v1 reader 验证并接收新 v1，确认 Scene/Metadata 与 topology 功能及回滚证据。
6. 所有存量迁移完成并经双方验收后，提出删除 v2 reader 的独立变更；最终删除仍须用户明确批准。

任一触发条件或迁移证据不满足时，不得单方停止另一端仍依赖的能力，也不得用修改 v1、伪 sidecar或清理存量数据代替协调回滚。

## 10. 共同 Fixtures 与 Diagnostics 证据

### 10.1 必需成功 fixtures

- 最小单资产 v2：严格几何、Metadata 3.3/SPACE、显式 topology `ABSENT`。
- 真实整栋多楼层 v2：多 GLB、唯一 asset/floor identity、全部 SHA-256 和最终回读通过。
- 与 v1 同一合法 GLB 资源的对照 fixture：证明 v2 只改变声明能力，不放宽几何/Metadata validator。
- Scene/Metadata ready 的浏览器 fixture：模型可见、无 graph、所有 topology 入口稳定返回不可用。
- TOWER 与 ROOF 的 nullable-level 成功 fixture：至少覆盖 `A_T`/TOWER/`null`、`A_RF`/ROOF/`null`，并保留显式整数 TOWER/ROOF 成功对照；manifest、scene 与 mesh node 值完全一致。

### 10.2 必需失败 fixtures

- capability 缺失、未知、冲突或非法大小写/类型；
- v1 缺 topology 不得被 v2 reader 接管；
- 空/伪 sidecar、embedded-only topology、冲突 manifest identity；
- GLB 几何、Metadata、SPACE/语义、自包含和最终回读失败；
- asset/URI/digest/revision/floor identity 不一致、重复 canonical URI、未知 ZIP entry 与资源超限；
- 旧 building-release ZIP、无 manifest ZIP 和 Studio producer 未通过验证的中间产物；
- 多资产中途失败、A→B 迟到、清理失败和部分场景污染；
- v2 会话错误发布 graphId、nodes、Graph ready 或启用 topology Quick Action/AI。
- TOWER/ROOF 缺失 `level`、`building: null`、manifest/GLB floor identity 不一致；FLOOR/BASEMENT/FACILITY 使用 `level: null`；LANDSCAPE 使用非 null building/level。

### 10.3 已冻结 diagnostics 边界

- v2 identity/schema/version、capability、资源、Metadata、加载、生命周期与 stale failure 使用结构化 `PACKAGE_*` code/phase/path 并去敏；
- 正常 topology 缺席只使用 `TOPOLOGY_UNAVAILABLE / PACKAGE_DECLARED_ABSENT`；
- UI 与 Template Runtime 稳定区分“能力不可用”“无路”“包加载失败”；
- Platform fixture 的 ZIP SHA-256 为 `be0b7734ebbb3effb1f220f601d047d69dcf849c5d16bf7fdc1cd54f4f90e0c7`，SHA index 为 `c559d47222f6d7d61160d74676885e61ea0c0a462f0f67d6c7e5cdd2cc78a91c`，canonical revision 为 `96fee045700e5bbe18c4b196ae96821a84508860460c3cd2e59455594bc61b22`；Studio 与 Platform 已核对同字节 fixture。
- 自动验收已通过 v2 parser 16、v2 lifecycle 5、home 13、capability 9、Quick Action 22、v1 parser 33、v1 lifecycle 10、legacy 27、sidecar 18、templates 18，以及 typecheck/build/`verify:r1`/审计。真实浏览器显式导入 v2 后为 2 floors、Scene/Metadata ready、无 graph、Topology 稳定 unavailable；权威最小 GLB 仅有两条 Three loader min/max warning，无 error。
- 上述 ZIP/index/revision 与自动验收是 nullable 特殊层修正前的历史候选证据。Platform 已在 `30e1b4e` 完成 validator/Metadata/lifecycle 修正，在 `d4475ba` 增加 Template 查询专项，并在 `35161cc` 完成权威 v1/v2 fixture/index 的同字节镜像与独立验签。
- `35161cc` 中三个镜像文件与 Studio 原件 `cmp=0`；authority document/index/v1 ZIP/v2 ZIP SHA-256 依次为 `7df85d3992559ba299b08ce8e55917c732291a519175de6c71c4b422eb128f0f`、`f72befd8dc538095fdca43d5979c968b57b87d1c8650a81ecb8a337405a80ef1`、`b2cc39d73504f2f8ed2535305785f9a32e3b93493eebbb52737ce90b404b2be4`、`a07fe215f0c878d407378d033328f8ad7d3602b94c89701c2266896ac41ef77c`。index、两个 ZIP、全部 entry SHA/length 已自动独立校验。
- v1 revision `dddc3c9f5c3ee48d3e8123d8ae1d9b5ea591d1eced7ebf3bfcda8ce6e4b4c147` 与 strict sidecar revision 一致；v2 canonical revision `b89bdf4c02f7c99182483a3f5119a4ed10141c11889108108bc47cf260f7c8d4` 重新计算一致。v1/v2 parser 35/18、lifecycle 12/7、Template 19、`verify:r1` 10/10 均 PASS；独立 Reviewer P0/P1=0。
- fixture 验签不替代 nullable 特殊层新的联合真实浏览器验收或用户兼容里程碑批准；完成前不得宣称 Studio/Forge/Platform 三端兼容。

## 11. 分阶段工作包

### Phase 0 — 联合机器契约对齐

- 两端产品经理和技术负责人确认 v2 临时范围、退出触发和不变边界。
- 冻结 machine identity、manifest discovery、capability 表达、closed schema、diagnostics 和版本协商。
- 先形成内容相同的 success/failure fixture 规范与 SHA index 规则。

状态：已完成。P0 精确值与补充决策均已获用户批准。

### Phase 1 — Studio producer

- 实现显式 v2 exporter、严格 preflight、确定性 ZIP 和最终发布物回读。
- 保证 `*-unvalidated` 不进入 v2 exporter；记录 v2→Studio source→未来 v1 revision 的迁移映射。
- 产出权威 golden ZIP、failure vectors、validator 结果和 SHA index。

停止条件：Studio 独立 producer gates 全部通过，尚不宣称 Platform 已兼容。

### Phase 2 — Platform consumer

- 新增 SSP 外 v2 reader、资源证明、asset session、能力投影和 UI/Template/AI 门禁。
- 保持既有 v1 fixture 结果、旧 v3.1 reader、`src/ssp/**` 和除获批 nullable 特殊层显式接受值域外的接受/拒绝结果不变；新增共同 fixture 必须单独同步验签。
- 完成 package/Metadata/lifecycle/capability/非污染专项测试。

状态：原任务分支候选检查点依次为 parser `e5b6462`、lifecycle `2033525`、capability gate `7733284`、UI `c498452`、fixture `f499da8`；nullable 特殊层的 Platform checkpoints 为 `30e1b4e`、`d4475ba` 与 fixture 镜像验签 `35161cc`。本地候选仍未合入 local `main`、未发布；新的联合真实浏览器验收和用户兼容里程碑尚未完成。

### Phase 3 — 双端联合验收

- 双方交换同字节 fixtures 并分别验签 SHA index。
- 使用真实 Studio 整栋 ZIP 完成 Platform 浏览器验收，覆盖 Scene/Metadata ready、Topology unavailable、切换/卸载和失败路径。
- 技术负责人完成架构边界复核，QA 完成独立验收，产品经理完成范围和证据收口。

停止条件：P0/P1 清零、遗留风险明确，并提交用户临时兼容里程碑确认。

当前技术证据：原候选的同字节 fixture、自动门禁与真实浏览器均已通过；nullable 特殊层也已完成 Platform 实现、权威 v1/v2 fixture/index 同字节镜像、独立验签、自动门禁和独立 Reviewer。尚未执行的是本修正新的联合真实浏览器验收，用户临时兼容里程碑、发布和 local `main` 合入状态均不变；此前不得宣称 Studio/Forge/Platform 三端兼容。

### Phase 4 — 临时放行与退出准备

- 只有用户确认里程碑后，才按获准范围启用 v2 生产与消费。
- 记录使用方、迁移责任和共同退出证据；不建立持久 revision registry，运行时回滚靠重新导入。
- 持续推进完整 topology authoring/consumer/fixtures，不在 v2 上扩张 topology 替代能力。

停止条件：满足第 9.2 节共同回滚触发，转入协同退出流程。

## 12. 已冻结 P0 机器值与补充决策

1. identity：`schema = "space-model-package"`、`schemaVersion = 2`、`profile = "TOPOLOGY_ABSENT_TRANSITION"`，固定根 manifest `space-model-package.v2.json`；仅显式 v2 入口选择，v1 失败绝不降级。
2. capabilities：封闭对象只接受 `scene/metadata/space.status = AVAILABLE`、`space.completion = CONFIRMED`、`topology.status = ABSENT`；缺省、未知或冲突值失败。
3. assets：manifest 加 1–128 个 floor GLB；每项显式 `assetId/uri/SHA-256/floor`，root-relative 或 relative URI 映射到 ZIP archive root，同源且安全 canonicalization，跨资产 SID/findId 唯一。
4. topology：ZIP 禁止任意 sidecar/topology entry，GLB 禁止 `scene.extras.sspTopology`；不得使用空/伪 graph 或 embedded fallback。Studio authoring 中若存在 draft topology，可在导出 v2 时显式排除并留下审计，但禁止静默丢弃；排除后的标准包仍不得携带该内容。
5. revision：移除 `revision` 后，对 canonical manifest facts（不含非规范 audit）执行 JCS/RFC 8785 兼容 UTF-8 canonicalization 与 SHA-256。`producer-validation.json` 可选、完全非规范且不参与接受或 revision。
6. ZIP/limits：store-only、非 ZIP64、单盘、无加密、无 data descriptor、根目录 closed allowlist；manifest/audit 各 1 MiB、单 GLB 32 MiB、全部未压缩 entries 合计 64 MiB、archive 65 MiB、最多 130 entries、JSON depth 16、普通字符串 160、URI 4096。
7. 消费顺序：ZIP/URI/revision/全部摘要/Metadata 3.3/identity 在任何 loader 调用前完成；全部资产成功才原子发布 `scene-ready`，资源证明为 `SAME_RESPONSE_BYTES`，不调用 sidecar compiler 或 `createGraph`。
8. 正常能力缺席：`TOPOLOGY_UNAVAILABLE / PACKAGE_DECLARED_ABSENT`；routing/rendering/connector/blocker/topology AI/Quick Action 关闭，非 topology 能力继续经过 SSP–Template–AI 窄腰。
9. 补充回滚：不做持久 revision registry，用户通过重新导入回滚运行时选择；临时 profile 的停发、停收、存量迁移与 reader 最终移除仍由第 9 节共同门禁和用户批准控制。
10. floor identity 兼容修正：TOWER/ROOF 的 `building` 必须为非空字符串，`level` 键必须存在并允许 `null` 或有限整数；其他 floorType 继续遵循第 2.2 节矩阵。`level` 的原始声明值属于 canonical manifest facts，`null` 与整数产生不同 revision；不得在计算 revision 前补算或归一化。

## 13. 当前结论

- 用户已批准 v2 P0 精确机器值及“不做持久 revision registry、回滚靠重新导入”和“Studio 可显式排除并审计 draft topology、不得静默丢弃”两项补充决策。
- 本文是过程、边界、验证和回滚事实源，不替代 machine-readable schema 或 fixtures。
- Platform 原消费候选及 nullable 特殊层实现、权威 fixture 镜像验签已在 `codex/r2-standard-model-package` 完成；修正 checkpoints 为 `30e1b4e`、`d4475ba` 与 `35161cc`。候选尚未合入 local `main`、尚未发布，也未获得临时兼容里程碑批准，不得宣称 Platform 已交付 v2。
- nullable 特殊层权威 v1/v2 同字节 fixture/index 已完成 Platform 镜像与独立验签；新的联合真实浏览器验收尚未执行，完成并获得用户里程碑批准前不得宣称 Studio/Forge/Platform 三端兼容。
- v1 strict topology 候选结论、既有 v1 fixture 结果、旧 v3.1 reader 与旧 ZIP 拒绝边界均保持不变；唯一例外是用户明确批准并已由新共同 fixtures 覆盖的 TOWER/ROOF nullable-level 接受值域。
- `src/ssp/**` 未修改；临时 profile 不得由任一方单方停发、停收、迁移或移除。
- 本决策无新增、撤销或职责迁移，不改变组织架构。
