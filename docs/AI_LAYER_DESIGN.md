# AI 层设计（v0.1 历史方案 + 当前实现状态）

> 最后核对：2026-08-27
>
> 本文第 0-11 节保留 2026-07-29 的方案推演和取舍背景，不应直接当作当前
> 实现契约。当前代码已经落地，且以下决策覆盖旧方案：
>
> - 模型只输出 `{ action: "template", templateId, params }`，不能输出或执行代码。
> - AI 只面对统一 Registry 中 8 个显式开放模板；v3 的 `resetVisibility` 同 ID 遮蔽 legacy，`clearAllHighlights` 为 host-only。
> - `PlanExecutor` 只调用 `templateRuntime.execute(..., { aiOnly:true })`，不直接访问 SSP。
> - 浏览器只请求同源 `/api/llm/chat/completions`；API Key 不进入浏览器配置或 localStorage。
> - 当前模板总数为 79，全部 active、0 placeholder；数量以 `npm run audit:templates` 为准。
> - 楼层状态操作优先使用 `floorNames`；裸 `level` 多楼栋歧义必须澄清，不能猜楼栋。
> - 2026-08-27 用户批准的 R1 收口 UX 已实现并验收：`query-scene` hide 不弹原生确认；hide/show/isolate 每次只产生一个最新的一步精确可见性撤回，恢复该次操作涉及对象的操作前状态；显式“全部显示”保留但不等同于撤回，不做多步撤回或 redo；模型切换或重载使旧撤回失效。证据见 [R1_VISIBILITY_UNDO_REPORT.md](./R1_VISIBILITY_UNDO_REPORT.md)。
>
> 当前交接入口见 [HANDOFF_PROMPT.md](./HANDOFF_PROMPT.md)，AI 边界验收见
> [AI_LAYER_VERIFICATION.md](./AI_LAYER_VERIFICATION.md)。

## 0. 目标 & 范围

在已有 ssp-shim + 模板系统之上, 引入一个 **AI 层**, 让用户能用自然语言控制 3D 场景。

**做什么**:
- 用户用中文/英文 query(自然语言)控制 3D 场景
- AI 解析意图 → 调用已有 templates → 操作 ssp.objectsTool / cameraController 等
- 跨多轮的上下文保留 (10 轮, 只传最后 5 给 LLM)
- 4 种结果格式 (list / table / chart / text)

**不做什么**:
- 不修改 GLB 数据
- 不做 GLB 自动分类 (那是渲染前的工具, 不是 AI 层职责)
- 不做 LLM 训练/微调
- 不做账户/权限系统 (单设备本地)

---

## 1. 整体架构

```
┌────────────────────────────────────────────────────────────┐
│  Frontend (Vue 3 + Pinia)                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  ChatPanel.vue (AI 对话 UI, 右侧抽屉)                │   │
│  │  - 历史消息列表                                       │   │
│  │  - 输入框                                            │   │
│  │  - 渲染 AI 响应 (Intent JSON + 数据卡 + 高亮反馈)     │   │
│  │  - Quick Actions 头部按钮                             │   │
│  └─────────────────────────────────────────────────────┘   │
│                       ↕ Pinia (chat store)                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  src/ai/ (AI 模块, 完全独立)                          │   │
│  │  ├── parser/   (NlQueryParser + 3 层 prompts)         │   │
│  │  ├── planner/  (Intent → Plan, 纯本地决策)            │   │
│  │  ├── executor/ (跑 Plan, 调 templates)                │   │
│  │  ├── rules/    (LLM 不可用时 regex 兜底)               │   │
│  │  ├── audit/    (IntentLogger, localStorage 100 条)    │   │
│  │  └── context/  (chatContext, 多轮 10 轮)              │   │
│  └─────────────────────────────────────────────────────┘   │
│                       ↕ (复用, 不污染 ssp-shim)              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  ssp-shim (window.ssp) + ssp_templates (8 个 objects) │   │
│  │  数据底座 (GLB v3.1 metadata)                         │   │
│  └─────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────┘
                          ↓ HTTPS
┌────────────────────────────────────────────────────────────┐
│  云大模型 API (用户提供, MiniMax-M3 + key)                   │
│  - 接口: Anthropic 兼容                                    │
│  - 风格: Claude messages API                                │
│  - 输入: 3 层 prompt (stable/context/volatile) + 历史摘要    │
│  - 输出: Intent JSON (streaming token)                      │
│  - 超时: 15s                                                │
│  - 重试: 1 次 (失败 → 交用户手动改 Intent)                    │
└────────────────────────────────────────────────────────────┘
```

**模块边界原则** (受 Hermes narrow waist 启发, **严格遵守**):
- ✅ `src/ai/` 完全独立, 不污染 ssp-shim
- ✅ 当前统一目录有 8 个 AI 模板，首批 4 个 v3 atomic 由 Manifest machine contract 约束，且 AI 不直接接触 objectsTool
- ❌ 不在 ssp-shim 加任何 AI 相关 API
- ❌ 不引入 LangChain / Vercel AI SDK (过度依赖)
- ❌ 不在 ssp-shim 加新工具, 除非是为所有用户 (而非仅为 AI) 服务

> **Hermes 原话**: "The core is a narrow waist; capability lives at the edges.
> 不轻易加 core tool, 优先 CLI/skill/plugin/MCP."

---

## 1.1 关键决策表 (2026-07-29 讨论确认)

| 维度 | 决策 |
|---|---|
| NL parser | LLM + Schema (云 API) |
| 模型 | **MiniMax-M3** (用户提供) |
| **API 协议** | **OpenAI 兼容** (`/v1/chat/completions`) — ⚠️ 不是 Anthropic |
| **前端 SDK** | **`openai@^4.x`** (npm) |
| Key 存储 | 浏览器 localStorage, 仅本机用 |
| Action 范围 | 全 10 种 (含 compare/summarize) |
| 多轮 | 10 轮本地, 只传最后 5 轮给 LLM |
| 结果格式 | AI 层决定 (4 种: list/table/chart/text) |
| 历史压缩 | 仅传最近 5 轮 (前面本地存, 不传) |
| Prompt 分层 | 3 层 (stable/context/volatile, 受 Hermes 启发) |
| Schema 校验 | Zod |
| 模块边界 | 独立 `src/ai/` 模块, 不动 ssp-shim |
| ChatPanel 位置 | 右侧抽屉 |
| ChatPanel 启动 | 默认开启 |
| 流式响应 | streaming token |
| UI 显示 Intent | 完整 JSON (调试友好) |
| Quick Actions | 头部按钮 |
| LLM 超时 | 15s |
| LLM 重试 | 1 次, 失败交用户 |
| Fallback 策略 | 猜 + 限制 + 提示, 必要时追问 (间或) |
| 高亮清除 | 手动 (用户控制) |
| Visual 默认 | 跟 renderType: WINDOW 蓝, DOOR 黄, FACILITY 红 |
| Audit 上限 | 100 条 (localStorage) |
| 大范围操作 | 不确认 (用户能取消) |
| AI 联动 | 互不干扰 (3D + 场景树 + AI Chat 独立) |
| **LLM 输出格式** | **JSON, 不让 LLM 写代码** (Planner 转 code) |
| **thinking 处理** | **正则删 `<think>...</think>`** (借鉴你的实现) |
| **JSON 解析** | **3 级 fallback** (整体 / 代码块 / 首个 JSON) |
| **网络架构** | **B (Vite/Nginx 代理)** — 开发 Vite proxy, 生产 Nginx proxy |
| **Streaming UX** | **Thinking 流式 + JSON blocking** |
| **Thinking UI** | **折叠可展开** (保留全量) |
| **Stream 状态** | **状态机 4 态** (idle / thinking / parsing / executing) |
| **Prompt 体积** | **不限制** (用 token 换准度) |
| **Few-shot 例子** | **10 个** (覆盖全 10 种 action + edge case) |
| **Schema 表达** | **JSON Schema 格式** |
| **Scene 摘要** | **仅 55 GLB 文件名 + 大概 mesh 数** |
| **Visual 颜色** | **按 renderType 分色** (WINDOW 蓝 / DOOR 黄 / FACILITY 红) |
| **Query 颜色覆盖** | **可以传, 默认覆盖** |
| **高亮清除** | **永久持续** (用户手动清除) |
| **动作动画** | **现有动画能力**(持续 pulse + 持续 highlight), AI 层用 `setTimeout(unHighlight, N)` 实现"闪完停" |
| **Error fallback** | **LLM → 重试 → regex → 猜** (4 级) |
| **Regex 数量** | **50 个全场景** |
| **Regex 独立** | **独立并可用** (可手动选"快速模式") |
| **重试提示** | **重试 + 交用户改** (失败让用户手动改 Intent JSON) |
| **CORS 错误提示** | **显示技术错误 + 修复指南** |
| **ChatContext 持久化** | **不持久化, 刷新即清** |
| **Mock LLM 模式** | **要 mock 模式** (离线时用 regex 模拟 LLM) |
| **API key 输入入口** | **仅设置页** (无首次启动引导) |
| **Intent UI 展示** | **JSON + UI 两层** |
| **字段中文名映射** | **中文名 + 原值 都显示** |
| **多轮引用解析** | **识别并自动解析** ("它们" "那些" "上面" 自动拿上次结果) |
| **Intent scope 继承** | **默认继承, AI 可覆盖** (未指定 field 继承上次) |

---

## 2. Prompt 3 层架构 (受 Hermes 启示)

Hermes 的 system prompt 严格分 3 层: stable / context / volatile.
我们采用同样的策略, 让 LLM API 提供商能 cache 大部分 system prompt.

### Layer A: stable (整个项目生命周期内不变)

```typescript
const STABLE_PROMPT = `
你是一个 3D 建筑信息查询助手, 用户用自然语言问问题, 你需要输出结构化 Intent JSON.

# GLB Metadata Schema (v3.1)

renderType: 8 种之一 (大写, 严格)
  - WINDOW   窗户
  - DOOR     门
  - ELEVATOR 电梯
  - STAIR    楼梯
  - CEILING  楼板/地板/屋顶板
  - WALL     墙/承重墙/幕墙
  - SPACE    占位空间 (厕所/会议室等)
  - FACILITY 消防/安防器材

fireType: 11 种之一 (大写, 严格, 仅 FACILITY 必填)
  - HYDRANT, SMOKE_DETECTOR, SPRINKLER, EXTINGUISHER,
    EMERGENCY_LIGHT, EXIT_SIGN, BREAK_GLASS, ALARM_BELL,
    FIRE_HOSE, FIRE_DOOR, OTHER

spaceType: 13 种之一 (大写, 仅 SPACE 必填)
  - TOILET, LAUNDRY, KITCHEN, OFFICE, MEETING_ROOM,
    BEDROOM, CORRIDOR, STAIRWELL, ELEVATOR_HALL,
    MECHANICAL_ROOM, STORAGE, LOBBY, BALCONY

sid 格式: <RENDERTYPE>_<FLOORNAME>_<SEQ>
  例: DOOR_A_1F_E_05, FACILITY_A_1F_HYDRANT_01

# 10 种 Action

- list       列举符合条件的 mesh (返回 sid 列表)
- count      计数 (返回数字)
- locate     定位 (短闪烁 1 次)
- highlight  持续高亮
- flash      闪烁 3 次
- focus      聚焦 + 飞行镜头
- hide       隐藏
- isolate    隔离 (只显示这些)
- compare    跨楼层/跨建筑对比
- summarize  汇总某层/某建筑的统计

# 输出格式

输出严格 JSON, 不要解释, 不要 markdown 包装.

{
  "action": "list" | "count" | ...,
  "target": {
    "renderType": "WINDOW" | ...,
    "fireType": "HYDRANT" | ...,
    "spaceType": "TOILET" | ...,
    "sid": "DOOR_A_1F_E_05",
    "meshName": "模糊匹配"
  },
  "scope": {
    "buildings": ["A", "B", "C"],
    "levels": [1, 2, 3],
    "floorNames": ["A_1F"],
    "floorTypes": ["FLOOR", "ROOF"],
    "directions": ["N", "E", "S", "W"]
  },
  "groupBy": "renderType" | "fireType" | "spaceType" | "building" | "level" | "direction",
  "visual": {
    "color": "#FF6B00",
    "duration": 5000,
    "flash": true
  },
  "output": {
    "format": "list" | "table" | "chart" | "text",
    "limit": 50
  }
}

# 安全约束

- 用户 query 含糊时, 给出最合理猜测 + 限制结果数 + 提示
- 范围过大 (>500 mesh) 时加 visual 提示
- hide / show / isolate 直接执行，不弹原生确认；执行后由 UI 提供一个最新的一步精确可见性撤回。显式“全部显示”是全局恢复，不是撤回；不提供多步撤回或 redo。模型切换或重载后旧撤回失效。
- 你不解释, 只输出 JSON
`
```

### Layer B: context (整个 session 内不变)

```typescript
const CONTEXT_PROMPT = `
# 当前场景

Subcategory: hospital
共 55 个 GLB:

| Building | Levels | FloorType | Range |
|---|---|---|---|
| A | 1F - 15F, T (塔楼), DING (屋顶) | FLOOR/TOWER/ROOF | 15 + 2 = 17 层 |
| B | 1F - 24F, T, DING | 同上 | 24 + 2 = 26 层 |
| C | 6F - 10F, DING | FLOOR/ROOF | 5 + 1 = 6 层 |
| BASEMENT | B1 - B4 | BASEMENT | 4 层 |
| LANDSCAPE | TERRAIN, FACADE | LANDSCAPE_TERRAIN/FACADE | 2 个 |

Mesh 分布 (A_1F 实际数据, 139 mesh):
  - WINDOW: 20
  - DOOR: 101
  - ELEVATOR: 4
  - STAIR: 4
  - CEILING: 2
  - WALL: 1
  - FACILITY: 7 (全 HYDRANT)

# 已加载 GLB

[动态注入, session 内不变]
`
```

### Layer C: volatile (每轮 query 变)

```typescript
const VOLATILE_PROMPT = `
# 多轮上下文 (最近 5 轮)

[Turn N-4] 用户: "A 楼有哪些楼层?"
        AI Intent: { action: "summarize", scope: { buildings: ["A"] }, groupBy: "level" }
        结果: 17 层
[Turn N-3] 用户: "1 层有哪些消防栓?"
        AI Intent: { action: "list", target: { renderType: "FACILITY", fireType: "HYDRANT" }, scope: { levels: [1] } }
        结果: 7 个 sid, 已 highlight 红色
[Turn N-2] 用户: "把它们都闪烁"
        AI Intent: { action: "flash", scope: { inheritFromPrevious: true } }
        结果: 7 个 mesh 闪烁
[Turn N-1] 用户: "B 楼同样的"
        AI Intent: { action: "flash", target: { renderType: "FACILITY", fireType: "HYDRANT" }, scope: { buildings: ["B"] } }
        结果: ...
[Turn N] 用户: "对比一下数量"

# 当前 query

用户: "对比一下数量"

# 时间

2026-07-29 11:40 (会话开始: 2026-07-29 11:25)

# 任务

解析当前 query + 历史上下文, 输出 Intent JSON.
`
```

---

## 3. Intent Schema (完整)

```typescript
interface Intent {
  /** 10 种动作 */
  action: 
    | 'list'         // 列举所有符合条件的 mesh
    | 'count'        // 计数
    | 'locate'       // 定位 (持续 pulse, AI 在 N 秒后 stopPulse)
    | 'highlight'    // 持续高亮 (不闪)
    | 'flash'        // 闪烁 (持续 pulse, AI 在 N 秒后 stopPulse)
    | 'focus'        // 聚焦 + 飞行镜头
    | 'hide'         // 隐藏
    | 'isolate'      // 隔离
    | 'compare'      // 跨楼层对比
    | 'summarize'    // 汇总统计
  
  /** 目标对象 */
  target?: {
    renderType?: RenderType     // 8 种
    fireType?: FireType         // 11 种 (仅 FACILITY)
    spaceType?: SpaceType       // 13 种 (仅 SPACE)
    sid?: string                // 直接说 mesh id
    meshName?: string           // 模糊匹配
  }
  
  /** 范围过滤 */
  scope?: {
    buildings?: Building[]      // ['A', 'B']
    levels?: number[]           // [1, 2, 3]
    floorNames?: string[]       // ['A_1F']
    floorTypes?: FloorType[]    // ['FLOOR', 'ROOF']
    directions?: Direction[]    // 8 方位
  }
  
  /** 聚合维度 */
  groupBy?: 'renderType' | 'fireType' | 'spaceType' | 
            'building' | 'level' | 'direction' | 'floorName'
  
  /** 可视化 */
  visual?: {
    color?: string
    duration?: number          // ms
    flash?: boolean
  }
  
  /** 输出格式 */
  output?: {
    format: 'list' | 'table' | 'chart' | 'text'
    limit?: number             // 默认 50
  }
}
```

---

## 4. Planner 设计 (Intent → Plan)

**纯本地决策, 不调 LLM**.

```typescript
// IntentPlanner.ts
function plan(intent: Intent, chatContext: ChatContext): Plan {
  const steps: Step[] = []
  
  // Step 1: 数据查询
  steps.push({
    type: 'query',
    target: intent.target,
    scope: intent.scope,
    groupBy: intent.groupBy,
  })
  
  // Step 2+: 渲染步骤
  switch (intent.action) {
    case 'list':
    case 'count':
    case 'summarize':
      // 只输出数据, 不动 3D
      steps.push({ type: 'render', format: intent.output?.format ?? 'list' })
      break
      
    case 'locate':
      steps.push({ type: 'template', name: 'flash-alarm', params: {
        sids: '$step[0].result.sids',
        color: intent.visual?.color ?? '#FF6B00',
      }})
      // 5 秒后 unHighlight (停 pulse + 还原 emissive)
      steps.push({ type: 'timer', action: 'unHighlight', sids: '$step[0].result.sids', delayMs: 5000 })
      break
      
    case 'highlight':
      steps.push({ type: 'template', name: 'highlight-objects', params: {
        sids: '$step[0].result.sids',
        color: intent.visual?.color ?? '#FF6B00',
      }})
      // highlight 不闪, 不停
      break
      
    case 'flash':
      steps.push({ type: 'template', name: 'flash-alarm', params: {
        sids: '$step[0].result.sids',
        color: intent.visual?.color ?? '#FF1744',
      }})
      // 3 秒后 unHighlight
      steps.push({ type: 'timer', action: 'unHighlight', sids: '$step[0].result.sids', delayMs: 3000 })
      break
      
    case 'focus':
      steps.push({ type: 'template', name: 'focus-on-object', params: {
        sids: '$step[0].result.sids',
      }})
      steps.push({ type: 'template', name: 'fly-to-floor', params: {
        floorName: '$step[0].result.firstFloorName',
      }})
      break
      
    case 'hide':
      steps.push({ type: 'template', name: 'hide-objects', params: {  // ⚠️ 需新增
        sids: '$step[0].result.sids',
      }})
      break
      
    case 'isolate':
      steps.push({ type: 'template', name: 'highlightIsolate', params: {
        sids: '$step[0].result.sids',
      }})
      // hide / show / isolate 均不弹原生确认；UI 在成功执行后记录最新的一步精确撤回
      break
      
    case 'compare':
      // 跨 buildings/levels 多次查询 + 汇总
      steps.push({ type: 'multiQuery', groupBy: intent.groupBy ?? 'building' })
      steps.push({ type: 'render', format: intent.output?.format ?? 'chart' })
      break
  }
  
  return { steps, intent, intentId: uuid() }
}
```

---

## 5. Executor (Plan → 实际调用)

```typescript
// PlanExecutor.ts
async function execute(plan: Plan, ssp: SspNamespace): Promise<PlanResult> {
  const results: StepResult[] = []
  for (const step of plan.steps) {
    if (step.type === 'query') {
      // 用 ssp.objectsTool.getByUserDataProperty
      results.push(queryMeshes(step, ssp))
    } else if (step.type === 'template') {
      // 调 ssp_templates/ 下对应模板的 code
      results.push(await runTemplateCode(step.template.code, ssp))
    } else if (step.type === 'render') {
      // 收集结果到 resultRenderer
      results.push(renderStep(step, results))
    }
  }
  return { steps: results, intent: plan.intent }
}
```

---

## 6. 多轮上下文 (M2 完整设计)

```typescript
// chatContext.ts
class ChatContext {
  messages: ChatMessage[]      // 全部历史 (本地)
  intents: Intent[]            // 历史 Intent (按时间序)
  results: PlanResult[]        // 每次执行结果
  currentIntent?: Intent       // 最新 Intent
  
  /** 压缩: 取最近 5 轮, 生成 LLM 可用的摘要 */
  compress(): VolatileContext {
    const last5 = this.intents.slice(-5)
    return {
      turns: last5.map((intent, i) => ({
        userMessage: this.messages[/* 对应 user */].content,
        aiIntent: intent,
        result: this.results[i],
      })),
    }
  }
  
  /** 引用解析: "它们" / "那些" / "前面" */
  resolveReference(query: string): string[] | null {
    // 简单实现: 检测 query 含 "它们/那些/前面/同上次"
    // 返回上一个 Intent 的 sids
    if (this.isReferenceQuery(query) && this.currentIntent) {
      return this.lastResultSids
    }
    return null
  }
}
```

**典型多轮流程**:

```
[1] "A 楼 1 层有哪些消防栓?"
    Intent: list(FACILITY, HYDRANT, A, 1)
    Result: 7 个 sid, 列表展示

[2] "把它们都高亮红色"
    Intent: 复用 [1] scope, highlight(red)
    Result: 7 个 mesh 高亮

[3] "再看 B 楼的"
    Intent: 复用 [2] target, 但 buildings=["B"]
    Result: B 楼同样 7 个 mesh 高亮

[4] "对比一下数量"
    Intent: compare(target=FACILITY, HYDRANT, groupBy=building, scope={A,B})
    Result: 表格 / 柱状图
```

---

## 7. Fallback (LLM 不可用时)

**3 级 fallback**:
1. **LLM 正常** → LLM 解析
2. **LLM 失败 / 超时** → regex 匹配 (`rules/fallbackRules.ts`)
3. **都失败** → "我没听懂, 试试: 'A 楼 1 层有哪些消防栓?'"

```typescript
// fallbackRules.ts
const RULES: Rule[] = [
  {
    pattern: /(\d+)\s*层.*?(\w+)\s*个.*?(消防栓|应急灯|...)/,
    extract: (m) => ({
      action: 'list',
      scope: { levels: [parseInt(m[1])] },
      target: { renderType: 'FACILITY', fireType: m[3] /* map */ },
    }),
  },
  // ... 50+ 个常见模式
]

function fallbackParse(query: string): Intent | null {
  for (const rule of RULES) {
    const m = query.match(rule.pattern)
    if (m) return rule.extract(m)
  }
  return null
}
```

---

## 8. Audit / 重放 (受 Hermes IntentLogger 启发)

```typescript
// IntentLogger.ts
class IntentLogger {
  private storage = localStorage
  
  log(entry: {
    timestamp: number
    query: string
    llmResponse?: string        // LLM 原始返回
    parsedIntent: Intent
    plan: Plan
    executionResults: PlanResult
    durationMs: number
    errored: boolean
    errorMsg?: string
  }) {
    const key = 'ai_intent_log_v1'
    const logs = JSON.parse(this.storage.getItem(key) || '[]')
    logs.push(entry)
    // 只保留最近 100 条
    while (logs.length > 100) logs.shift()
    this.storage.setItem(key, JSON.stringify(logs))
  }
  
  /** 在控制台查看历史 + 重放 */
  replay(intentId: string) {
    const entry = this.readAll().find(e => e.intentId === intentId)
    return entry
  }
}
```

UI 加一个"查看审计日志"按钮,弹窗展示最近 100 条,支持重放。

---

## 9. 性能 / 成本优化 (受 Hermes 启示)

| 优化 | 做法 | 效果 |
|---|---|---|
| **Prompt 3 层 cache** | stable/context 不变, LLM API cache | 每轮 cache hit 80%+ |
| **意图缓存** | query hash → Intent 内存 LRU | 重复 query 0 token |
| **结果缓存** | scope hash → mesh list | 重复 scope 0 查询 |
| **历史压缩** | 只传最近 5 轮 (前 5 轮本地存) | 长会话省 50%+ token |
| **Result 预算** | 每条 LLM 输入 ≤ 4K tokens | 防 context 爆 |
| **温度 = 0** | LLM 输出稳定 | 同 query 概率相同 |

---

## 10. 错误处理 / 安全边界

| 场景 | 处理 |
|---|---|
| LLM 超时 | fallback regex, 报错时显示"AI 暂时不可用" |
| LLM JSON 错 | 重试 1 次, 仍错走 fallback |
| query 完全无法理解 | UI 显示 "我没听懂, 试试: 'A 楼 1 层有哪些消防栓?'" |
| 结果 >500 mesh | Planner 自动切到"汇总"模式 + UI 提示 |
| hide / show / isolate 操作 | 不弹原生确认；UI 仅提供一个最新的一步精确可见性撤回；显式“全部显示”不作为撤回 |
| 高亮 / 闪烁持续 | 5 秒后自动清除 |

---

## 11. UX 设计

```
┌────────────────────────────────────────────────┐
│  AI 助手                    [⚙] [📋 历史] [↗] │
├────────────────────────────────────────────────┤
│                                                │
│  [11:25] 👤 用户:                              │
│    "A 楼 1 层有哪些消防栓?"                       │
│                                                │
│  [11:25] 🤖 AI (Intent):                        │
│    list(FACILITY, HYDRANT, A, 1) → 找到 7 个     │
│                                                │
│    ┌────────────────────────────────────┐       │
│    │ 1. FACILITY_A_1F_HYDRANT_01  主入口 │       │
│    │ 2. FACILITY_A_1F_HYDRANT_02  电梯厅 │       │
│    │ 3. FACILITY_A_1F_HYDRANT_03  走廊  │       │
│    │ ... (共 7 个)                       │       │
│    └────────────────────────────────────┘       │
│                                                │
│  [11:26] 👤 用户:                              │
│    "把它们都闪烁"                                │
│                                                │
│  [11:26] 🤖 AI:                                │
│    已闪烁 7 个 (持续 5 秒, 红色)                  │
│    [点击查看] → 3D 场景中闪烁                    │
│                                                │
├────────────────────────────────────────────────┤
│  💬 输入查询...                       [发送 ➤]  │
└────────────────────────────────────────────────┘

侧栏:
  [Quick Actions]
  - 🔥 显示所有 FACILITY
  - 🚪 显示所有 DOOR
  - 🪟 找到窗户
  - 🏢 A 楼全景
  - 🚨 紧急闪烁
```

---

## 12. 当前模块清单（已实现）

```
已存在:
- src/ai/types/Intent.ts                     # Intent + Plan TypeScript 类型
- src/ai/parser/NlQueryParser.ts             # LLM 调用入口
- src/ai/parser/prompts.ts                   # 3 层 prompt 拼接
- src/ai/parser/llmClient.ts                 # 同源服务端代理客户端
- src/ai/planner/IntentPlanner.ts            # Intent → Plan
- src/ai/planner/decisionTable.ts            # 决策表
- src/ai/executor/PlanExecutor.ts            # 跑 Plan
- src/ai/rules/fallbackRules.ts              # LLM 不可用时 regex 兜底
- src/ai/audit/IntentLogger.ts               # localStorage 审计
- src/ai/context/chatContext.ts              # 多轮上下文
- src/stores/chat.ts                         # Pinia 状态
- src/views/ChatPanel.vue                    # AI 对话 UI
- docs/AI_LAYER_DESIGN.md                    # 本文档

当前统一 AI 目录（8 个）:
- camera/captureMainViewpoint.json
- camera/fitScene.json
- camera/flyToMainViewpoint.json
- objects/collapse-floor.json
- objects/explode-floor.json
- objects/query-scene.json
- objects/resetVisibility.json
- scene/help.json

其中 `resetVisibility` 由同 ID v3 原子模板遮蔽 legacy，是显式“全部显示”全局恢复动作，
不等同于可见性撤回；`clearAllHighlights` 是 host-only 紧急恢复动作，只能由显式宿主适配器调用，
不进入 Intent、fallback 或 AI 目录。2026-08-27 批准的单步精确撤回覆盖 `query-scene` 的
hide/show/isolate，且模型切换或重载后失效；实现与 R1 回归已经通过。

边界与注册表:
- src/templates/catalog.ts                   # v3-first 统一目录 + AI 白名单
- src/templates/runtime.ts                   # v3-first 执行器；未迁移 id 才回退 legacy
- src/templates/v3/                          # Manifest 约束的声明式原子 Runtime
- scripts/audit-ai-boundary.mjs              # AI 不得越过 templates 的静态审计
```

旧方案中的 `resultRenderer.ts`、`compressor.ts` 和浏览器 OpenAI SDK 没有单独落地；
对应职责分别由模板结果标准化、`chatContext.ts` 和同源代理客户端承担。这是简化后的
有意设计，不是待补文件。

---

## 13. 实施分期（当前状态）

| 阶段 | 当前落点 | 状态 |
|---|---|---|
| **Phase 1: 骨架** | Intent、LLM client、prompt、Parser | ✅ |
| **Phase 2: Planner + Executor** | template-only Plan 与执行 | ✅ |
| **Phase 3: Fallback** | 确定性规则 + Mock 路径 | ✅ |
| **Phase 4: UI** | ChatPanel + 结果卡 + Quick Actions | ✅ |
| **Phase 5: 多轮** | chatContext + 楼层上下文补全 | ✅ |
| **Phase 6: Audit + 重放** | IntentLogger + UI | ✅ |
| **Phase 7: 缓存** | 原始 Intent 缓存 + 每次会话重新补全 | ✅ |
| **Phase 8: 模板边界** | 统一目录 8 个 AI 模板；4 个 ID 已有 v3 atomic 路径 | ✅ |

下一阶段不是继续扩张 AI schema，而是在 templates/适配层增加通用 GLB 场景业务组合；
低层 topology 原子模板仍保持 `aiEnabled:false`。

---

## 14. 已知风险 / 待确认

| 风险 | 应对 |
|---|---|
| LLM 选择错误模板或参数 | Registry AI 白名单 + Zod/模板参数校验 + fallback |
| 裸楼层跨楼栋歧义 | 只继承唯一上下文；否则 `query-scene` 返回 candidates 且场景零修改 |
| Intent 缓存串用楼栋 | 缓存原始 Intent，每次调用按当前会话重新补全 |
| 大量 mesh 查询性能 | LLM 只看模板目录和场景摘要；真实对象查询留在本地模板 |
| Hospital topology 数据缺口 | 在 templates/适配层建图；不得让 AI 或 topology 核心扫描模型猜边 |

---

## 15. 借鉴自 Hermes 的关键原则

1. ✅ **Prompt caching is sacred** — 3 层 prompt, 只 volatile 变
2. ✅ **Narrow waist** — AI 层独立, 不污染 ssp-shim
3. ✅ **Behavior contracts** — Planner 严格按 schema 校验 Intent
4. ✅ **No speculation** — 模板默认不向 AI 开放，用到再显式 opt-in
5. ✅ **Caveat, no premature abstraction** — 保持 template-only Intent，不增加第二套动作协议
6. ✅ **Audit by default** — IntentLogger localStorage 持久化
7. ✅ **Footprint ladder** — 模板优先, 不在 core 加 AI 能力
