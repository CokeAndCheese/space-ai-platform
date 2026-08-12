# 模型 Metadata 审计提示词 — 阶段 2 前置

> **历史资料（2026-08-10 复核）**：本文保存阶段 2 开始前、单体
> `hospital.glb` 和约 60 条模板时期的审计提示词。当前项目已经改为分层 GLB、
> 79 个 active 模板，objectsTool 与 metadata 注入均已落地；不要把下文的
> “待实现 API”或数量当作当前状态。新审计应以 `GLB_METADATA_SPEC.md`、
> `npm run validate-metadata` 和 `docs/HANDOFF_PROMPT.md` 为准。
>
> **用途**:复制下面"提示词正文"整块,粘贴到一个**全新的 LLM 对话**,让它帮你评估现有 GLB 模型的 metadata 完备性,给出可执行的 Blender 操作指南。

---

## 上下文

我正在做一个 AI 友好的 3D 平台(Space AI Platform),让 LLM 通过结构化 JSON 模板控制 Three.js 场景。**阶段 2**(对象操作)依赖 GLB 模型内部的 metadata,现在模型 metadata 是空的,我要去 Blender 补 metadata,但补之前先让 LLM 帮我列缺口清单。

---

## 提示词正文(从这里复制 ↓)

````markdown
# 角色

你是 Three.js / 数字孪生 / BIM 模型的 **metadata 审计员**。

# 任务

我正在做一个 AI 友好的 3D 平台 (`Space AI Platform`)。平台里有 60 条结构化 JSON 模板(让 LLM 控制 Three.js 场景),其中**阶段 2**(对象操作)依赖 GLB 模型内部的 metadata 才能跑通。我现在要**审计当前模型** (`hospital.glb`, 73.98 MB) 的 metadata 完备性。

# 当前可用 API (阶段 2 待实现)

我会做这些 API,但需要模型 metadata 提供支撑:

| API | 签名 | 依赖的模型 metadata |
|---|---|---|
| `objectsTool.getByName(name)` | 按 name 找节点 | 节点 `.name` 字段 |
| `objectsTool.getByUserDataProperty(key, value)` | 按 userData 字段值过滤 | `obj.userData[key] === value` |
| `objectsTool.setHighlight(obj, color, pulse?)` | 改 material.emissive 高亮 | 需要 `obj` 引用(可由上面两个 API 拿到) |
| `objectsTool.setVisible(obj, visible)` | 设 obj.visible | 同上 |
| `objectsTool.flyToObject(name)` | 自动算包围盒 + 飞过去 | 任意 `THREE.Object3D`,最好有非零 Box3 |

# 模板 code 调用示例 (LLM 会写出类似这样的代码)

```js
// 找某个楼层
const fl = ssp.objectsTool.getByUserDataProperty('floorName', 'A_6F')[0]
// 高亮
ssp.objectsTool.setHighlight(fl, '#29ccff', true)
// 飞过去
await ssp.cameraController.flyToObject(fl, { viewpoint: 'rightFrontTop', padding: 0.2 })
```

# 你需要做什么

我已经知道我模型的 inspector 输出(下面会贴出来),请你:

1. **逐字段判断** :每个 metadata 字段(下面列表)在当前模型里**是否存在 / 有多少节点 / 值的样本**。
2. **映射到模板** :每条模板的 code 字段会被 LLM 调用,如果它依赖某个 metadata 字段,而该字段缺失 / 为空,**明确告诉我需要补什么 + 怎么补**(在 Blender 里怎么命名 / 怎么导出 GLB)。
3. **优先级排序** :告诉我**最该补的 3 个字段**,理由是哪些模板因此跑不通。
4. **给一个 Blender 操作指南** :在 Blender 里怎么给 GLB 模型加这些 metadata(节点命名前缀 / userData 自定义属性 / GLB userData extension)。

# 模型 inspector 当前输出

> 输出格式由我在开发环境运行 `sspDev.modelInspector.scan()` 得到,你**不要自己重新跑** — 直接基于这个评估。

```
url: /models/hospital.glb
total nodes: 8423
meshes: 8298
named nodes: 8422
unique names (前 50): mesh_8, mesh_9, mesh_10, ..., mesh_59  (全是 mesh_<数字> 自动命名)
nodes with userData (前 50 个 sample): [
  // (我没打印详细内容, 你假设这 50 个的 userData 是 THREE.js 默认空对象 {})
]
by renderType: {}
by twinsIdentifier: {}
by floorName: {}
```

**关键结论(已知)**:
- 模型**有 8422 个有名字的节点**(99.99% 都有 name)
- 但**名字全是 `mesh_<数字>` 形式**(自动生成,无语义)
- 任何自定义 `userData.renderType` / `userData.twinsIdentifier` / `userData.floorName` / `userData.sid` / `userData.type` **全为空**

# 模板 code 依赖清单 (需要你审计的部分)

60 条模板里,以下这些**直接读 userData 字段**(你需要告诉我哪个字段缺失最严重):

| 模板 | code 关键调用 | 依赖字段 |
|---|---|---|
| `ssp_templates/objects/fly-to-floor.json` | `getByUserDataProperty('floorName', 'A_6F')` | userData.floorName |
| `ssp_templates/objects/highlight-objects.json` | `getByUserDataProperty('renderType', 'WINDOW')` | userData.renderType |
| `ssp_templates/objects/focus-on-object.json` | (待我贴) | (待审计) |
| `ssp_templates/objects/flash-alarm.json` | (待我贴) | (待审计) |
| `ssp_templates/objects/highlight-objects.json` | `getByUserDataProperty('renderType', 'CEILING')` | userData.renderType |
| `ssp_templates/objects/floor.json` | `getByUserDataProperty('renderType', 'FLOOR')` | userData.renderType |
| `ssp_templates/objects/getObjectById.json` | `getById('A_6F')` 或 `getByName('A_6F')` | node.name |
| `ssp_templates/objects/fly-to-floor.json` | `getByUserDataProperty('floorName', 'A_6F')` | userData.floorName |
| `ssp_templates/objects/highlightIsolate.json` | `getByUserDataProperty('renderType', 'CEILING')` | userData.renderType |
| `ssp_templates/camera/flyToObject.json` | `getById('A_6F')` 或 `getByUserDataProperty('floorName', 'A_6F')` | 同上 |
| `ssp_templates/objects/getObjectById.json` | `findObjectBySid('xxx')` | userData.sid |
| `ssp_templates/objects/getObjectById.json` | `scene.getObjectByName('xxx')` | node.name |
| `ssp_templates/objects/getObjectByUserDataProperty.json` | 遍历 userData | 任何 userData |

# 你需要给我的产出 (输出格式)

```
## A. 字段审计表

| 字段 | 当前状态 | 样本数量 | 样本值 | 模板影响 |
|---|---|---|---|---|
| node.name | 8422/8423 有值 | mesh_<数字> | "mesh_8" 等 | N/A (字面是有的) |
| userData.renderType | 缺失 | 0 | — | 阻塞 5 条模板 |
| userData.twinsIdentifier | 缺失 | 0 | — | 阻塞 3 条模板 |
| userData.floorName | 缺失 | 0 | — | 阻塞 3 条模板 |
| userData.sid | 缺失 | 0 | — | 阻塞 1 条模板 |
| ... (你自己加) | | | | |

## B. 缺口优先级排序

1. **<字段>** — 阻塞 <N> 条模板 — 理由: ...
2. **<字段>** — ...
3. **<字段>** — ...

## C. Blender 操作指南 (用户去执行)

### 目标字段 1: userData.floorName
- Blender 里怎么命名 / 加属性
- Blender → GLB 导出的设置(必须勾选 "Custom Properties" 或类似选项)
- 命名规范(中文 / 英文 / 拼音 / kebab-case)
- 示例:某层楼命名为 "A_6F"(6 楼)→ Blender Property: floorName = "A_6F"

### 目标字段 2: userData.renderType
- ...

### 目标字段 3: ...
- ...

## D. 命名规则建议

如果用户**没有任何业务知识**(纯 GLB 几何),你能给个**最小可行命名规则**,让他最少工作量就能让阶段 2 跑通吗?例如:
- 节点按 Y 高度分桶 → 自动生成 floorName (这种 fallback 我自己做,但你给个 fallback 触发条件)

## E. 兜底 (我打算做的)

我在 objectsTool 里会加 fallback:
- userData 为空时,按**节点 Y 高度**自动分桶生成 floorName ("Floor_1" / "Floor_2")
- userData 为空时,按**节点 size** 自动分类 renderType (大长方体 = WALL, 薄片 = WINDOW)
- node.name 不对时,允许 name 模糊匹配 (mesh_42 → mesh_4*)

请**评审这个兜底方案**:
- 边界是否合理?
- 有没有误判风险?
- 有没有更聪明的办法?

# 不要做的事

- ❌ 不要让我重跑 inspector (你已经看过输出了)
- ❌ 不要建议改 Three.js 代码 (我请你评估模型,不是改代码)
- ❌ 不要建议换模型(用户当前只能用这个 hospital.glb)
- ❌ 不要泛泛而谈"加 BIM 信息" — 要给**具体可执行的 Blender 操作**

# 工作流程

你按 A → B → C → D → E 顺序输出,**每个 section 都要有具体内容**,不要 "..." 占位。
````

---

## 使用方法

1. 复制"提示词正文"整块代码(包括最外层的 ```markdown 和 ```)
2. 粘贴到**全新对话**(新 LLM session)
3. 等待 LLM 输出 A → E 五部分内容
4. 把 **C 部分(Blender 指南)** 和 **B 部分(优先级)** 复制回来
5. 据此去 Blender 调整模型
6. 在开发环境重跑 `sspDev.modelInspector.scan()` 验证

---

## 提示词设计要点

**故意不让 LLM 做**:
- ❌ 不让重跑 inspector(已知数据,别浪费 tokens)
- ❌ 不让改代码(我们这边的事)
- ❌ 不让泛泛而谈(逼它给具体步骤)

**必须让 LLM 做**:
- ✅ 字段审计表(具体数字 / 样本)
- ✅ 优先级排序(让我知道先补哪个 ROI 最高)
- ✅ Blender 操作指南(可执行)
- ✅ 评审我的 fallback 方案(交叉验证)

---

## 输出预期

新对话 LLM 应该按这个顺序回答:

| Section | 内容 |
|---|---|
| A | 字段审计表(每个字段的存在性 / 数量 / 样本 / 影响) |
| B | 缺口优先级 top 3 |
| C | Blender 操作指南(每个优先级字段的具体步骤) |
| D | 命名规则建议 |
| E | fallback 方案评审 |

回来后给我 **B + C 两部分**,我据此:
1. 等你按 Blender 指南调整 GLB
2. 在开发环境重跑 `sspDev.modelInspector.scan()` 验证
3. 开始做 `objectsTool` 实现
