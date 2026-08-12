# Mesh Metadata 注入规范 (给工具方, v3.1)

> 这份文档**只**讲怎么给 GLB 的 mesh 节点注入元数据。
> 配套参考: [GLB_METADATA_SPEC.md](./GLB_METADATA_SPEC.md) 完整规范 (v3.1)。
> 工具输出验证: `node scripts/validate-metadata.mjs ./glb_cleaned`
>
> **v3.1 重要变化**:`renderType` 从 7 → **8** 种,删 `ROOF` 加 `FACILITY`(消防/安防器材)+ `WALL`(结构)。`FACILITY` 必须配 `fireType`(11 种)。

---

## 1. 输入

- 目录: `glb_cleaned/` (55 个 GLB)
- 每个 GLB 已经是 v2 规范:
  - `scenes[0].extras` 包含 5 字段: `floorName / building / level / floorType / name`
  - `nodes[i].extras` 已经被 `auto-fill.mjs` 注入了 5 字段冗余 + `findId`
  - **mesh 节点还缺**: `sid` / `renderType` / (SPACE 的) `spaceType`

**工具只看 mesh 节点**(`node.mesh !== undefined`),不动其他。

---

## 2. 工具的输入(数据来源)

工具需要拿到每个 mesh 的 `renderType` 信息,有两种方式:

### 方案 A: 基于 mesh.name 启发式(推荐,自动)

GLB 现有 mesh 节点名格式是 `MERGED_2_LIBENT1505_0` 等(MERGED_* 开头),**没有语义信息**。

**如果你用别的 GLB 源**(例如新导出的),`node.name` 可能已经含 renderType 提示,例如:
- `WINDOW_3_472431094_0` (前缀 `WINDOW_`)
- `DOOR_1_2035616329_0` (前缀 `DOOR_`)
- `ELEVATOR_2_...` (前缀 `ELEVATOR_`)

**启发式规则**:
```js
const m = name.match(/^(WINDOW|DOOR|ELEVATOR|STAIR|CEILING|WALL|SPACE|FACILITY)_/i)
if (m) {
  const renderType = m[1].toUpperCase()
  // 提取 SID 序列号 (WINDOW_3_472431094_0 中的 "3")
  const seqMatch = name.match(new RegExp(`^${renderType}_(\\d+)_`, 'i'))
  const seq = seqMatch ? parseInt(seqMatch[1]) : null
}
```

### 方案 B: 工具 UI 让用户挑(更可靠,但工作量大)

**如果方案 A 没法识别**(MERGED_*_ 开头的),让工具**让用户**手动选 renderType,或者**用一种"通用 MESH"作为 fallback**:
- `renderType: 'MESH'` (不在 8 种之一 — **不要用这个,会让 validate 报错**)
- 建议改成: `renderType: 'CEILING'` (因为 MERGED_* 多数是楼板 / 墙体 — 实际类别由人工确认)

### 推荐

**先跑方案 A 启发式**;如果 `name` 不匹配任何前缀,标 `renderType: 'CEILING'` 作为默认(后续人工 review)。**别用 'MESH'**(不是规范 enum)。

---

## 3. 工具输出(每个 mesh 要注入)

| 字段 | 类型 | 来源 | 例子 |
|---|---|---|---|
| `sid` | string | **必填,工具生成** | `WINDOW_A_6F_1` |
| `renderType` | enum | **必填,方案 A/B** | `WINDOW` / `DOOR` / `ELEVATOR` / `STAIR` / `CEILING` / `WALL` / `SPACE` / `FACILITY` (v3.1 共 8 种) |
| `spaceType` | enum | **renderType=SPACE 时必填** | `TOILET` / `LAUNDRY` / `KITCHEN` / `OFFICE` / `MEETING_ROOM` / `BEDROOM` / `CORRIDOR` / `STAIRWELL` / `ELEVATOR_HALL` / `MECHANICAL_ROOM` / `STORAGE` / `LOBBY` / `BALCONY` |
| `fireType` | enum | **renderType=FACILITY 时必填** (v3.1) | `HYDRANT` / `SMOKE_DETECTOR` / `SPRINKLER` / `EXTINGUISHER` / `EMERGENCY_LIGHT` / `EXIT_SIGN` / `BREAK_GLASS` / `ALARM_BELL` / `FIRE_HOSE` / `FIRE_DOOR` / `OTHER` (11 种) |
| `renderTypeConfidence` | string | 可选 | `high` / `low`(low = 工具推断,需人工 review) |

**不动的字段**(已经有,不要覆盖):
- `findId` / `floorName` / `building` / `level` / `floorType` / `name`

---

## 4. sid 编号规则(详细)

### 4.1 格式

```
<RENDERTYPE>_<FLOORNAME>_<SEQ>
```

- `RENDERTYPE`: renderType 大写
- `FLOORNAME`: scene.extras.floorName 一致 (例如 `A_6F` / `B_24F` / `LANDSCAPE_TERRAIN`)
- `SEQ`: 同 floorName + renderType 内的整数序号, **从 1 开始**

### 4.2 SEQ 编号规则

**两种编号方式**(任选):

| 方式 | 说明 | 例子 (A_6F 假设 3 个 WINDOW) |
|---|---|---|
| 按 node 索引 | 同 floorName + renderType 内, 按 node 数组的顺序编号 | WINDOW_A_6F_1, WINDOW_A_6F_2, WINDOW_A_6F_3 |
| 按 mesh 索引 | 同 floorName + renderType 内, 只数 mesh 节点编号 | 同样 WINDOW_A_6F_1/2/3 |

**推荐**: 按 **node 数组的索引**(更直观)。

### 4.3 编号算法(伪代码)

```js
// 1. 按 floorName 分组
// 2. 每个 floorName 内, 按 renderType 再分组
// 3. 每组按 node 数组的 index 升序
// 4. 从 1 开始生成 SEQ

const counters = new Map()  // key: `${floorName}|${renderType}`, value: counter

for (let i = 0; i < nodes.length; i++) {
  const n = nodes[i]
  if (n.mesh === undefined) continue
  if (!n.extras?.renderType) continue  // 没标 renderType 跳过

  const renderType = n.extras.renderType
  const floorName = n.extras.floorName || sceneExtras.floorName
  const key = `${floorName}|${renderType}`

  if (!counters.has(key)) counters.set(key, 0)
  counters.set(key, counters.get(key) + 1)
  const seq = counters.get(key)

  n.extras.sid = `${renderType}_${floorName}_${seq}`
}
```

### 4.4 例子

A_6F 内有 60 mesh, 其中:
- 2 个 DOOR
- 1 个 ELEVATOR
- 1 个 WINDOW
- 56 个其他(没 renderType)

**生成的 sid**:
- `DOOR_A_6F_1` (node#0)
- `DOOR_A_6F_2` (node#1)
- `ELEVATOR_A_6F_1` (node#2)
- `WINDOW_A_6F_1` (node#3)
- 其余 56 个 mesh 没 sid(因为没 renderType)

---

## 5. renderType 启发式(自动识别)

如果工具决定用启发式,看 mesh.name 的模式:

```js
function detectRenderType(name) {
  if (!name) return null
  // 匹配已知前缀
  const m = name.match(/^(WINDOW|DOOR|ELEVATOR|STAIR|CEILING|WALL|SPACE|FACILITY)/i)
  if (m) return m[1].toUpperCase()
  return null  // 没法识别, 返回 null
}
```

**没识别的 mesh**:
- 工具选择 1: 跳过(sid/renderType 都不填,后续人工)
- 工具选择 2: 给默认 `renderType: 'CEILING'` + `renderTypeConfidence: 'low'`(标 "待 review")
- **不推荐**: 填 `MESH` / `OTHER`(不在规范 enum,validate 会报错)

---

## 6. spaceType 处理(只在 SPACE mesh 用)

只有当 `renderType === 'SPACE'` 时,`spaceType` 必填。

**启发式**(从 mesh.name 或人工标):
- `TOILET` 名字含 toilet / 厕所 / wc
- `KITCHEN` 含 kitchen / 厨房
- `OFFICE` 含 office / 办公
- 等等

**没启发式**: 让人工选 13 种之一。

**spaceType 枚举**:
```
TOILET, LAUNDRY, KITCHEN, OFFICE, MEETING_ROOM, BEDROOM,
CORRIDOR, STAIRWELL, ELEVATOR_HALL, MECHANICAL_ROOM,
STORAGE, LOBBY, BALCONY
```

---

## 7. GLB 重新打包(关键 — 别搞错)

工具只能写 GLB 的 **JSON chunk**,**二进制 chunk (BIN) 必须原封不动保留**。

### 7.1 GLB 文件结构

```
GLB File
├── 12 byte header
│   ├── magic   "glTF" (4 bytes)
│   ├── version uint32 = 2
│   └── length  uint32 = total file size
│
├── JSON chunk
│   ├── length  uint32 = chunk length (含 4-byte padding)
│   ├── type    uint32 = 0x4E4F534A ("JSON")
│   └── data    <JSON 内容 + 0x20 (space) 填充至 4 字节对齐>
│
└── BIN chunk (可能有)
    ├── length  uint32
    ├── type    uint32 = 0x004E4942 ("BIN\0")
    └── data    <原始二进制数据>
```

### 7.2 重新打包规则

```js
function repackGLB(originalBuf, newGltf) {
  // 1. 提取原 JSON chunk 长度
  const origJsonLen = originalBuf.readUInt32LE(12)

  // 2. 复制原 BIN chunk (如果有)
  // BIN chunk 从 offset (20 + origJsonLen) 开始
  const binStart = 20 + origJsonLen
  let binChunk = Buffer.alloc(0)
  if (binStart < originalBuf.length) {
    const binChunkLen = originalBuf.readUInt32LE(binStart)
    binChunk = originalBuf.subarray(binStart, binStart + 8 + binChunkLen)
  }

  // 3. 序列化新 JSON
  const newJsonStr = JSON.stringify(newGltf)
  const newJsonBytes = Buffer.from(newJsonStr, 'utf-8')
  const padLen = (4 - (newJsonBytes.length % 4)) % 4
  const newJsonPadded = Buffer.concat([newJsonBytes, Buffer.alloc(padLen, 0x20)])

  // 4. 组装新 GLB
  const newTotalLen = 20 + newJsonPadded.length + binChunk.length
  const out = Buffer.alloc(newTotalLen)
  out.write('glTF', 0, 4, 'utf-8')
  out.writeUInt32LE(2, 4)  // version
  out.writeUInt32LE(newTotalLen, 8)
  out.writeUInt32LE(newJsonPadded.length, 12)  // JSON chunk length
  out.writeUInt32LE(0x4E4F534A, 16)  // JSON type
  newJsonPadded.copy(out, 20)

  // 5. 复制原 BIN chunk (含 header)
  binChunk.copy(out, 20 + newJsonPadded.length)

  return out
}
```

### 7.3 验证规则

重新打包后**必须**满足:
- `out.readUInt32LE(8) === out.length` (总长度正确)
- `out.toString('utf-8', 0, 4) === 'glTF'`
- `out.readUInt32LE(4) === 2`
- JSON chunk type = 0x4E4F534A
- JSON chunk 4-byte 对齐
- BIN chunk **完全原样** (字节级一致)

---

## 8. 不允许的操作

| 操作 | 为什么 |
|---|---|
| 改 `scenes[0].extras.floorName / building / level / floorType / name` | 已经是 v2 规范,覆盖会丢信息 |
| 改 `meshes[] / buffers[] / bufferViews[] / accessors[]` | 改了就破 GLB,几何会错 |
| 改 `node.name` | 已有 MERGED_*_* 名字,改了可能影响引用 |
| 改 `node.matrix` | 改了就破坏建筑坐标(每个 GLB 内部坐标) |
| 改 `materials[] / textures[]` | 同上,渲染错乱 |
| 重新计算 GLB 的 binary chunk | 几何错位,会闪烁/漏 mesh |
| 给 renderType 填 `MESH / OTHER / WALL` 等不在 8 种的值 | validate 报错 |

---

## 9. 允许的操作

| 操作 | 怎么改 |
|---|---|
| 写 `node.extras.sid` | 工具生成,格式 `<RT>_<FN>_<SEQ>` |
| 写 `node.extras.renderType` | 8 种之一(启发式或人工) |
| 写 `node.extras.spaceType` | renderType=SPACE 时,13 种之一 |
| 写 `node.extras.fireType` | renderType=FACILITY 时,11 种之一 (v3.1) |
| 写 `node.extras.renderTypeConfidence` | `high` / `low` |
| 加新 `node.extras.<key>` | 跟未来 v3 spec 对齐,但**当前不要加**(避免冲突) |

---

## 10. 跳过/不处理的 mesh

工具碰到下面情况**跳过 sid 注入**(不报错,只是不填):

| 情况 | 处理 |
|---|---|
| `node.mesh === undefined` (group 节点) | 跳过 |
| `node.extras` 没有 `floorName` (理论上不会出现,因为 auto-fill 已经填) | 跳过,记日志 |
| `renderType` 启发式失败,工具选择 "跳过" | 跳过,记日志,后续人工 |
| `renderType` 启发式失败,工具选择 "默认 CEILING + low" | 标 CEILING,confidence=low |

**输出报告**:
```
A_6F.glb: 60 mesh 总数
  - 3 WINDOW (有 sid, renderType=WINDOW, confidence=high)
  - 2 DOOR
  - 1 ELEVATOR
  - 54 其他 (默认 CEILING, confidence=low)
  - 0 失败
```

---

## 11. 工具输出验证

跑完之后跑:
```bash
node scripts/validate-metadata.mjs ./glb_cleaned
```

**期望**:
- `0 errors`
- `passRate.sid` 接近 100%(漏的应该都是"无法识别的 mesh",或被工具标为 'CEILING' 之类的)
- `passRate.renderType` 接近 100%
- `passRate.spaceType` 100% (仅 SPACE mesh 算,没 SPACE 的话是 0/0)
- `sidDuplicates = 0` (sid 全局唯一,这是底线)

**不期望**:
- sid 重复(同 sid 出现 2 次)
- 任何 scene.extras 错误
- findId 错误(已经填过,工具不要碰)

---

## 12. 完整例子

### 输入(A_6F.glb 的部分 mesh 节点)
```json
{
  "nodes": [
    {
      "name": "WINDOW_3_472431094_0",
      "mesh": 0,
      "extras": {
        "findId": "A_6F_mesh_0",
        "floorName": "A_6F",
        "building": "A",
        "level": 6,
        "floorType": "FLOOR",
        "name": "WINDOW_3_472431094_0"
      }
    },
    {
      "name": "DOOR_1_2035616329_0",
      "mesh": 1,
      "extras": {
        "findId": "A_6F_mesh_1",
        "floorName": "A_6F",
        "building": "A",
        "level": 6,
        "floorType": "FLOOR",
        "name": "DOOR_1_2035616329_0"
      }
    }
  ]
}
```

### 工具输出(注入后)
```json
{
  "nodes": [
    {
      "name": "WINDOW_3_472431094_0",
      "mesh": 0,
      "extras": {
        "findId": "A_6F_mesh_0",
        "floorName": "A_6F",
        "building": "A",
        "level": 6,
        "floorType": "FLOOR",
        "name": "WINDOW_3_472431094_0",
        "sid": "WINDOW_A_6F_1",
        "renderType": "WINDOW",
        "renderTypeConfidence": "high"
      }
    },
    {
      "name": "DOOR_1_2035616329_0",
      "mesh": 1,
      "extras": {
        "findId": "A_6F_mesh_1",
        "floorName": "A_6F",
        "building": "A",
        "level": 6,
        "floorType": "FLOOR",
        "name": "DOOR_1_2035616329_0",
        "sid": "DOOR_A_6F_1",
        "renderType": "DOOR",
        "renderTypeConfidence": "high"
      }
    }
  ]
}
```

---

## 13. 边界情况

### 13.1 多个文件 sid 不冲突

sid 是**全局唯一**(全 55 个 GLB 一起看),但**工具每个文件独立处理**:

- **风险**: 工具不知道其他文件,可能生成本文件唯一的 sid,但跨文件冲突
- **解决**: 工具**先扫所有 GLB**,统计 (floorName, renderType) 组合,统一编号

**或者**(简化,接受跨文件 sid 可能重复):
- 工具每个文件独立,从 1 开始
- 接受重复
- validate 报 `sidDuplicates > 0`,**人工调整**

**强烈推荐**: 工具**全量扫一遍,统一编号**。

### 13.2 已有 sid

如果 mesh 已经有 sid(例如 manual inject 过了),**不要覆盖**。除非加 `--force` flag。

### 13.3 渲染数据校验

工具跑完,跑 `gltf-validator` 或自己解析,确保:
- GLB magic / version / totalLength 一致
- JSON chunk 4-byte 对齐
- BIN chunk 长度 = `buffers[0].byteLength`
- 引用 (`bufferView[].buffer` 索引) 没破

**最简单**: 跑 `node scripts/validate-metadata.mjs`,0 errors 就算过。

### 13.4 文件大小

注入 metadata **只增加几百字节 / 文件**(取决于 mesh 数量)。GLB 文件大小基本不变。**如果某文件大小差 > 1KB,可能写错了**。

---

## 14. 输出报告模板

工具跑完应该输出:

```
=== Mesh Metadata Injection Report ===
Source:     glb_cleaned/  (55 files)
Total mesh: 7942
Injected:   6000  (sid + renderType)
Default:    1500  (CEILING fallback, confidence=low)
Skipped:    400   (无法识别 renderType)
Failed:     0

─── Per-renderType counts ──
WINDOW:     1234
DOOR:       234
ELEVATOR:   100
STAIR:      50
CEILING:    5600 (含屋顶, v3 含义扩大)
WALL:       20 (v3 新增)
SPACE:      0  ← 需要人工补 spaceType
FACILITY:   0  ← v3.1 新增,暂无消防/安防器材

─── Validation ──
$ node scripts/validate-metadata.mjs ./glb_cleaned
errors: 0
warnings: 1000 (主要: 缺中文 name, 缺 spaceType for SPACE mesh)
```

---

## 15. 完成后给前端的"接力"信息

工具跑完,前端做这些事:

1. **ssp.objectsTool** 改 API:
   - `getById(sid)` 用 `userData.sid` 查
   - `getByUserDataProperty('renderType', 'WINDOW')` 查窗户
   - `getByUserDataProperty('spaceType', 'TOILET')` 查厕所
2. **模板 (soonspace-style)** 改措辞:
   - `getByUserDataProperty('renderType', 'WINDOW')` 替代旧的 `ROOM`
   - `getById('DOOR_A_6F_1')` 替代 `sid` 查找
3. **下拉框** 改用 `name` (中文) 而非 floorName (英文)
4. **场景加载** modelTool 继续工作,自动继承新 metadata

---

## 16. 工具方需要准备

| 准备 | 说明 |
|---|---|
| 读 GLB JSON chunk 能力 | 必须,标准 GLB 解析 |
| 写 GLB JSON chunk + 保留 BIN chunk 能力 | 必须,看 §7 重新打包规则 |
| 启发式 (renderType from name) 或 UI (人工标) | 至少一种 |
| sid 全局唯一性处理 | 强烈建议 §13.1 |
| validate-metadata.mjs 跑通 | 工具跑完必跑,0 errors 才算完 |
| 输出报告 (§14) | 告诉前端做了多少 |

---

## 17. FAQ

**Q: 注入 sid 后,前端 ssp.objectsTool 怎么用?**
A: `ssp.objectsTool.getById('DOOR_A_6F_1')` 走 `userData.sid` 查找。

**Q: 工具不识别 mesh.name(MERGED_* 开头),怎么办?**
A: 标 `renderType: 'CEILING', renderTypeConfidence: 'low'`,后续人工 review。

**Q: SPACE mesh 一定要有 spaceType 吗?**
A: 是,validate 报错。

**Q: 可以加新字段 (如 `material`) 吗?**
A: 当前不要,v2 spec 没列。后续 v3 扩展。

**Q: tool 是 1 个文件 1 个文件处理,还是全 batch?**
A: 推荐 batch,确保 sid 全局唯一(§13.1)。

**Q: 工具跑完,前端多久能用?**
A: 工具跑完 → 复制 glb_cleaned/ 到 public/models/hospital/ → 跑 `npm run list-models` → 前端 dev server 重启 → 全部生效。

**Q: 验证脚本?**
A: `node scripts/validate-metadata.mjs ./glb_cleaned --strict` (strict 把 warning 也算 fail)
