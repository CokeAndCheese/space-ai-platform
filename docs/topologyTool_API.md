# topologyTool API 与内部设计

最后更新：2026-08-10

封版口径：`topologyTool` 共 23 个 callable 方法，分为 7 个 legacy 静态图方法
和 16 个 v2 路网/寻路/路线方法。`src/templates/ssp_templates/topology/` 对应
23 个原子模板，全部 `aiEnabled:false`；AI 只能通过上层组合模板间接使用这些能力。

## 设计边界

`ssp.topologyTool` 是 topology 模块唯一的运行时门面。项目只创建一次
`createTopologyTool()`，模板层再组合门面上的原子方法。

这里的“原子”指运行时操作职责，而不是要求每个操作都成为 ES module 顶层
named export。工厂只负责把同一实例的图状态、路线资源和动画生命周期绑定起来；
模板实际面对的是 `ssp.topologyTool.createGraph()`、`findPath()`、`renderRoute()`
等独立方法。这些方法不依赖 `this`，可直接按需组合。`createTopologyTool()`
每调用一次都会得到状态隔离的 manager；`src/ssp/index.ts` 的 `ssp` 单例只创建一次，
因此页面内模板共享同一 topology 实例。

- topology 只依赖 `three`、`ssp/core/context` 和 `topology/**` 自身文件。
- 不导入或调用 model、objects、camera、poi、AI、store 或 templates。
- 不扫描 BIM，不推断门、窗、墙、楼梯或设备之间的关系。
- `kind / subtype / mode / tags / data` 可被业务读取，但内部算法不解释。
- 墙、关闭门、烟火区等障碍由业务适配层转换为纯字符串 `blockerIds`。
- 跨层边只接受通用约束：`CONNECTOR`，且两端 `connectorId` 相同且非空。
  “这个 connector 是楼梯还是电梯”由业务建图层决定。

```text
AI
  -> 高层业务模板
     -> ssp.topologyTool 原子方法
        -> 纯数据图 / 精确寻路
        -> Three.js 边段与路线渲染
```

## Export 接口

### 工厂

| Export | 含义 |
|---|---|
| `createTopologyTool(): TopologyTool` | 创建一个状态隔离的 manager；闭包持有图索引、渲染资源和唯一 flow 循环。项目顶层只创建一个实例。 |
| `TopologyError` | 非法输入、断引用、容量、context 或渲染错误。合法但无路径使用 `TopologyPathResult`，不抛异常。 |
| `types.ts` 中的 type/interface | 图输入、快照、状态补丁、寻路结果和路线渲染的 TypeScript 契约。 |

内部的 `createGraphManager / findPathInGraph / createTopologyRenderer` 不从
`src/ssp/index.ts` 暴露，也不能被其他 SSP 模块调用。

### Legacy 静态图（兼容）

| 方法 | 含义 |
|---|---|
| `create` | 根据显式 nodes/edges 创建 manual、grid 或 hierarchical 静态图。 |
| `show` / `hide` | 修改整张 legacy 图的可见性。 |
| `getById` / `list` | 查询当前 context 中仍有效的 legacy 句柄。 |
| `remove` / `removeAll` | 只释放 legacy 图；不会隐式修改 v2 图或路线。 |

### 路网图

| 方法 | 含义 |
|---|---|
| `createGraph(input)` | 校验并创建纯数据图，不要求 Three.js context。结构创建后不可变。 |
| `getGraph(id)` | 返回 detached plain-value 快照；STAIR、FACILITY 等 opaque metadata 可在这里读取。 |
| `listGraphs()` | 返回全部图快照。 |
| `removeGraph(id)` | 删除图，并级联释放其可见边和已渲染路线。 |
| `removeAllGraphs()` | 删除全部 v2 图，并按图所有权级联释放关联的可见边和路线。 |

`createGraph` 的每条边都有稳定 ID。几何长度只根据
`source.position -> path.via -> target.position` 计算；调用方只能另行提供业务
`weight`，不能覆盖 `length`。

### 边状态

| 方法 | 含义 |
|---|---|
| `setEdgeRoutingState(graphId, selector, patch, guard?)` | 原子修改 enabled、weightOverride、blockerIds。有效变化增加 routingRevision，并让旧路线 stale。 |
| `setEdgeVisualState(graphId, selector, patch, guard?)` | 修改任意边段的 visible、color、width、opacity、depthTest、flow。只增加 visualRevision，不影响寻路。 |

`selector` 必须明确写成 `{ edgeIds: [...] }` 或 `{ all: true }`。视觉隐藏的边仍可
参与寻路；可见但被 blocker 禁用的边仍可用于展示障碍诊断。

### 寻路

| 方法 | 含义 |
|---|---|
| `findPath(query)` | 运行精确的 constrained Dijkstra，返回自包含路线快照或结构化无路结果。 |

每个 `requirements[i].anyOfNodeIds` 是一组 OR；不同组之间是 AND。内部状态为
`(nodeId, satisfiedRequirementMask)`，因此消防场景可把所有消火栓节点作为一组，
求“入口到火点且至少经过一个消火栓”的全局最短路线，无需贪心拆段。

最多支持 4 个必经组。10 层以内的图可以使用同一算法；只要跨层连接由显式
connector 边组成，结果就必然经过这些连接器。

### 路线渲染

| 方法 | 含义 |
|---|---|
| `renderRoute(options)` | 把 `findPath` 的折线按真实方向叠加到当前 Three.js 模型；默认 `depthTest=true`。 |
| `setRouteVisualState(id, patch)` | 修改已渲染路线的颜色、宽度、透明度、深度测试、flow 或可见性。 |
| `showRoute` / `hideRoute` | 显示或隐藏非 stale 路线。 |
| `getRouteById` / `listRoutes` | 查询当前 context 中的路线句柄。 |
| `removeRoute` / `removeAllRoutes` | 释放路线 GPU 资源。 |

边 flow 与 route flow 分离：边 flow 以 edge source/target 为方向，route flow 始终按
实际行进方向。全部活动 flow 共用一个 requestAnimationFrame。

## Function 结构与流转

```text
createTopologyTool
  |-- legacy create/show/hide/get/list/remove
  |-- createGraphManager
  |     |-- normalizeGraph
  |     |     |-- normalizeLayer / normalizeNode / normalizeEdge
  |     |     `-- build node/edge index + directed adjacency
  |     |-- setEdgeRoutingState -> invalidateRoutes
  |     |-- setEdgeVisualState  -> syncEdgeVisuals
  |     `-- findPath -> findPathInGraph
  |                         |-- compileRequirements
  |                         |-- constrained Dijkstra + MinHeap
  |                         `-- reconstruct + orient points
  `-- createTopologyRenderer
        |-- syncEdgeVisuals -> cylinders + optional flow markers
        |-- renderRoute     -> route overlay + optional flow markers
        |-- shared tick / registerFlow / unregisterFlow
        `-- dispose route/edge GPU resources
```

## Export 方法与内部函数关系

| Export 方法 | 主要内部函数 |
|---|---|
| `createGraph` | `normalizeGraph`, `normalizeLayer`, `normalizeNode`, `normalizeEdge`, `polylineLength` |
| `getGraph/listGraphs` | `snapshotGraph`, `snapshotEdge`, `routingSnapshot` |
| `setEdgeRoutingState` | `selectedEdges`, `normalizeRoutingPatch`, `routingStatesEqual`, renderer `invalidateRoutes` |
| `setEdgeVisualState` | `selectedEdges`, `normalizeVisualPatch`, `visualStatesEqual`, renderer `syncEdgeVisuals` |
| `findPath` | `compileRequirements`, `search`, `MinHeap`, `reconstruct`, `orientedPoints` |
| `renderRoute` | `normalizeRouteOptions`, `styleForStep`, `buildRouteVisual`, `addPolyline`, `createFlowTrack` |
| `setRouteVisualState` | `normalizeStyle`, `normalizeRouteFlow`, `rebuildRoute` |
| `showRoute/hideRoute` | `setRouteVisible`, `currentRoute` |
| `remove*` | `disposeRoute`, `disposeBuild`, `disposeResources`, `removeGraphVisuals` |

这些内部函数即使因文件拆分使用 TypeScript `export`，也只属于
`src/ssp/topology/internal/**` 的实现协议，不是 SSP public API。

## 业务层示例

```ts
const graph = ssp.topologyTool.getGraph('hospital-nav')
if (!graph) throw new Error('navigation graph is missing')

const hydrantIds = graph.nodes
  .filter((node) => node.kind === 'FACILITY' && node.subtype === 'HYDRANT')
  .map((node) => node.id)

const result = ssp.topologyTool.findPath({
  graphId: graph.id,
  startNodeId: 'entry-a-1f',
  goalNodeId: 'fire-a-6f',
  requirements: [{ anyOfNodeIds: hydrantIds }],
})

if (result.ok) {
  ssp.topologyTool.renderRoute({
    route: result.route,
    style: { color: '#ff3b30', width: 0.14 },
    flow: { active: true, speed: 2.5 },
  })
}
```

模型 SID、墙面相交计算、消火栓筛选和着火点解析都应在高层 adapter/template 中
完成。topology 只接收已经可信的节点、边、connector 和 blocker 状态。

## 封版验证

在仓库根目录运行以下检查：

```bash
npm run audit:templates
npm run audit:ai-boundary
npm run audit:topology-boundary
npm run test:topology
```

模板审计应报告 `79` 个 active、`0` 个 placeholder、`4` 个组合模板、`9` 个
AI enabled 且 `0` 个错误；topology 边界审计应 PASS，核心测试应 PASS。若只需
静态检查 API 边界，至少运行前三项。
