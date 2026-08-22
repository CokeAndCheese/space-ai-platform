# R1 Topology Sidecar v1 契约

> 状态：R1 已采纳的版本化输入契约
>
> 适用里程碑：R1「通用空间链路可验收版」
>
> 载体：外置 UTF-8 JSON sidecar
>
> 维护责任：`space AI platform产品经理-项目总控`
>
> 技术边界：适配器位于 `src/ssp/**` 之外
>
> 跨项目状态：本文件是 Space AI Platform 当前外置 sidecar v1 消费契约；Space Model Studio 当前输出的是不同的 GLB 内嵌 `scene.extras.sspTopology` v1。两个 v1 尚不兼容；差异和共同变更门禁见 [`CROSS_PROJECT_DATA_CONTRACT.md`](./CROSS_PROJECT_DATA_CONTRACT.md)

## 1. 目的与边界

本契约定义 R1 如何把一个或多个已加载 GLB 资产与显式 topology 数据绑定，并编译为现有 `TopologyGraphInput`。目标是让适配器在不读取行业语义、不推断缺失关系、不修改 SSP 核心的前提下，产出 Three.js 世界坐标中的通用图。

R1 的正式载体是版本化外置 sidecar v1：

- `GLB extras.topology` 暂不采用，也不是 fallback。
- 应用层 seed 只允许在自动化测试或 fixture harness 中显式注入，不得成为产品路径 fallback。
- sidecar 解析、资产绑定、坐标转换和诊断均在 SSP 外完成。
- AI 仍只能通过 Registry 明确开放的模板触发能力，不能读取 sidecar 或直接调用 SSP。

本文件只锁定 R1 所需的可逆契约，不宣称 sidecar 是产品永久唯一格式。未来可以在新的用户决策和版本契约下增加其他载体，但所有载体都应先编译到同一个显式通用图窄腰。

本文使用“必须”“不得”表达规范性要求；“建议”表达不影响 v1 合法性的优选做法。

相关现有契约：

- [`R1_MILESTONE.md`](./R1_MILESTONE.md)
- [`GLB_METADATA_SPEC.md`](./GLB_METADATA_SPEC.md)
- [`topologyTool_API.md`](./topologyTool_API.md)
- [`../src/ssp/topology/types.ts`](../src/ssp/topology/types.ts)

## 2. 载体与发现规则

一个 sidecar v1 文件描述一张图，可以绑定一个或多个 GLB。跨楼层、多 GLB connector 必须由同一 sidecar 统一拥有，不能在多个 GLB 中重复声明后再猜测合并。

R1 的默认文件约定是：

| 选择单位 | sidecar 路径 |
|---|---|
| 场景目录 `public/models/<scene>/` | `public/models/<scene>/topology.v1.json` |
| 独立 GLB `<name>.glb` | 同目录 `<name>.topology.v1.json` |

测试 fixture 可以位于测试目录，但内容必须遵守同一 schema。资产 `uri` 相对 sidecar URL 解析；根相对 URI 按应用当前 origin 解析。

sidecar loader 只能把 `assets[].uri` 与当前已加载资产做匹配，不能因为 sidecar 内容而加载任意新资产或访问其他 origin。sidecar 的发现来自当前场景/模型选择和上述约定，不要求也不得为了 R1 修改 `src/model-manifest.json`。

## 3. 版本模型

sidecar 顶层必须包含：

```json
{
  "schema": "space-ai-platform/topology-sidecar",
  "schemaVersion": 1
}
```

这里的版本与其他版本完全分离：

| 版本 | 含义 |
|---|---|
| sidecar `schemaVersion: 1` | 本文件定义的外置输入结构、校验与编译规则 |
| glTF `asset.version: "2.0"` | glTF/GLB 容器版本，不是 topology 版本 |
| `TopologyGraphSnapshot.schemaVersion: 2` | SSP `createGraph` 成功后返回的运行时快照版本，不是 sidecar 版本 |

不得把 `TopologyGraphSnapshot` 直接序列化为 sidecar，也不得要求两个 `schemaVersion` 数值相等。sidecar v1 成功编译后，当前 SSP 返回的 snapshot 仍为 topology schema v2。

v1 reader 遇到未知 `schema` 或非 `1` 的 `schemaVersion` 必须 fail closed。v1 是封闭结构：未知结构字段视为错误；业务扩展只能进入各实体允许的 `data` 对象。改变字段语义、坐标规则、引用规则或编译规则必须产生新的 sidecar schema 版本。

sidecar UTF-8 源文本不得超过 8 MiB；reader 必须在 `JSON.parse` 前完成该检查并以 `SIDECAR_LIMIT_EXCEEDED` 失败。

## 4. 顶层文档结构

sidecar v1 顶层字段如下：

| 字段 | 类型 | 必填 | 约束 |
|---|---|---:|---|
| `schema` | string | 是 | 固定为 `space-ai-platform/topology-sidecar` |
| `schemaVersion` | integer | 是 | 固定为 `1` |
| `revision` | string | 是 | 当前 sidecar 内容的不可变发布修订号；非空、最长 160 字符 |
| `graphId` | string | 是 | 编译后 `TopologyGraphInput.id`；稳定、非空、最长 160 字符 |
| `coordinateSpace` | string | 是 | v1 固定为 `ASSET_LOCAL` |
| `unit` | string | 是 | v1 固定为 `meter` |
| `upAxis` | string | 是 | v1 固定为 `Y` |
| `assets` | array | 是 | 1–128 个资产绑定 |
| `layers` | array | 是 | 1–32 项 |
| `nodes` | array | 是 | 1–2,000 项 |
| `edges` | array | 是 | 0–5,000 项 |
| `connectors` | array | 是 | 0–2,000 项；所有跨层 connector 必须在此显式声明 |
| `blockers` | array | 是 | 0–5,000 项；所有初始 blocker 必须在此显式声明 |
| `tags` | string[] | 否 | 最多 64 个不重复的非空字符串，只透传 |
| `data` | object | 否 | 有界 JSON 值组成的业务扩展，只透传，不参与推断 |

一个 sidecar v1 只编译一张 `TopologyGraphInput`。多图组合、流式分片和跨 sidecar connector 不属于 R1 v1。

## 5. GLB 资产强绑定

### 5.1 AssetBinding

每个 `assets[]` 元素结构如下：

| 字段 | 类型 | 必填 | 约束 |
|---|---|---:|---|
| `assetId` | string | 是 | sidecar 内稳定且唯一；非空、最长 160 字符 |
| `uri` | string | 是 | 相对 sidecar 或根相对的 GLB URI；规范化后必须唯一 |
| `digest` | object | 条件 | 与 `revision` 至少存在一个 |
| `digest.algorithm` | string | 条件 | v1 仅允许 `SHA-256` |
| `digest.value` | string | 条件 | 精确 GLB 字节的 64 位小写十六进制摘要 |
| `revision` | string | 条件 | 与 `digest` 至少存在一个；必须是加载端可核验的不可变资产修订号 |

如果 `digest` 和 `revision` 同时存在，两者都必须验证通过。`mtime`、可变标签或仅文件名不能冒充不可变 revision。

### 5.2 绑定规则

编译前，适配器必须为每个 `assetId` 找到恰好一个已加载资产，并验证：

1. 已加载资产的规范化 URI 与 `uri` 匹配。
2. sidecar 声明的 digest 或 revision 可由可信的加载/校验上下文提供并精确匹配。
3. 资产根仍属于当前 Three.js scene，且 `matrixWorld` 已更新。
4. sidecar 引用的所有资产均完整加载；场景批量加载的部分成功不能被当作 topology 完整成功。

当前场景可以包含 sidecar 未引用的装饰资产；这些额外资产不参与图。sidecar 引用的资产缺失、无法核验或绑定不一致时，必须拒绝整张 topology 图，不能只跳过相关节点或边。

### 5.3 已加载资产与可信 AssetProof

“当前选择中是否已经加载一个资产实例”和“该实例的内容是否具备可信证明”是两个独立事实，不能由同一个可选 proof 隐式推断。R1 编译上下文必须分别提供：

| 结构 | 必填字段 | 含义 |
|---|---|---|
| `TopologyLoadedAsset` | `canonicalUri`、`root`、`selectionGeneration` | 当前选择中实际挂入 scene 的资产实例，不表达内容可信性 |
| `TopologyAssetProof` | `canonicalUri`、`root`、`selectionGeneration`、`provenance` 及 digest/revision | 对同一 loaded asset 的内容强绑定证明 |

适配器必须先根据 `loadedAssets` 判断加载完整性，再根据 `assetProofs` 验证可信绑定：

- 没有恰好一个对应 loaded instance：`SIDECAR_ASSET_NOT_LOADED`。
- 多 GLB sidecar 只加载了部分必需资产：`SIDECAR_PARTIAL_SCENE`。
- loaded instance 存在但没有可信 proof：`SIDECAR_ASSET_BINDING_UNVERIFIABLE`。
- URI、root、generation、digest 或 revision 与 proof 不一致：`SIDECAR_ASSET_BINDING_MISMATCH`。

`uri + root` 只能证明“当前有一个对象声称来自该 URL”，不能单独证明 root 来自 sidecar digest/revision 对应的确切 GLB 内容。R1 集成层必须在 SSP 外为每个已加载 root 提供可信 `AssetProof`，至少包含：

| 字段 | 含义 |
|---|---|
| `canonicalUri` | 与 sidecar `asset.uri` 使用相同规则规范化后的 URI |
| `root` | 实际挂入当前 scene、将用于 world transform 的 GLB root |
| `selectionGeneration` | 产生该 root 的当前模型选择 generation |
| `digest` 或 `revision` | 与 sidecar 声明同类型、可精确比较的观测值 |
| `provenance` | proof 的产生方式与不可变性依据 |

可信 proof 只能来自以下任一路径：

1. **同一响应字节**：SSP 外的加载协调层对将被 GLTF parser 消费的同一份字节计算 SHA-256，并把 digest、root、URI 和 generation 原子绑定。
2. **不可变包修订**：本地构建 gate 对精确 GLB 字节验证 digest，并把不可变 package/asset revision 与当前加载选择一起传给运行时；运行时 proof 必须证明当前 URI 属于该已验证修订。

在 root 已加载后重新请求同一个可变 URI，不能证明第二次响应与 GLTFLoader 已消费的第一次响应相同，因此不得单独作为强绑定 proof。现有 `FloorInfo.url/root` 本身也不是 digest/revision proof。

AssetProof 的产生、保存和传递属于 SSP 外的 R1 场景协调职责。若当前加载路径无法提供可信 proof，必须返回 `SIDECAR_ASSET_BINDING_UNVERIFIABLE`，不得降级为只比较 URL；若实现被证明必须修改 `src/ssp/**` 才能提供 proof，则先按本文件第 13 节停止并请求授权。

## 6. 坐标契约

### 6.1 v1 坐标系

v1 只接受：

```json
{
  "coordinateSpace": "ASSET_LOCAL",
  "unit": "meter",
  "upAxis": "Y"
}
```

所有 node position 和 polyline via point 都是其 `assetId` 对应 GLB 根节点的局部坐标。生产者必须在写 sidecar 前完成其他单位或 up-axis 到 `meter` / `Y` 的转换；适配器不得根据模型名称、包围盒或行业经验猜测单位、轴或原点。

### 6.2 恰好一次的 world transform

适配器必须在已加载资产根上更新世界矩阵，并对每个局部点恰好应用一次对应资产的 `matrixWorld`：

```text
worldPoint = assetRoot.matrixWorld × localPoint
```

转换规则同时适用于：

- `nodes[].position`
- `edges[].path.via[].position`

转换后的 `x/y/z` 必须全部是有限数值。适配器输出给 `TopologyGraphInput` 的所有点已经是 Three.js 世界坐标；Topology 核心不得再次转换，`renderRoute` 也不得再施加非零整体 position offset。

`layers[].elevation` 只是以 `unit` 表示的描述性数据，Topology 核心不会使用它自动连边或转换坐标。

## 7. 实体契约

### 7.1 通用 ID 与扩展数据

除资产 URI 和 `data` 内字符串外，所有 sidecar 字符串必须在 trim 后非空且不超过 160 字符。资产 URI 最长 4,096 字符。`assetId`、layer ID、node ID、edge ID、connector ID、blocker ID 分别在各自命名空间内唯一；建议使用 `scene/type/name` 形式避免 fixture 间碰撞。

所有 tag 数组最多 64 项，trim 后不得重复。每个 `data` 字段最多 16 层容器深度、4,096 个累计 JSON 节点、单个数组或对象最多 1,024 个成员；字符串值和对象键最长 4,096 字符。违反容量规则必须在 commit 前返回 `SIDECAR_LIMIT_EXCEEDED`，不能依赖 SSP 二次拒绝或调用栈溢出。

稳定 ID 必须在不改变实体身份的资产重导出后保持不变。不得把 GLB 数组索引作为稳定 ID，也不得单独依赖由数组索引派生的 `findId`。如果使用 GLB `sid` 做来源锚点，生产者必须保证其跨文件唯一、跨修订稳定且可验证；`sid` 只能验证身份，不能替代显式 node、edge、connector 或 blocker。

`kind`、`subtype`、`mode`、`tags` 和 `data` 都是不透明值。`data` 必须是由 JSON-safe 值组成的普通对象。适配器和 Topology 核心不得按医院、楼梯、消防设施等业务含义分支。

### 7.2 Layer

| 字段 | 类型 | 必填 | 编译目标 |
|---|---|---:|---|
| `id` | string | 是 | `TopologyLayerInput.id` |
| `label` | string | 否 | 同名字段 |
| `order` | finite number | 否 | 同名字段，仅描述 |
| `elevation` | finite number | 否 | 同名字段，仅描述 |
| `tags` | string[] | 否 | 同名字段 |
| `data` | object | 否 | 同名字段 |

### 7.3 Node

| 字段 | 类型 | 必填 | 约束/编译目标 |
|---|---|---:|---|
| `id` | string | 是 | `TopologyGraphNodeInput.id` |
| `layerId` | string | 是 | 必须引用现有 layer |
| `assetId` | string | 是 | 必须引用已验证 asset；不直接进入 SSP |
| `position` | `{x,y,z}` | 是 | asset-local finite numbers；转换为 world-space `position` |
| `label` | string | 否 | 同名字段 |
| `kind` | string | 否 | 同名不透明字段 |
| `subtype` | string | 否 | 同名不透明字段 |
| `tags` | string[] | 否 | 同名字段 |
| `data` | object | 否 | 同名字段；建议记录来源 `sid` 等可追溯信息 |

sidecar node 不直接声明 `connectorId`。connector 身份只由 `connectors[]` 提供，编译器校验后再写入 `TopologyGraphNodeInput.connectorId`，避免两个事实源漂移。

### 7.4 Edge 与 ViaPoint

| 字段 | 类型 | 必填 | 约束/编译目标 |
|---|---|---:|---|
| `id` | string | 是 | `TopologyGraphEdgeInput.id` |
| `source` | string | 是 | 必须引用现有 node，且不能等于 `target` |
| `target` | string | 是 | 必须引用现有 node |
| `relation` | enum | 是 | `LINK` 或 `CONNECTOR` |
| `direction` | enum | 是 | `FORWARD` 或 `BIDIRECTIONAL` |
| `path` | object | 否 | 若存在，`type` 固定为 `POLYLINE`，`via` 是必填数组且最多 64 项 |
| `weight` | non-negative number | 否 | 路由基础成本；省略时由 SSP 使用 world-space 几何长度 |
| `initialState` | object | 否 | 只允许 `enabled` 和 `weightOverride`，两者均可省略 |
| `mode` | string | 否 | 同名不透明字段 |
| `tags` | string[] | 否 | 同名字段 |
| `data` | object | 否 | 同名字段 |

每个 via point 必须显式携带坐标所属资产：

```json
{
  "assetId": "scene-a/floor-1",
  "position": { "x": 2.0, "y": 0.0, "z": 1.5 }
}
```

完整折线由 world-space `source.position → transformed via → target.position` 组成。相邻点不得相同或近似相同，整条边必须具有有效长度，总 segment 数不得超过 20,000。

`initialState` 不允许直接包含 `blockerIds`；blocker 的唯一事实源是顶层 `blockers[]`。

`initialState.enabled` 必须是 boolean。`initialState.weightOverride` 必须是 `null` 或有限非负数；`null` 表示使用 edge 的基础 weight。负数、NaN、Infinity、字符串或其他类型必须在 commit 前返回 `SIDECAR_FIELD_INVALID`。

### 7.5 Connector

每个 connector 结构如下：

| 字段 | 类型 | 必填 | 约束 |
|---|---|---:|---|
| `id` | string | 是 | 稳定 connector 身份；编译为相关 node 的 `connectorId` |
| `nodeIds` | string[] | 是 | 至少两个不重复 node，且必须跨至少两个 layer |
| `edgeIds` | string[] | 是 | 至少一条不重复 edge |
| `label` | string | 否 | 仅供适配器诊断/来源追踪；不成为独立 SSP 实体 |
| `tags` | string[] | 否 | 仅供适配器诊断/来源追踪；不参与连边 |
| `data` | object | 否 | 仅供适配器诊断/来源追踪；不参与连边 |

connector 不自动生成边。所有端点对必须已经在 `edges[]` 中以明确的 source/target、方向和几何声明。

所有 connector 的 `nodeIds` 与 `edgeIds` 合计不得超过 20,000 个引用。

编译器必须验证：

1. 端点跨 layer 的 edge 必须为 `CONNECTOR`，且必须被恰好一个 connector 的 `edgeIds` 引用。
2. 同层 edge 必须为 `LINK`，不得出现在任何 connector 的 `edgeIds` 中。
3. 被 connector 引用 edge 的两个端点都必须在该 connector 的 `nodeIds` 中。
4. connector 的每个 `nodeId` 必须是至少一条已列 `edgeId` 的端点，不能声明未参与显式连接的成员。
5. 同一个 node 在 v1 中最多属于一个 connector。
6. connector 的所有 node 编译为相同且非空的 `connectorId`。

### 7.6 Blocker

每个 blocker 结构如下：

| 字段 | 类型 | 必填 | 约束 |
|---|---|---:|---|
| `id` | string | 是 | 稳定且唯一的不透明 blocker 身份 |
| `active` | boolean | 是 | 是否作为初始 blocker 生效 |
| `edgeIds` | string[] | 是 | 至少一条不重复、已存在的 edge |
| `label` | string | 否 | 仅供适配器诊断/来源追踪；不成为独立 SSP 实体 |
| `kind` | string | 否 | 仅供适配器诊断/来源追踪；不参与业务推断 |
| `tags` | string[] | 否 | 仅供适配器诊断/来源追踪 |
| `data` | object | 否 | 仅供适配器诊断/来源追踪 |

编译器按 edge 收集所有 `active: true` 的 blocker ID，排序去重后写入该 edge 的 `initialState.blockerIds`。`active: false` 的 blocker 仍需通过引用校验，但不进入初始 blockerIds。

blocker 只能显式影响 `edgeIds` 指定的边。不得根据墙体、门、距离、名称、`renderType`、`kind` 或其他行业语义自动创建或扩散 blocker。

所有 blocker 的 `edgeIds` 合计不得超过 20,000 个引用；同一 edge 初始最多由 64 个 active blocker 阻断。

## 8. 编译到 `TopologyGraphInput`

### 8.1 映射

| sidecar v1 | `TopologyGraphInput` |
|---|---|
| `graphId` | `id` |
| `layers[]` | 直接复制为 `layers[]` |
| `nodes[]` | 去除 `assetId`；position 转为 world-space；从 connector 映射补入 `connectorId` |
| `edges[]` | 引用与几何验证后复制；via 转为 world-space |
| `connectors[]` | 不作为新 SSP 实体；编译为 node `connectorId` 与显式 `CONNECTOR` edge 约束 |
| `blockers[]` | 不作为新 SSP 实体；active blocker 编译为 edge `initialState.blockerIds` |
| `assets[]` | 不进入 Topology 结构；只用于绑定、transform 与来源诊断 |
| `tags` / `data` | 复制到 graph；适配器可以增加不冲突的来源追踪信息 |

### 8.2 原子编译顺序

适配器必须按以下顺序执行：

1. 读取并解析 JSON。
2. 校验 `schema`、sidecar `schemaVersion` 和封闭字段结构。
3. 校验所有 ID、引用、connector、blocker、几何与容量限制。
4. 解析并核验全部 GLB asset bindings。
5. 更新各资产 `matrixWorld`，把 node 和 via point 恰好转换一次到 world-space。
6. 在内存中生成完整 `TopologyGraphInput`。
7. 再次检查当前请求 generation/token。
8. 仅在前述步骤全部成功后调用一次 `ssp.topologyTool.createGraph(input)`。
9. 验证返回 snapshot 的 `id === graphId` 且当前 topology snapshot schema 为受支持版本。

不得边解析边调用 SSP，不得提交部分 graph，也不得在失败时用 GLB extras 或应用 seed 补齐。`createGraph` 抛出的 `TopologyError` 必须保留原始 code/path/details 并包装为 sidecar commit diagnostic。

合法图上的 `NO_PATH` 是寻路结果，不是 sidecar 编译失败；不得把两者混为同一错误。

### 8.3 继承的 SSP 限制

sidecar v1 编译器必须在 commit 前检查至少以下当前限制：

- UTF-8 sidecar 源文本最多 8 MiB。
- 一张图最多绑定 128 个 assets、2,000 个 connectors、5,000 个 blockers。
- 一张图最多 32 layers。
- 一张图最多 2,000 nodes。
- 一张图最多 5,000 edges。
- 每条 edge 最多 64 个 via points。
- 一张图最多 20,000 segments。
- 每个 ID 最长 160 字符。
- 每个 tags 数组最多 64 项；connector/blocker 引用总量各最多 20,000；每条 edge 最多 64 个 active blockers。
- 每个 `data` 字段最多 16 层、4,096 个 JSON 节点、单容器 1,024 个成员和 4,096 字符的值/键。
- 相邻折线点距离必须大于 `1e-6`。

这些是 R1 编译目标的当前限制，不等于永久产品上限。未来 SSP 契约变化时应通过新的适配器兼容审查处理，不能静默放宽 sidecar v1 reader。

## 9. Fail-closed diagnostics

### 9.1 诊断结构

任何 sidecar 失败都必须产生可结构化记录的 diagnostic：

```json
{
  "code": "SIDECAR_ASSET_BINDING_MISMATCH",
  "phase": "BIND",
  "message": "asset digest does not match the loaded GLB",
  "path": "/assets/0/digest/value",
  "sidecarUri": "/models/fixture-a/topology.v1.json",
  "assetId": "fixture-a/floor-1",
  "entityId": null,
  "details": {
    "algorithm": "SHA-256"
  }
}
```

`path` 使用 JSON Pointer；`message` 必须可供用户理解但不能泄露凭据、完整本地路径或不必要的原始数据。`phase` 取值为 `DISCOVER`、`PARSE`、`VALIDATE`、`BIND`、`TRANSFORM`、`COMPILE`、`COMMIT` 或 `LIFECYCLE`。

### 9.2 最低诊断码

| Code | 触发条件 |
|---|---|
| `SIDECAR_NOT_FOUND` | 当前 R1 场景的 sidecar 不存在 |
| `SIDECAR_JSON_INVALID` | JSON 无法解析 |
| `SIDECAR_SCHEMA_UNSUPPORTED` | schema 名称或版本不受支持 |
| `SIDECAR_FIELD_INVALID` | 字段缺失、类型错误、未知结构字段或数值非法 |
| `SIDECAR_DUPLICATE_ID` | 任一实体命名空间内 ID 重复 |
| `SIDECAR_REFERENCE_BROKEN` | layer/node/edge/asset 引用不存在 |
| `SIDECAR_ASSET_NOT_LOADED` | sidecar 资产没有恰好一个已加载实例 |
| `SIDECAR_ASSET_BINDING_UNVERIFIABLE` | digest/revision 无可信观测值可核验 |
| `SIDECAR_ASSET_BINDING_MISMATCH` | URI、digest 或 revision 不匹配 |
| `SIDECAR_PARTIAL_SCENE` | sidecar 要求的多 GLB 场景只加载了部分资产 |
| `SIDECAR_COORDINATE_INVALID` | 坐标、矩阵或 world transform 结果无效 |
| `SIDECAR_CONNECTOR_INVALID` | connector 成员、edge、layer 或唯一性约束失败 |
| `SIDECAR_BLOCKER_INVALID` | blocker 结构或 edge 引用失败 |
| `SIDECAR_LIMIT_EXCEEDED` | 超出当前编译目标容量限制 |
| `SIDECAR_REQUEST_STALE` | 请求在完成前已被新选择或卸载失效 |
| `SIDECAR_GRAPH_COMMIT_FAILED` | `createGraph` 拒绝已编译输入或 context/commit 失败 |

### 9.3 失败语义

除 `SIDECAR_REQUEST_STALE` 这种预期取消外，任何 diagnostic error 都必须：

- 阻止当前 sidecar 调用 `createGraph`，或移除本次竞态中刚提交的 graph。
- 保证当前 sidecar 没有 route、edge visual 或半成品 graph 残留。
- 禁用或拒绝依赖该 graph 的 Quick Action / 受控模板，并向 UI 提供可诊断失败。
- 不回退到 GLB extras、应用 seed 或按语义自动补图。

模型本身可以保持可见并显示“topology 不可用”；fail closed 针对的是 topology 能力，不要求因 sidecar 错误销毁已经安全加载的模型。

## 10. 模型切换、取消与资源生命周期

### 10.1 每次选择的 generation

每次模型/场景选择必须产生单调递增的 generation 或唯一 request token，并为 sidecar fetch 使用可取消信号。Abort 只用于尽早停止工作；token 检查才是防止迟到结果提交的权威门禁。

所有异步边界之后、world transform 之前、`createGraph` 之前和 commit 之后都必须检查 token。迟到请求不得：

- 把旧 graph 写回当前 manager。
- 创建或渲染 route。
- 覆盖当前模型的 loading/error 状态。
- 触发 fit camera、视角捕获或受控模板。

如果 token 在 graph commit 后立即失效，集成层必须立刻移除该 graph，并把结果按 `SIDECAR_REQUEST_STALE` 处理。

### 10.2 切换与卸载顺序

模型切换、空选择、视图卸载或 context 销毁必须按以下顺序执行：

```text
使当前 model/sidecar request token 失效并触发 abort
→ ssp.topologyTool.removeAllRoutes()
→ ssp.topologyTool.removeAllGraphs()
→ 如宿主使用 legacy topology，再调用 ssp.topologyTool.removeAll()
→ ssp.modelTool.unloadAll() 或对应精确卸载
→ 开始加载新模型
→ 验证完整资产集合
→ 加载、编译并原子提交新 sidecar
```

`topologyTool.removeAll()` 只负责 legacy 静态 topology，不得替代 `removeAllRoutes()` 或 `removeAllGraphs()`。虽然删除 graph 会级联清理其 route，R1 仍要求显式调用两项 v2 清理 API，使调用意图、返回计数和验收证据清晰。

清理完成后必须满足：

- `listRoutes()` 为空。
- `listGraphs()` 为空。
- route flow 停止，Three.js root 已 detach，geometry/material/texture 已释放。
- 旧 graph ID 可以由新选择安全重新使用，不会与残留记录冲突。

多 GLB scene 只要任一 sidecar 引用资产加载失败，topology 即视为 `SIDECAR_PARTIAL_SCENE`；不得用已成功的部分资产生成降级图，除非未来新版本显式定义分片行为。

## 11. 完整 JSON 示例

下面示例描述两个 GLB 楼层、一条显式跨层 connector 和一个当前未激活的 blocker。摘要是格式示例，不对应仓库真实资产。

```json
{
  "schema": "space-ai-platform/topology-sidecar",
  "schemaVersion": 1,
  "revision": "fixture-a-2026-08-21.1",
  "graphId": "fixture-a/navigation",
  "coordinateSpace": "ASSET_LOCAL",
  "unit": "meter",
  "upAxis": "Y",
  "assets": [
    {
      "assetId": "fixture-a/floor-1",
      "uri": "./floor-1.glb",
      "digest": {
        "algorithm": "SHA-256",
        "value": "1111111111111111111111111111111111111111111111111111111111111111"
      }
    },
    {
      "assetId": "fixture-a/floor-2",
      "uri": "./floor-2.glb",
      "digest": {
        "algorithm": "SHA-256",
        "value": "2222222222222222222222222222222222222222222222222222222222222222"
      }
    }
  ],
  "layers": [
    {
      "id": "fixture-a/layer-1",
      "label": "Level 1",
      "order": 1,
      "elevation": 0
    },
    {
      "id": "fixture-a/layer-2",
      "label": "Level 2",
      "order": 2,
      "elevation": 4
    }
  ],
  "nodes": [
    {
      "id": "fixture-a/entry",
      "layerId": "fixture-a/layer-1",
      "assetId": "fixture-a/floor-1",
      "position": { "x": 0, "y": 0, "z": 0 },
      "kind": "ENTRY"
    },
    {
      "id": "fixture-a/vertical-1",
      "layerId": "fixture-a/layer-1",
      "assetId": "fixture-a/floor-1",
      "position": { "x": 8, "y": 0, "z": 0 },
      "kind": "WAYPOINT"
    },
    {
      "id": "fixture-a/vertical-2",
      "layerId": "fixture-a/layer-2",
      "assetId": "fixture-a/floor-2",
      "position": { "x": 8, "y": 0, "z": 0 },
      "kind": "WAYPOINT"
    },
    {
      "id": "fixture-a/goal",
      "layerId": "fixture-a/layer-2",
      "assetId": "fixture-a/floor-2",
      "position": { "x": 14, "y": 0, "z": 2 },
      "kind": "GOAL"
    }
  ],
  "edges": [
    {
      "id": "fixture-a/edge-entry-vertical",
      "source": "fixture-a/entry",
      "target": "fixture-a/vertical-1",
      "relation": "LINK",
      "direction": "BIDIRECTIONAL",
      "path": {
        "type": "POLYLINE",
        "via": [
          {
            "assetId": "fixture-a/floor-1",
            "position": { "x": 4, "y": 0, "z": 1 }
          }
        ]
      }
    },
    {
      "id": "fixture-a/edge-vertical",
      "source": "fixture-a/vertical-1",
      "target": "fixture-a/vertical-2",
      "relation": "CONNECTOR",
      "direction": "BIDIRECTIONAL",
      "mode": "VERTICAL"
    },
    {
      "id": "fixture-a/edge-vertical-goal",
      "source": "fixture-a/vertical-2",
      "target": "fixture-a/goal",
      "relation": "LINK",
      "direction": "BIDIRECTIONAL",
      "initialState": {
        "enabled": true,
        "weightOverride": null
      }
    }
  ],
  "connectors": [
    {
      "id": "fixture-a/connector-vertical",
      "nodeIds": [
        "fixture-a/vertical-1",
        "fixture-a/vertical-2"
      ],
      "edgeIds": [
        "fixture-a/edge-vertical"
      ],
      "label": "Vertical connector"
    }
  ],
  "blockers": [
    {
      "id": "fixture-a/blocker-maintenance",
      "active": false,
      "edgeIds": [
        "fixture-a/edge-vertical-goal"
      ],
      "kind": "TEMPORARY_CLOSURE"
    }
  ],
  "tags": ["r1-fixture"],
  "data": {
    "description": "Carrier-neutral R1 topology fixture"
  }
}
```

编译后，两个 connector node 的 `connectorId` 都是 `fixture-a/connector-vertical`；当 blocker 的 `active` 改为 `true` 时，`fixture-a/edge-vertical-goal.initialState.blockerIds` 包含 `fixture-a/blocker-maintenance`。

## 12. R1 验收矩阵

| ID | 场景 | 必须结果 | 证据类型 |
|---|---|---|---|
| S1 | `schemaVersion: 1` 合法文档 | 编译成功；返回 topology snapshot schema v2；两个版本不混用 | 契约测试 |
| S2 | 未知 schema、未知版本或未知结构字段 | `SIDECAR_SCHEMA_UNSUPPORTED` 或 `SIDECAR_FIELD_INVALID`；不创建 graph | 契约测试 |
| A1 | digest 绑定正确 | 资产绑定通过 | 契约/集成测试 |
| A2 | digest、revision、URI 任一不匹配 | fail closed；无 graph/route | 契约/集成测试 |
| A3 | 多 GLB scene 缺失一个被引用资产 | `SIDECAR_PARTIAL_SCENE`；不得生成部分图 | 集成测试 |
| A4 | 缺少同响应/不可变包 AssetProof，或仅重新请求同一可变 URI | `SIDECAR_ASSET_BINDING_UNVERIFIABLE`；不得退化成 URL-only 绑定 | 契约/集成测试 |
| C1 | 非 identity 平移、旋转和缩放的资产根 | node 与 via 只转换一次，数值等于预期 world-space | 数值单元测试 |
| C2 | NaN、Infinity、无效矩阵或错误 assetId | `SIDECAR_COORDINATE_INVALID` 或引用错误 | 契约测试 |
| G1 | 两个相互独立、非医院硬编码 fixture | 均生成有效图，ID/语义无项目特例 | 契约测试 |
| G2 | 有路径且 blocker inactive | `findPath` 成功，route world points 正确 | 集成测试 |
| G3 | blocker active 或显式 disabled edge | 返回结构化无路结果，不是编译错误 | 集成测试 |
| G4 | 合法跨层 connector | 两端同 connectorId，只有显式 CONNECTOR edge 可跨层 | 契约/核心回归 |
| G5 | connector 缺端点、跨层不匹配或 edge 未归属 | `SIDECAR_CONNECTOR_INVALID`；不创建 graph | 契约测试 |
| G6 | blocker 引用缺失 edge | `SIDECAR_BLOCKER_INVALID`；不创建 graph | 契约测试 |
| G7 | 重复 ID、断引用、self-loop、零长度或超限 | 对应结构化 diagnostic；不创建部分 graph | 契约测试 |
| G8 | 跨层 `LINK`、同层 `CONNECTOR` 或 connector 未唯一归属 | `SIDECAR_CONNECTOR_INVALID`；在 commit 前失败 | 契约测试 |
| G9 | 空/超长 SSP 字符串、重复 tag、非法 `weightOverride` | `SIDECAR_FIELD_INVALID`；在 commit 前失败 | 契约测试 |
| L1 | 快速切换 A→B，A 的 sidecar 迟到 | A 不得提交或污染 B；记录 stale cancellation | 并发集成测试 |
| L2 | 切换、空选择和视图卸载 | routes/graphs 均为 0，GPU/flow 资源释放，随后再卸载模型 | 集成测试 |
| L3 | 调用 legacy `removeAll()` 但未调用 v2 清理 | 测试明确证明它不能替代 `removeAllRoutes/removeAllGraphs` | 核心回归 |
| U1 | sidecar 缺失或非法 | 模型可保持显示；topology 操作禁用并显示可诊断反馈；不使用 seed fallback | 浏览器 P0 |
| U2 | Quick Action / 受控模板触发 | 完成“触发→固定受控工作流→Registry/Template Runtime→Topology→Three.js route→清除”闭环；AI 不直接调用 SSP | 浏览器 P0 / 边界审计 |
| B1 | 本地生产构建与验收命令 | 执行前后 `src/model-manifest.json` 内容和工作区状态不变 | 非污染 gate |
| B2 | 类型、Topology 回归和边界审计 | 全部通过；适配器不进入 `src/ssp/**`，无行业推断 | 类型检查 / 回归 / 审计 |

R1 只有在矩阵中适用的自动化、浏览器 P0、架构复核和独立 QA 证据齐全后，才能进入产品验收。

## 13. 变更控制与非目标

以下内容不属于 sidecar v1：

- GLB `extras.topology` 的 schema、注入和读取。
- 产品路径中的应用 seed、自动补图或几何/行业语义推断。
- 多图 sidecar、跨 sidecar connector、远端资产服务或生产 CDN 协议。
- 账号权限、服务端持久化、生产部署或完整 Template Phase 2。
- 修改 `src/ssp/**` 以解析 GLB、sidecar 或业务 blocker。

R1 实现发现本契约无法在不修改 `src/ssp/**` 的情况下落地时，必须停止并向 `space AI platform产品经理-项目总控` 报告范围、影响和验证方案；不得把适配逻辑临时塞入 Topology 核心。

若未来要把 sidecar 宣布为永久唯一格式、增加正式新载体或改变公共数据语义，必须作为新的长期架构决策处理。本契约在 R1 内保持可逆：输入载体与运行时 `TopologyGraphInput` 之间始终由明确适配器隔离。

sidecar v1 是 Space AI Platform 已冻结的版本化输入接口，不等于 Studio 的 embedded v1。任何一方都不得通过复制、重命名或字段猜测把二者冒充为同一 schema，也不得在 `schemaVersion: 1` 下静默改变字段、枚举、坐标、发现、引用或资产绑定语义。收敛时必须执行双端影响评估、发布明确的新 schema/version 或完全遵循既有 v1、提供共同 golden fixture 和迁移/回滚方案，并取得用户对重大或破坏性变化的明确批准。
