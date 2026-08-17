# Template Layer Design v3

> 状态：Phase 0 分类账与 Phase 1 v3 原子运行核已实现；Phase 2 组合与 lease capability 迁移待完成
> 日期：2026-08-17
> 目标：模板层严格由 SSP 能力组合，支持一一映射与组合模板，并作为 AI 唯一能力面。

## 1. 结论

模板层采用一个协议、两类模板、一个执行器：

- AI 只输出 `{ "action": "template", "templateId": "...", "params": {} }`。
- 原子模板（`atomic`）与一个公开 SSP 方法一一映射。
- 组合模板（`composite`）只能引用已注册模板，不得直接执行 JavaScript。
- Template Runtime 解释声明式模板，所有有效执行路径最终只能到达 SSP。
- SSP 仍是能力底座；模板层只做参数约束、能力编排、风险控制和结果归一化，不复制 Three.js 或业务能力。

目标链路：

```text
User -> AI Parser -> Template Intent -> Template Registry
                                      -> Policy Gate
                                      -> Declarative Runtime
                                      -> atomic template -> one SSP method
                                      -> composite template -> templates -> SSP methods
                                      -> serializable result
```

此方案保留当前 AI/template 窄腰，同时移除自由 `code`、`window`、`THREE`、Store 和场景内部对象对模板层的渗透。

## 2. 现状梳理

### 2.1 SSP 能力面

CR-SSP-001/003 合入后的最终 SSP 能力面为：

- 10 个 controller，85 个 controller 方法；
- 4 个 context 函数；
- `cameraController.controls` 属性；
- 仅用于 TypeScript 的 `__types` 占位。

其中新增 `objectsTool.query/describe/applyHighlight/releaseHighlight` 四个公共方法。Phase 0 生成器允许隔离模板工作树在上游 SSP 合入前扫描到 81 个方法、合入后扫描到 85 个方法，并拒绝只出现部分新增方法的 82～84 半同步状态；生成清单会明确区分“当前 checkout 实际源码”与“主任务实施交接”，不会合成不存在于当前源码的能力。

模板可绑定的公共能力以 `SspNamespace` 导出的 controller 方法为准。以下成员不属于模板能力面：

- `setContext`、`getContext`、`hasContext`、`clearContext`：宿主生命周期能力；
- `cameraController.controls`：底层可变控制器；
- `__types`：没有运行时能力；
- `src/ssp/**/internal`、controller factory 和未从 `ssp/index.ts` 导出的函数。

### 2.2 当前模板与 AI 链路

当前 v2 兼容目录有 79 个 active JSON、4 个带 `steps` 的组合模板、8 个 `aiEnabled:true` 模板；v3 已有 4 个 atomic，其中 `resetVisibility` 以同 ID 面向 AI。实际 AI 链路为：

```text
Chat -> fallback/cache/LLM -> Intent -> one-step Plan
     -> PlanExecutor -> v3-first templateRuntime
        -> migrated id: static atomic dispatch -> SSP
        -> unmigrated id: isolated legacy compiler -> SSP
```

已成立的边界：

- AI 只能选择统一 Registry 中显式开放的模板；
- Intent 和 Runtime 都会校验 AI 白名单；
- `src/ai` 不直接导入 SSP；
- 模板参数会在执行前校验。

尚未成立的边界：

1. `steps` 只被审计引用是否存在，Runtime 并不执行它；组合模板的真实行为仍来自 `code`。
2. `code` 是可执行 JavaScript，并被注入 `ssp`、`THREE`、`params`，无法静态证明只调用 SSP。
3. `captureMainViewpoint`、`flyToMainViewpoint` 依赖 `window.__chatStore`；`help` 不调用 SSP。
4. `query-scene` 直接读取 `ssp.getContext().scene`、遍历 Object3D、过滤 metadata，并包含定时器和业务分支，已超出“SSP 组合”。
5. 多个非 AI 模板声明参数却在 `code` 中使用写死示例值，元数据和实际行为不一致。
6. JSON `params` 与 `registry.ts` 中 AI Zod schema 是两套事实源。
7. `method` 是说明文本，审计不验证它与真实 SSP 调用或 TypeScript 签名一致。
8. `src/ai/skills` 又定义了一套 `skill -> template -> SSP` 组合协议，但没有进入当前主链路。

因此，当前系统是“AI 只能经模板触达 SSP”，还不是“模板严格由 SSP 组合”。

## 3. 设计原则与边界

### 3.1 唯一能力闭包

任一模板必须满足：

```text
atomic(template) = exactly one public SSP method
composite(template) = finite DAG of registered templates
closure(template) = only public SSP methods
```

禁止模板引用：

- 任意 JavaScript/TypeScript 源码；
- `window`、`document`、Store、网络 API、文件 API；
- `THREE`、Object3D 属性遍历、material/scene/renderer/controls；
- SSP context 管理函数、内部模块或未注册函数；
- 未声明的模板、动态模板名、动态方法路径；
- 任意回调函数参数。

若一个业务能力无法仅靠现有 SSP 方法组合，应先申请可复用的通用 SSP 能力，再建立原子模板。不得在模板中用代码绕过能力缺口。`objectsTool.query` / `objectsTool.describe` 已由主任务实施，因此 `query-scene` 的剩余工作是迁移为 `query -> describe` 或 `query -> action`，并删除 scene traversal、metadata 直读、timer 与自由业务分支。AI 输出的字段投影、脱敏、截断和最终序列化由模板 Runtime 负责。`group`、`compare`、`summarize` 不属于已实施 SSP 范围，也不得在模板中用自由代码补齐，需有新的通用性证据后另行评估。

### 3.2 模板不是第二套代码平台

组合 DSL 只提供一个固定、无副作用、不可扩展的控制核，不提供通用计算：

- 允许：顺序、并行、条件、有限集合映射、结果引用、失败策略、结果投影；
- 不允许：表达式求值、脚本、无限循环、递归模板、动态 import、任意对象属性访问。

复杂筛选、寻路和几何运算应由通用 SSP 方法负责。通用聚合是否属于 SSP 必须另有复用证据；在结论形成前，模板既不下沉行业语义到 SSP，也不引入自由聚合代码。这样模板可审计、可缓存、可解释，也不会逐渐演变成另一个 JavaScript runtime。

控制核必须以封闭 JSON Schema/AST 定义。以下 TypeScript 仅表达 v3 的完整语法集合，实际以对应的 `template-v3.schema.json` 为机器规范：

```ts
type InputRef = { $input: InputSchemaPath }
type PublicRef = { $ref: `steps.${StepId}.output.${OutputSchemaPath}` }
type InternalRef = { $internalRef: `steps.${StepId}.internal.${InternalSchemaPath}` }
type Literal = { $literal: JsonValue }

type PublicValue = InputRef | PublicRef | Literal
type StepInputValue = PublicValue | InternalRef

type Predicate =
  | { $exists: PublicRef | InternalRef }
  | { $equals: [PublicValue | InternalRef, Literal] }
  | { $not: Predicate }
  | { $all: Predicate[] }
  | { $any: Predicate[] }

interface Step {
  id: StepId
  use: StaticTemplateId
  with: Record<CalledTemplateInputField, StepInputValue>
  when?: Predicate
  forEach?: {
    items: PublicRef | InternalRef
    itemAs: StaticLocalName
    maxItems: PositiveInteger
    concurrency: PositiveInteger
  }
  onError?: 'stop' | 'continue' | { compensateWith: StaticTemplateId }
}

interface Flow {
  // 数组顺序就是 sequence 顺序；只有通过 forEach.concurrency 显式声明的调用可并行。
  steps: Step[]
  return: Record<DeclaredOutputField, PublicValue>
}
```

JSON 表面语法与上面的 AST 一一对应：`flow.steps`、`step.use`、`step.with`、`step.when`、`step.forEach`、`step.onError`、`flow.return` 以及 `$input/$ref/$internalRef/$literal/$exists/$equals/$not/$all/$any` 是 v3 允许的全部控制字段和节点；未列出的字段或节点一律构建失败。

- 节点集合只能通过 schema version 升级扩展，模板不能注册 evaluator 或函数；
- `path` 必须在对应 input/output schema 中静态解析，禁止动态属性名；
- `$literal` 只能是有界 JSON 值；`flow.return` 只能复制/重命名已声明字段，不做计算或聚合；
- `use`、`compensateWith`、`itemAs` 和所有对象 key 必须是构建期静态字符串；局部 item 只能替换被调用模板已声明的整个输入字段，不能作为动态路径片段；
- 控制核不得产生 SSP 未返回的业务数据，只能产生执行状态（如 `executed/skipped/failed`）和投影；
- 每个 composite 至少存在一条可达 atomic 路径；空 flow 和所有路径恒跳过的 flow 构建失败；
- AST 节点数、嵌套深度、map 数量和总调用预算均有构建期上限。

### 3.3 AI 面与执行面分离

`ai.exposed` 只控制 AI 能否选择模板，不改变模板能否在 Sandbox 或业务代码中执行。

- 原子模板默认 `ai.exposed:false`；
- 组合模板按业务语义和风险显式开放；
- AI 只看到名称、用途、输入 JSON Schema、结果摘要、风险提示和示例；
- AI 看不到 SSP 方法名、模板图、内部结果句柄和执行实现。

## 4. 模板模型

### 4.1 公共字段

```ts
interface TemplateBase {
  schemaVersion: 3
  id: string
  version: string
  kind: 'atomic' | 'composite'
  title: string
  description: string
  intents: string[]
  input: JsonSchema
  internalOutput?: JsonSchema
  output: JsonSchema
  effects: Effect[]
  risk: 'read' | 'visual' | 'state' | 'destructive' | 'external'
  ai: {
    exposed: boolean
    requiresConfirmation?: boolean
  }
  timeoutMs?: number
  tags?: string[]
  deprecated?: { replacedBy?: string; reason: string }
}
```

`input` 是参数校验、Prompt 生成、UI 表单和文档的唯一事实源。运行时由同一份 JSON Schema 编译校验器，不再手写第二套 Zod 表。

### 4.2 原子模板：一一映射

```json
{
  "schemaVersion": 3,
  "id": "camera.fit-scene",
  "version": "1.0.0",
  "kind": "atomic",
  "title": "适配场景视角",
  "description": "调整相机以容纳指定对象或当前场景",
  "intents": ["查看全景", "适配场景", "fit scene"],
  "input": {
    "type": "object",
    "properties": {
      "objects": { "type": "array", "items": { "$ref": "ssp://ObjectRef" } },
      "options": { "$ref": "ssp://FitSceneOptions" }
    },
    "additionalProperties": false
  },
  "internalOutput": { "$ref": "ssp-internal://FitSceneHandle" },
  "output": { "$ref": "ssp://FitSceneResult" },
  "effects": ["camera.write"],
  "risk": "visual",
  "ai": { "exposed": false },
  "call": {
    "method": "cameraController.fitScene",
    "args": [
      { "$input": "objects", "default": [] },
      { "$input": "options", "default": {} }
    ]
  }
}
```

原子模板约束：

- `call.method` 必须是静态字符串，并存在于生成的 SSP Capability Manifest；
- 每个模板只能有一个 `call`；
- `args` 只能引用输入或字面量默认值；
- 方法参数、返回值、同步/异步和 effect 必须与 Manifest 一致；
- Runtime 调用后同时形成可选 `internalOutput` 与必需 `output`：前者只在单次组合执行内传递受信任句柄，后者必须投影为可序列化数据；Object3D、Sprite、Group、DOM、controls 或回调不得进入 `output`。

一一映射是“一个原子模板只映射一个 SSP 方法”，不是“所有 SSP 方法都必须向 AI 开放”。合入后的 85 个 controller 方法应有完整覆盖账本，可按风险标记为：

- `mapped`：有原子模板；
- `host-only`：上下文、controls 等宿主能力，不建模板；
- `blocked`：回调、任意 URL、下载等当前不适合模板化；
- `deprecated`：只保留兼容信息。

### 4.3 组合模板：只组合模板

```json
{
  "schemaVersion": 3,
  "id": "object.focus-and-highlight",
  "version": "1.0.0",
  "kind": "composite",
  "title": "定位并高亮对象",
  "description": "按 sid 查找对象，飞向目标并高亮",
  "intents": ["定位对象", "聚焦构件", "查看对象详情"],
  "input": {
    "type": "object",
    "required": ["sid"],
    "properties": {
      "sid": { "type": "string", "minLength": 1 },
      "color": { "type": "string", "pattern": "^#[0-9A-Fa-f]{6}$", "default": "#FF5722" }
    },
    "additionalProperties": false
  },
  "output": {
    "type": "object",
    "required": ["found", "sid"],
    "properties": {
      "found": { "type": "boolean" },
      "sid": { "type": "string" }
    }
  },
  "effects": ["camera.write", "object.highlight"],
  "risk": "visual",
  "ai": { "exposed": true },
  "flow": {
    "steps": [
      {
        "id": "find",
        "use": "objects.get-by-id",
        "with": { "id": { "$input": "sid" } }
      },
      {
        "id": "fly",
        "use": "camera.fly-to-object",
        "when": { "$exists": "steps.find.internal.ref" },
        "with": { "object": { "$internalRef": "steps.find.internal.ref" } }
      },
      {
        "id": "highlight",
        "use": "objects.set-highlight",
        "when": { "$exists": "steps.find.internal.ref" },
        "with": {
          "object": { "$internalRef": "steps.find.internal.ref" },
          "color": { "$input": "color" }
        }
      }
    ],
    "return": {
      "found": { "$ref": "steps.find.output.found" },
      "sid": { "$input": "sid" }
    }
  }
}
```

组合模板约束：

- `use` 只能引用 Registry 中固定模板 id；
- 引用图必须无环，深度、step 数和 fan-out 有上限；
- step 输入必须通过被引用模板的 `input` 校验；
- `$ref` 只能访问被引用模板公共 `output` schema 声明的字段；`$internalRef` 只能访问 `internalOutput`，且不能出现在顶层 input、flow.return 或日志中；
- `when` 只支持 `exists`、`equals`、`not`、`all`、`any` 等有限谓词；
- `map` 只能迭代前序输出中的有界数组，并设置 `maxItems` 和 `concurrency`；v3 首版仅允许 `risk=read` 且 Manifest 标记 `parallelSafe:true` 的调用并行，其余调用强制按声明顺序串行；
- v3 首版默认遇错即停，仅 `read/visual` 且 SSP 明确提供 scoped inverse 的步骤可使用 `compensate`；补偿必须引用模板、绑定同一 execution scope，并按成功步骤逆序执行；
- `flow.return` 必须满足组合模板 `output` schema；
- Runtime 将组合模板的 effects/risk 计算为传递闭包，声明值不得低于计算值。

## 5. SSP Capability Manifest

Registry 不应再相信模板手写的 `method`、`signature`、`params` 和 `returns`。构建期从 `SspNamespace` 及 controller interface 生成：

```ts
interface SspCapability {
  method: string
  args: JsonSchema[]
  output: JsonSchema
  async: boolean
  effects: Effect[]
  serializable: boolean
  internalOutput?: JsonSchema
  publicProjection: JsonSchema
  resourceScopes: string[]
  parallelSafe: boolean
  inverse?: string
  templatePolicy: 'allowed' | 'host-only' | 'blocked'
  aiPolicy: 'never' | 'composite-only' | 'reviewable'
}
```

推荐落点：

```text
src/templates/
  manifest/ssp-capabilities.generated.json
  atomic/<namespace>/*.json
  composite/<domain>/*.json
  schema/template-v3.schema.json
  compiler/
  registry/
  runtime/
```

Manifest 是 SSP 到模板的一一映射事实源，并生成覆盖报告：

```text
SSP public methods = mapped + host-only + blocked + deprecated
unclassified = 0
atomic template with unknown method = 0
duplicate atomic binding = 0 (除显式 alias)
```

## 6. Runtime 与数据语义

### 6.1 执行阶段

1. Registry 解析并按 v3 schema 校验全部模板。
2. 构建模板依赖图，拒绝环、未知引用和越权 SSP 方法。
3. 根据输入 schema 校验并补默认值。
4. 将顶层 id 和全部依赖解析为不可变 Registry Snapshot，记录 registry revision、SSP Manifest digest、每个模板的 resolved version 与内容 digest。
5. 计算组合模板的实际 effects、risk、资源作用域、最大调用数和超时。
6. Policy Gate 检查 AI 暴露、确认要求、环境权限、资源冲突和调用预算。
7. 执行原子调用或组合 DAG；有状态调用串行，补偿按本次成功轨迹逆序执行。
8. 对公共结果进行 schema 投影、序列化和大小限制，并拒绝任何内部句柄残留。
9. 记录 snapshot、参数摘要、SSP 调用轨迹、耗时、结果、补偿与错误。

### 6.2 句柄与引用

部分 SSP 方法返回可变 Three.js 对象。原子调用采用双通道结果：

```ts
interface AtomicResult {
  internal?: unknown // 仅 Runtime 可见，并按 internalOutput 校验
  public: unknown    // 按 output/publicProjection 校验，可交给 AI
}
```

Runtime 可在单次执行上下文中把内部对象包装为不透明引用：

```ts
type ObjectRef = { readonly $refType: 'ssp-object'; readonly token: string }
```

- token 只在当前执行会话有效；
- ObjectRef 只能由 Runtime 创建；顶层 input 中出现 `$refType` 或 token 一律拒绝，防止伪造；
- AI、公共返回和日志只看到稳定 sid/id，不看到真实 token 或对象；
- Runtime 负责 token 与真实对象的映射；
- 数组 map 只复制包装后的 ObjectRef，不暴露或序列化原对象；
- 组合结束、取消或超时后释放全部临时引用；跨 execution context 解引用必须失败；
- 需要跨会话持久化时只保存 SSP 定义的稳定标识，再由 SSP 查询恢复。

`HighlightLease` 是控制能力而不是普通数据，必须使用更严格的 execution-local capability table：

```ts
type HighlightLeaseRef = {
  readonly $refType: 'ssp-highlight-lease'
  readonly token: string
}

interface HighlightLeaseCapability {
  readonly kind: 'highlight-lease'
  readonly handle: HighlightLease
  readonly release: () => boolean
}
```

- `objects.apply-highlight` 原子模板把 SSP 返回的原始 opaque handle 存入当前 execution 的 capability table，`internalOutput` 只返回 Runtime 创建的 `HighlightLeaseRef`；
- `objects.release-highlight` 的 lease 输入只能由同一 execution 的 `$internalRef` 绑定，顶层 params、AI、日志、公共输出和跨 execution snapshot 都不得携带该引用；
- Runtime 解引用后必须把原始 handle identity 直接交给 `objectsTool.releaseHighlight`，不能重建 `{ id }` 或只保存字符串 id；
- 每个 execution 最多持有 32 个活动租约；SSP 的 context 上限 128、单租约对象上限 256 仍由 SSP 强制；
- SSP 接受的 `durationMs` 为 100～300000ms，但 AI 可见模板 schema 必须进一步限制为不超过 60000ms；
- cancel、timeout、异常退出和正常 finally 都必须逐一释放仍活动的 execution-owned handle；重复释放按 SSP 幂等语义处理；
- 公共输出只投影 `{ applied, objectCount, expiresAt? }` 等有界回执，并在 schema 校验后执行脱敏、截断和序列化；
- `clearAllHighlights` 不得作为补偿或 AI 模板；它只保留为宿主紧急全局恢复能力。

### 6.3 版本与重放

LLM 协议保持 `templateId + params`，版本解析发生在 Intent 校验之后、执行之前：

- 每次执行生成不可变 Registry Snapshot；
- Snapshot 锁定顶层模板和完整传递依赖的 `id/version/contentDigest`，以及 SSP Manifest digest；
- Runtime 只使用 Snapshot，不在执行中按“当前 id”重新解析；
- 审计与 replay 保存 Snapshot id；历史 Snapshot 或模板内容缺失时明确失败，不静默使用最新版；
- 发布同一 `id@version` 的不同内容构建失败，内容变化必须升级版本。

### 6.4 副作用、资源与并发

建议 effects 最小集合：

```text
scene.read, scene.write, camera.write, object.highlight, object.visibility,
model.load, model.unload, topology.write, dom.write, download, timer, destructive
```

策略示例：

- `read`：可直接执行；
- `visual`：可直接执行，但必须可恢复或可重复；
- `state`：需要明确对象范围；
- `destructive`：AI 调用前二次确认；
- `external`：默认禁用，单独授权。

`sceneTool.clear/dispose`、`modelTool.unloadAll`、各类 `removeAll`、任意 URL 加载、截图下载和带任意回调的 POI 创建不能直接向 AI 开放。

v3 首版的一致性规则：

- `state/destructive/external` 一律串行，不允许 parallel/map concurrency 大于 1；
- `read` 只有 Manifest 标记 `parallelSafe:true` 才可并行；
- `visual` 默认串行，除非 SSP 明确声明互不冲突的 `resourceScopes`；
- Runtime 按 resource scope 加会话内锁，同 scope 保持模板声明顺序；
- 超时只停止尚未开始的步骤，并向支持取消的 SSP 调用传递 AbortSignal；不声称能回滚不可取消副作用；
- 部分失败返回已执行/未执行/补偿失败轨迹，禁止伪装为原子成功；
- 补偿只恢复本 execution scope 创建或修改的资源，不得调用全局 `clearAll/removeAll` 覆盖其他会话状态。

## 7. 面向 AI 的能力目录

AI Prompt 目录由 Registry 从 `ai.exposed:true` 模板自动生成，不手写模板参数说明。每项仅包含：

- `templateId`；
- 用户语义描述和 intents；
- 输入 JSON Schema 的压缩表达；
- 结果摘要；
- 是否需确认；
- 2～3 个有效例子和必要 guard。

保留当前唯一输出协议：

```json
{
  "action": "template",
  "templateId": "object.focus-and-highlight",
  "params": { "sid": "DOOR_A_6F_1", "color": "#FF5722" }
}
```

Planner 仍只产生一个顶层模板调用。多步行为是组合模板内部的确定性编排，不让 LLM 临时生成执行计划。这样同一用户意图可以被校验、审计、重放和版本锁定。

`src/ai/skills` 不再作为第二套执行协议：可迁移为 composite template；未迁移前不接入 AI 主链路，完成迁移后删除或归档。

## 8. 现有能力的迁移判断

| 现有项 | v3 归属 | 处理 |
|---|---|---|
| 单 SSP 调用模板 | atomic | 由 Manifest 校验方法、参数和结果，去掉 `code` |
| `focus-on-object`、`highlight-objects`、`flash-alarm`、`floor` | composite | 把 `steps` 改为真实可执行 flow，删除重复 code |
| `query-scene` | composite | SSP `query` / `describe` 已实施；迁移为 `query -> describe/action`，不含 group/compare/summarize，不遍历 scene、直读 metadata 或创建 timer |
| `captureMainViewpoint` | 宿主应用状态 | 移出严格 SSP 模板 Registry；由宿主适配器调用 `getViewpoint` 后存入受控会话状态 |
| `flyToMainViewpoint` | 宿主触发 + atomic | 宿主解析默认 Viewpoint 后调用通用 `setViewpoint` 原子模板；模板不读取 Store |
| `help` | AI/UI 静态内容 | 移出 SSP 模板 Registry，作为对话系统帮助响应 |
| `highlight-with-undo` skill | composite | SSP lease 已实施；用 execution-local capability 组合 `query -> applyHighlight -> releaseHighlight`，模板不创建 timer，不用全局 clear 回滚 |
| `clearAllHighlights` | host-only | 从 AI 目录和可组合模板集合移除；仅允许宿主紧急全局恢复，不能作为补偿 |
| topology 原子模板 | atomic, AI hidden | 保持不直接向 AI 开放，由消防路线等业务 composite 使用 |

注意：timer 不属于模板控制核，“延时恢复”不能由模板自行实现。SSP 已实施按对象 identity 验证的不透明 `HighlightLease`、manager pulse scheduler、last-applied-wins、clone-on-write、cleanup hook 与 legacy owner layer。模板侧只负责 execution-local capability table、AI 60 秒上限、取消/超时释放和公共回执投影，不得复制 SSP 的高亮状态机。

## 9. 审计与测试

### 9.1 构建期硬失败

- v3 schema 不合法；
- atomic 非一一映射、方法不存在或参数不兼容；
- composite 引用未知模板、产生环或越过资源上限；
- 模板包含 `code`、`method` 动态值或禁用字段；
- AI 模板输入/输出不可序列化；
- AI 模板风险声明低于传递计算值；
- AI 模板没有 validator、example、guard 或确认策略；
- SSP 方法未被归类；
- 模板 input、Prompt 和 Runtime validator 不是同源生成。

### 9.2 测试层级

1. Schema test：所有模板可解析。
2. Mapping test：SSP Manifest 与 atomic 模板双向覆盖。
3. Graph test：组合图无环、引用和数据流类型正确。
4. Contract test：使用 mock SSP 断言实际调用序列、参数和返回投影。
5. Control-kernel test：拒绝空 flow、恒跳过路径、动态路径、自定义 evaluator、越界 map 和业务计算。
6. Handle test：覆盖句柄链路、数组 map、伪造/跨会话 token，以及公共输出残留句柄的拒绝。
7. Lease test：覆盖每 execution 32 上限、AI duration 60 秒上限、opaque identity、跨 execution 拒绝，以及 success/cancel/timeout/error 的逐一释放。
8. Concurrency test：覆盖同资源并行、部分 map 失败、超时取消、逆序补偿和补偿失败。
9. Policy test：危险能力、确认、超时、调用上限和 AI 白名单，并断言 `clearAllHighlights` 永不出现在 AI/组合目录。
10. Replay test：升级顶层或子模板后，旧 Snapshot 仍产生原调用轨迹；缺失历史内容时明确失败。
11. Scene smoke test：仅对有副作用模板在 Sandbox 使用真实场景验证。

当前 `audit:templates` 与 `audit:ai-boundary` 可保留为迁移期检查，但不能作为 v3 完成标准，因为它们不验证调用闭包和组合执行语义。

## 10. 分阶段落地

### Phase 0：冻结规则与盘点

状态：✅ 分类账与 v2 冻结已实现；SSP 申请已由主任务实施，本任务未修改 SSP。生成物见 [Phase 0 Inventory](./generated/TEMPLATE_PHASE0_INVENTORY.md) 与 [SSP Change Requests](./SSP_CHANGE_REQUEST_PHASE0.md)。

- 对当前 checkout 实际源码生成 Capability Manifest；上游 SSP 合入前为 81 方法，完整合入后目标为 85 方法，半同步状态硬失败；
- 标出当前模板到 SSP 方法的真实映射、重复映射、组合项和非 SSP 依赖；
- 记录 CR-SSP-001/003 已实施交接；`query-scene` 与 lease Runtime 仍待迁移，`clearAllHighlights` AI policy 已关闭；
- 冻结新增 v2 `code` 模板。

完成标准：所有公开方法均为 `mapped/host-only/blocked/deprecated`，`unclassified=0`。

### Phase 1：v3 原子模板

状态：✅ 原子运行核与首批迁移已实现。

- 已定义封闭 v3 JSON Schema、同源 JsonSchema validator 和静态 atomic runtime；
- 已加入独立 v3 capability machine contract，逐方法锁定模板 allow-list、参数 schema 与返回 schema，缺失映射按 fail-closed 处理；
- 已迁移 `getViewpoint`、`setBackgroundColor`、`setFog`、`resetVisibility` 四个一一映射模板；
- 已引入 execution-local 不透明 ObjectRef，以及有界公共结果投影、JSON round-trip 与 64 KiB 序列化上限；
- v2/v3 Registry 并行读取，同 ID v3 始终优先，隐藏的 v3 不回退 v2；
- `clearAllHighlights` 已撤销 legacy AI 暴露，v3 Manifest policy 同时拒绝该 host-only 绑定；
- 通用 legacy/v3 dispatcher 无法通过 `aiOnly:false` 绕过 host-only，只有窄化的宿主动作适配器可调用紧急恢复；
- AI 目录只加载纯 Registry，SSP 仅在 `appRuntime` 注入，避免 Prompt/Intent 构建间接初始化执行层。

完成证据：12 项 atomic contract tests 与 v3 mapping audit 全过；已迁移 v3 路径不使用 `new Function`。未迁移 v2 的兼容编译器被隔离在 `legacyRuntime.ts`，待后续迁移完成后删除。

### Phase 2：组合运行时

- 实现 DAG、结果引用、有限条件、并行/有限 map、失败和补偿策略；
- 实现 execution-local capability table、每 execution 32 个 lease 上限及 cancel/timeout/finally 自动释放；
- 迁移 4 个现有组合模板；
- 将 `query-scene` 拆为 `query -> describe/action`，删除 scene traversal、metadata 直读和 timer；
- 将 skill 迁移为 composite 或归档。

完成标准：组合模板不含 code，mock SSP 可精确断言每条调用轨迹。

### Phase 3：补齐 SSP 通用能力

状态：✅ 主任务已获用户授权并完成 SSP 实施与复审；模板任务只消费公共接口。

- `objectsTool.query` / `objectsTool.describe` 已实施，不包含领域规则或 group/compare/summarize；
- 命名/默认视角留在宿主应用状态，模板复用现有 `getViewpoint` / `setViewpoint`，不申请 SSP 存取能力；
- `objectsTool.applyHighlight` / `releaseHighlight` 已实施 opaque handle、cleanup hook、legacy owner layer、共享单材质及 `Material[]` 生命周期与 manager pulse scheduler；
- 主任务已通过 13 项 objects 回归、typecheck、topology、boundary、template/AI audit 和 build。

SSP 完成标准已满足；端到端完成仍取决于 Phase 2/4 的组合 Runtime 与 AI policy 迁移。

### Phase 4：AI 切换与清理

- Prompt 完全从 v3 Registry 生成；
- AI 只使用 v3 `ai.exposed:true` 模板；
- 撤销 `clearAllHighlights` 的 AI 暴露，确认 AI 目录、组合图与补偿路径均不可引用该 host-only 能力；
- 删除 `code` compiler、手写 AI Zod 表和失效的 `steps` 元数据；
- 更新 README、`_SCHEMA.md`、AI 设计和验证文档。

完成标准：仓库静态扫描不存在模板 `code`、`new Function`、`window.__chatStore`、模板内 THREE/scene 遍历。

## 11. 最终验收标准

模板层完成需同时满足：

1. AI 的唯一动作协议仍是 template call。
2. 每个 atomic 模板恰好绑定一个允许的公开 SSP 方法。
3. 每个 composite 模板的传递闭包只包含 atomic 模板。
4. 模板文件和 Runtime 均不执行任意源码。
5. 模板参数、校验、Prompt、UI 表单来自同一 JSON Schema。
6. 模板输出对 AI 仅为有界、可序列化 plain data。
7. 所有 SSP 公共方法均有明确模板策略，零未分类。
8. 风险、确认、超时、调用预算按组合闭包计算且不可降级。
9. 组合模板可通过 mock SSP 重放并精确验证调用轨迹。
10. AI 模板不访问 Store、window、THREE、DOM、scene internals 或 SSP context 生命周期。
11. 控制核 AST 封闭且不产生业务能力，每个 AI composite 至少有一条可达 atomic 路径。
12. 内部句柄只存在于单次 execution context，顶层输入不可伪造，公共输出零残留。
13. 执行锁定完整 Registry Snapshot 和 SSP Manifest digest，子模板升级不改变历史重放。
14. 有状态步骤遵守资源作用域和确定顺序，补偿不越过本 execution scope。
15. `HighlightLease` 只以 execution-local opaque capability 存在，AI/公共输出无 handle，取消与超时无租约泄漏。
16. `clearAllHighlights` 永远是 host-only，AI 目录、组合模板和补偿流程均不可达。

达到以上条件后，才可将模板层定义为“严格由 SSP 组合、同时面向 AI”。
