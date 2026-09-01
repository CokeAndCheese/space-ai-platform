# Standard Model Package v1 — 联合契约设计基线

> 日期：2026-08-22
>
> 状态：方案 B 已获用户批准；原候选已完成双端机器实现与联合技术验收；2026-09-01 获批的 TOWER/ROOF nullable-level 修正已完成 order 推测 P0 纠正、修订权威 fixture 同字节镜像与自动矩阵；新的联合真实浏览器验收和用户兼容里程碑仍待完成，尚未发布、合并或进入 `main` 兼容基线
>
> 生产方：Space Model Studio
>
> 消费方：Space AI Platform

## 1. 目标与冻结边界

Standard Model Package v1 是两个独立产品之间的新窄腰。它不替换或改写以下既有契约：

- Studio Metadata `3.3-semantic`；
- Platform GLB Metadata v3.1；
- Studio embedded `scene.extras.sspTopology` schema v1；
- Platform `space-ai-platform/topology-sidecar` schema v1。

新包把 `3.3-semantic` GLB、严格 Platform sidecar v1、不可变资源摘要和版本声明组合成一个可验证交付。Platform 继续保留旧 v3.1 reader；Studio 继续保留 embedded topology 供本端回开。任何 reader 都必须由显式 contract identity 选择，禁止按字段形状猜版本。

原候选的共同 fixtures、producer validator、consumer validator、双端全门禁、真实浏览器端到端验收和最终独立复核均已通过。2026-09-01 获批的 TOWER/ROOF nullable-level 修正已完成修订权威 v1 fixture/index 的 Platform 同字节镜像、P0 回归与独立验签，但尚未执行本修正新的联合真实浏览器验收。用户确认前仍只能称为“兼容候选”，不得宣称 Studio/Forge/Platform 三端兼容、发布、合并或 `main` 已兼容。

## 2. Package identity 与发现

- `schema` 固定为 `space-model-package`。
- `schemaVersion` 固定为整数 `1`。
- 约定文件名为 `space-model-package.v1.json`。
- Platform 只接受用户、模型清单或受控选择流程明确给出的 manifest URI；若入口是目录，只尝试上述固定文件名。
- Package 内 topology 资源始终由 manifest URI 显式指定；可以沿用 sidecar v1 的 basename 约定，但 basename 不再充当 package reader 的猜测或 fallback 入口。
- 不扫描目录、不根据 GLB 文件名猜包、不回退到 GLB extras，也不把普通 v3.1 GLB 自动升级为 package v1。
- 旧 Studio building-release ZIP 若不具备显式 v1 manifest identity，继续 fail closed，不因文件内容或 basename 自动升级。
- 未知 `schema`、未知版本、未知结构字段或重复 ID 均 fail closed。

## 3. Manifest v1

### 3.1 最小规范示例

```json
{
  "schema": "space-model-package",
  "schemaVersion": 1,
  "packageId": "hospital-a/floor-1",
  "revision": "hospital-a-floor-1-2026-08-22.1",
  "metadata": {
    "schema": "space-model-metadata",
    "version": "3.3-semantic",
    "carrier": "GLB_SCENE_NODE_EXTRAS"
  },
  "assets": [
    {
      "assetId": "hospital-a/floor-1",
      "uri": "./A_1F.glb",
      "digest": {
        "algorithm": "SHA-256",
        "value": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
      },
      "floor": {
        "floorName": "A_1F",
        "building": "A",
        "level": 1,
        "floorType": "FLOOR"
      }
    }
  ],
  "topology": {
    "uri": "./topology.v1.json",
    "digest": {
      "algorithm": "SHA-256",
      "value": "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
    },
    "schema": "space-ai-platform/topology-sidecar",
    "schemaVersion": 1,
    "revision": "hospital-a-floor-1-2026-08-22.1"
  }
}
```

### 3.2 字段约束

| 字段 | 约束 |
|---|---|
| `packageId` | 必填、trim 后非空、最长 160 字符；在发布域内稳定 |
| `revision` | 必填、trim 后非空、最长 160 字符；指向不可变的一组 manifest/GLB/sidecar 字节 |
| `metadata.schema` | 固定 `space-model-metadata` |
| `metadata.version` | v1 固定 `3.3-semantic` |
| `metadata.carrier` | 固定 `GLB_SCENE_NODE_EXTRAS` |
| `assets` | 1–128 项；`assetId` 唯一且最长 160 字符 |
| `assets[].uri` | manifest 相对或根相对 URI；最长 4,096 字符 |
| `assets[].digest` | 必填；仅 `SHA-256` 与 64 位小写十六进制 |
| `assets[].floor` | 必填；`floorName/floorType` 必须符合并等于 3.3 scene metadata；`building` 和 `level` 键均不得省略，值按下表由 `floorType` 约束 |
| `topology.uri` | 必填；与 assets 使用相同 URI 安全规则 |
| `topology.digest` | 必填；覆盖 sidecar 的精确 UTF-8 字节 |
| `topology.schema` | 固定 `space-ai-platform/topology-sidecar` |
| `topology.schemaVersion` | 固定整数 `1` |
| `topology.revision` | 必须与 package `revision` 相同 |

Manifest 必须是 UTF-8 JSON，最大 1 MiB，最大容器深度 16。除 URI 外的字符串最长 160 字符。v1 对象均为封闭结构，不提供可改变核心语义的自由扩展字段。

`assets[].floor` 的条件约束固定为：

| `floorType` | `building` | `level` |
|---|---|---|
| `TOWER` / `ROOF` | 必须存在且为 trim 后非空字符串 | 键必须存在；值为 `null` 或既有有限整数 |
| `FLOOR` / `BASEMENT` / `FACILITY` | 必须存在且为 trim 后非空字符串 | 必须为有限整数，不接受 `null` |
| `LANDSCAPE_TERRAIN` / `LANDSCAPE_FACADE` | 必须为 `null` | 必须为 `null` |

`A_T` / `TOWER` / `null` 与 `A_RF` / `ROOF` / `null` 是当前特殊层候选；既有整数 TOWER/ROOF 继续合法。整数或 `null` 都必须由 producer 显式写入，Platform 不从 elevation、文件名、楼层顺序或 `floorType` 猜测、生成或归一化 `level`。本修正不新增 schema/version/elevation/order/topology 字段。

### 3.3 URI 与摘要规则

- 资源 URI 不能含凭据、fragment、反斜杠、协议相对写法或独立 scheme；解析后必须与 manifest 同源。
- URI 先按 manifest 规范化，再比较资源身份；不同词法 URI 不能指向同一 canonical URI。
- Platform 在解析 GLB metadata 或 topology 前验证资源 SHA-256。
- sidecar `assets[].assetId` 必须在 manifest `assets[]` 中恰好出现一次。
- sidecar asset URI 以 sidecar URI 为基准规范化后，必须与对应 manifest asset canonical URI 相同。
- sidecar asset digest 必须与 manifest GLB digest 完全相同。若 sidecar 同时声明 asset revision，则也必须通过既有 sidecar v1 proof 规则。
- 每个 manifest floor identity 必须与对应 GLB 默认 scene extras 逐字段相同；同一 package 内 `assetId`、canonical URI 和 `(building, floorName)` 分别唯一。
- package manifest 不自我摘要；外层模型清单或发布记录可以另行记录 manifest SHA-256，但不得写回 manifest 形成循环。

## 4. Metadata 3.3 的 Platform 最小消费边界

Platform 新增独立 package v1 reader 与 `3.3-semantic` validator/adapter，旧 v3.1 reader 保持原语义和入口不变。

处理顺序固定为：

```text
显式选择 package manifest
→ 验证 package identity、封闭结构、容量与 URI
→ 获取并验证 GLB/sidecar 精确字节摘要
→ 按 manifest 明确选择 3.3-semantic validator
→ 校验 scene/node metadata
→ 加载 GLB 并建立 AssetProof
→ 使用现有 sidecar v1 parser/compiler
→ SSP 外适配并一次性提交 graph
```

3.3 适配层只负责验证和投影 Studio 已声明的字段；manifest floor、默认 scene extras 与所有 mesh node extras 的 `floorName/building/level/floorType` 必须逐字段完全相等。`sid` 作为不透明稳定标识使用，不把 v3.1 的无方向 SID 规则套到 3.3，也不从名称、包围盒、行业词汇或缺失字段推断语义。

对于显式 `level: null` 的 TOWER/ROOF，精确 `floorName` 或 `floorType` 查询仍可使用；数字 level 查询、`getFloorNameByLevel` 及 explode 等依赖数字 level 的能力明确不适用。适配层不得为使这些能力可用而补算 level，也不定义隐式排序或 elevation。

禁止触碰范围：

- 不修改 `src/ssp/**`；
- 不改变 v3.1 validator 或历史资产的接受/拒绝结果；
- 不让 AI 直接读取 package 或调用原始 SSP；
- 不读取 embedded topology 作为 sidecar fallback；
- 不在摘要、版本或资源绑定失败时降级猜测。

## 5. Studio embedded v1 → Platform sidecar v1 映射

当前 Studio 单楼层有效图可以保留其运行时图语义并编译成 sidecar v1，但不是复制或改名。Exporter 必须执行显式映射：

| Studio embedded v1 | Platform sidecar v1 |
|---|---|
| 单个 `graphs[i]` | 一个 sidecar 的 `graphId/layers/nodes/edges` |
| `MODEL_LOCAL` 米制 +Y 坐标 | 只有在最终 GLB 根局部坐标与之相同且被验证时声明 `ASSET_LOCAL/meter/Y`；否则先显式变换 |
| GLB 内隐含资产 | 注入 manifest/sidecar 共用的 `assetId`、URI 和 SHA-256 |
| node 裸 position | 保留 position，并注入所属 `assetId` |
| edge 裸 via point | 保留 position，并为每个 via 注入所属 `assetId` |
| node `connectorId` | 只有存在合法跨层 CONNECTOR edge 时才能生成顶层 `connectors[]`；当前单楼层悬空标识仅保存在 `node.data.spaceModelStudio.connectorId`，不得伪造成 Platform connector |
| edge `initialState.blockerIds` | 按 blocker ID 聚合为顶层 `blockers[]`，当前 embedded 语义映射为 `active: true`，并保留关联 edge IDs |
| graph/node/edge tags 与 data | 在 sidecar v1 JSON 安全与容量限制内原样保留 |

当前结论：节点、层、同层边、polyline、权重、enabled/weightOverride、tags/data 与当前 active blocker 路由行为可无损承载；Studio 单楼层中未成对的 `connectorId` 没有跨层路由语义，只能作为 namespaced provenance 保留。Standard Model Package v1 不提供跨层 routing；真正跨层 connector 属于未来能力，必须由完整多楼层 fixture 和新验收证明，不能由 v1 exporter 猜边。

若任何 Studio 图超过 sidecar v1 限制、无法证明米制 +Y/资产局部坐标、无法形成合法 connector/blocker，exporter 必须拒绝生成 package v1。若产品需要扩大这些语义，应另发 sidecar v2，不得放宽 v1。

## 6. Embedded 与 sidecar 一致性

Studio 可以在 GLB 中继续写 embedded topology，但 Platform 永远只消费 package 指向的 sidecar。

Producer validator 必须把 embedded graph 和生成的 sidecar 反向投影到同一 canonical comparison model，并验证：

- graph/layer/node/edge ID 与排序无歧义；
- node position、edge path、relation、direction、weight 和 initial state 一致；
- 注入的 `assetId`、顶层 connector/blocker 与第 5 节映射一致；
- `node.data.spaceModelStudio.connectorId` 与 embedded `connectorId` 一致；
- GLB、sidecar、manifest 的摘要和 package revision 一致。

任一差异都使 package 生产失败。只比较 revision 字符串不足以证明语义一致。

## 7. 共同 fixtures 与兼容矩阵

两端仓库保存内容完全相同的 fixture 子集，并以 SHA-256 index 防止漂移。首批至少包含：

| Fixture | 预期 |
|---|---|
| 单楼层最小 package | 双端 PASS，Platform 成功建图 |
| 单楼层 polyline + active blocker | 双端 PASS，路由行为一致 |
| Metadata 3.3 必填字段/方向 SID | 合法 PASS；缺失或非法 FAIL |
| `A_T`/TOWER 与 `A_RF`/ROOF 的显式 `level: null`，以及既有整数 TOWER/ROOF | manifest、scene、mesh node 完全一致时双端 PASS |
| TOWER/ROOF 缺失 `level`、`building: null` 或 manifest/GLB floor identity 漂移 | FAIL CLOSED |
| FLOOR/BASEMENT/FACILITY 使用 `level: null`，或 LANDSCAPE 使用非 null building/level | FAIL CLOSED |
| package/GLB/sidecar 摘要任一不匹配 | FAIL CLOSED |
| manifest 未知字段、未知版本或重复 assetId | FAIL CLOSED |
| URI 跨源、带凭据、fragment、反斜杠或重复 canonical URI | FAIL CLOSED |
| sidecar asset URI/digest 与 manifest 不一致 | FAIL CLOSED |
| embedded 与 sidecar canonical projection 漂移 | Producer FAIL |
| sidecar v1 容量边界与超限 | 精确边界 PASS，超限 FAIL |
| legacy v3.1 + sidecar v1 | 旧 Platform reader 继续 PASS，结果不变 |

Studio 负责 golden package 的生产与 producer validator；Platform 负责 consumer validator、加载/绑定、图编译和兼容回归。任何 fixture 变更必须两端共同审查并同步 SHA-256 index。

权威 fixture index 由生产方 Studio 维护，Platform 保存同字节镜像并在本地独立验签；任一端 index 或资源 SHA-256 不同即停止联验。由于项目当前均为本地模式，fixture 通过受控人工复制同步，不建立运行时跨仓依赖。

### 7.1 候选验证证据（2026-08-28）

- Platform consumer 检查点：`786e3f3123d24dde264aca0536ef04f6e4fe8e07`（`codex/r2-standard-model-package`）。
- Studio producer 检查点：`02b560a`（Studio 对应任务分支）。
- 双仓同字节 golden ZIP SHA-256：`d0662cdfb95656def2d553a727ddeb88a3b946c9f2ecbefe2558fd83723423b0`；双方 SHA index 已分别验签。
- Studio 与 Platform 全门禁、真实浏览器联合验收均通过；最终独立 Reviewer P0/P1/P2 均为 0。
- 这些证据只支持“待用户里程碑确认的兼容候选”，不证明候选已发布、已合并或任一仓库 `main` 已兼容。
- 2026-09-01 nullable 特殊层修订权威为 Studio `f653264`；Platform checkpoints 为 `acbf1f4`（重新镜像、P0 与加载后 identity fail-closed）和 `135be84`（真实 validated v2 查询专项）。上列原 golden ZIP/SHA index 不覆盖本修正。
- authority document/index/source `Building.glb`/v1 ZIP SHA-256 依次为 `c41dedc540037cfadbae828e82da4f170a97732e7a96d2ff14744ef75e4446ae`、`085a3a08f54fb7f02ee9ef6e16242e47d7741bb5821fdc95869df10ef6cc4485`、`86244b9a40f75e11397cf8ebc65dc0509ffb0337eece3c2a8ba2e1d32a04b864`、`1080cc8717eed98d18eb7a1c8708596ac43c90a7181c28fb55ac5a69df3b3e76`；v1 package revision 与 strict sidecar revision 均为 `482a129ffeef87de842d86ecb62e9e2d2f693ebcc0ae194543ab6e82c7f142bb`。
- P0 回归证明 v1 embedded/sidecar 的 `A_T`/`A_RF` layer 不含 `order`，`A_5F`/`A_6F` 保持整数 `5`/`6`，加载后 `floorName/building/level/floorType` 四字段不一致 fail closed。最终矩阵 PASS：v1/v2 parser 35/18、v1/v2 lifecycle 13/8、Template 20、sidecar 18、capability 9、Quick Action 22、home 13、legacy lifecycle 27、topology 10、typecheck/build/`verify:r1` 10/10。
- 旧 `35161cc`/`dbceba4` 及旧 authority/index/v1 ZIP/revision SHA `7df85d3992559ba299b08ce8e55917c732291a519175de6c71c4b422eb128f0f`、`f72befd8dc538095fdca43d5979c968b57b87d1c8650a81ecb8a337405a80ef1`、`b2cc39d73504f2f8ed2535305785f9a32e3b93493eebbb52737ce90b404b2be4`、`dddc3c9f5c3ee48d3e8123d8ae1d9b5ea591d1eced7ebf3bfcda8ce6e4b4c147` 已 superseded，仅作历史证据。修订证据仍不替代新的联合真实浏览器验收或用户兼容里程碑批准。

### 7.2 共同 diagnostics 基线

Sidecar 解析、绑定和编译失败继续原样使用已冻结的 `SIDECAR_*` diagnostic code，不在 package 层改名。Package/Metadata 层下一门禁至少冻结以下共同 code：

- `PACKAGE_JSON_INVALID`
- `PACKAGE_SCHEMA_UNSUPPORTED`
- `PACKAGE_FIELD_INVALID`
- `PACKAGE_DUPLICATE_ID`
- `PACKAGE_URI_INVALID`
- `PACKAGE_RESOURCE_NOT_FOUND`
- `PACKAGE_DIGEST_MISMATCH`
- `PACKAGE_REVISION_MISMATCH`
- `PACKAGE_METADATA_UNSUPPORTED`
- `PACKAGE_METADATA_INVALID`
- `PACKAGE_TOPOLOGY_PROJECTION_MISMATCH`
- `PACKAGE_LIMIT_EXCEEDED`
- `PACKAGE_REQUEST_STALE`

双方候选实现已共同冻结每个 code 的触发条件、phase、JSON Pointer path 和去敏 envelope；用户里程碑确认前，它们仍是候选兼容基线而不是已发布 API 承诺。

## 8. 迁移、回滚与发布门禁

- Studio 过渡期 dual-write：保留 embedded topology，同时输出 package manifest 和严格 sidecar v1。
- Platform 过渡期 dual-read：旧入口继续 v3.1 + sidecar v1；新入口只接受 package v1 + 3.3 + sidecar v1。
- 不做同一文件的双版本猜测，不自动把 legacy GLB 包装成 package。
- 每个 package revision 不可变；回滚是切回上一个完整 revision，而不是局部替换 GLB 或 sidecar。
- 存量 Studio 模型必须经当前 exporter 重新发布并通过双端 fixtures/validator，不能只补一个 manifest 宣称升级。
- Studio 可额外输出 `producer-validation.json` 作为非规范审计附件；它不进入 package v1 manifest，也不影响 Platform 对 package 的接受或拒绝。
- 原候选的双端实现、共享 fixture、自动验证、浏览器加载和独立 QA 已通过；2026-09-01 nullable 特殊层修正也已完成 P0 纠正、修订权威 v1 fixture 同字节镜像与自动矩阵。仍须执行本修正新的联合真实浏览器验收并获得用户兼容里程碑批准；此前不得申请三端兼容、发布、合入或备份结论。

## 9. 工作包与所有权

### Space Model Studio

1. package manifest/exporter 与 deterministic bytes；
2. embedded → sidecar v1 映射与 canonical equivalence validator；
3. dual-write、存量模型重发和 producer fixtures；
4. 发布回读、摘要和回滚验证。

### Space AI Platform

1. package v1 封闭 parser、URI/摘要/resource budget validator；
2. 独立 Metadata `3.3-semantic` validator/adapter，保留 v3.1 reader；
3. package 选择、资源加载、AssetProof 与现有 sidecar v1 生命周期集成；
4. consumer fixtures、兼容矩阵、浏览器 P0 与独立 QA。

Platform 的实现边界位于 SSP 外的 adapter/integration 层；`src/ssp/**` 保持不变。双方使用现有技术负责人、模型/空间数据工程师和 QA，不新增编制。

## 10. 当前实施顺序

1. **已完成**：双方产品经理确认本文与 Studio 对应文档内容一致，9 项设计问题全部关闭。
2. **已完成**：冻结共同 JSON Schema/TypeScript contract、fixture index 与 diagnostics 预期。
3. **已完成**：Studio 实现 exporter/producer validator；Platform 实现 package/3.3 consumer reader。
4. **已完成**：双端交换同字节 fixtures、分别验签 SHA index 并交叉运行 validators。
5. **已完成（原候选）**：真实浏览器联合链路、独立架构/QA 复核及最终 Reviewer 通过，P0/P1/P2 均为 0。
6. **当前门禁**：执行 nullable 特殊层修订权威的新联合真实浏览器验收。
7. **后续门禁**：向用户提交兼容里程碑确认；确认后再执行获准的本地合入与手动备份流程。

当前两端成果仍位于各自任务分支。本文不表示已发布、已合并或 `main` 已兼容；用户里程碑确认是下一必经门禁。
