# 面向 AI 的数据结构说明

> 这是**面向 AI Agent** 的说明文档,告诉 AI 怎么理解、解析和使用这份 GLB 数据。
> 后续 Space AI Platform 的智能体需要这份文档才能正确理解每个楼层是什么、在哪、有什么构件。

---

## 📂 目录内容

本目录包含 **55 个独立 GLB 文件**,每个代表建筑的一个楼层或景观元素。

```
glb_cleaned/
├── A_1F.glb ~ A_15F.glb           # A 楼 1-15 层
├── A_T.glb                        # A 楼塔楼顶层
├── A_DING.glb                     # A 楼屋顶 (v3 起含原屋顶装饰, 并入 ROOF)
├── B_1F.glb ~ B_24F.glb           # B 楼 1-24 层(更高)
├── B_T.glb, B_DING.glb            # B 楼顶层/屋顶
├── C_6F.glb ~ C_10F.glb           # C 楼 6-10 层
├── C_DING.glb                     # C 楼屋顶 (v3 起含原屋顶装饰, 并入 ROOF)
├── BASEMENT_B1.glb ~ BASEMENT_B4.glb  # 共享地下室 4 层
├── LANDSCAPE_TERRAIN.glb          # 地形
└── LANDSCAPE_FACADE.glb           # 外立面
```

**总计**:55 个文件 / 3 栋楼 / 1 个共享地下 / 2 个景观

---

## 🔧 GLB 数据结构(给 AI Agent 看)

### GLB 文件格式

GLB 是二进制容器,结构如下:

```
[12 字节头部][JSON chunk][BIN chunk(可选)]

头部:
  - magic:   4 字节 "glTF" (= 0x46546C67)
  - version: 4 字节 (固定为 2)
  - length:  4 字节 (整个文件字节数)

JSON chunk:
  - length:  4 字节
  - type:    4 字节 "JSON" (= 0x4E4F534A)
  - data:    JSON 文本,描述场景结构

BIN chunk(可选):
  - length:  4 字节
  - type:    4 字节 "BIN\0" (= 0x004E4942)
  - data:    二进制顶点 / 索引 / 纹理数据
```

**纯解析不需要任何库**:任何语言都能直接读 JSON 部分。

---

## 📋 JSON 数据结构(关键)

每个 GLB 的 JSON 部分长这样:

```js
{
  "asset": {
    "version": "2.0",
    "extras": {                   // ⭐ 我们注入的 metadata
      "floorName": "A_1F",
      "building": "A",
      "level": 1,
      "floorType": "FLOOR",
      "injectedBy": "...",
      "injectedAt": "..."
    }
  },
  "scenes": [{
    "name": "A_1F",               // ⭐ scene 名 = floorName
    "extras": { ... }             // ⭐ scene-level metadata
  }],
  "nodes": [                       // 节点树,每个 mesh 都在这里
    {
      "name": "DOOR_1_...",        // 节点名(用于 renderType 推断)
      "mesh": 8,                   // 引用 mesh 数组里的第 8 个
      "extras": { ... }            // ⭐ node-level metadata,含 renderType
    },
    ...
  ],
  "meshes": [                      // 几何数据,体积大,AI 不用关心
    ...
  ],
  "materials": [...],              // 材质定义
  "textures": [...],               // 纹理引用
  "buffers": [...],                // BIN chunk 的元数据
  "bufferViews": [...],
  "accessors": [...]               // 顶点 / 法线 / UV 等数据视图
}
```

---

## ⭐ Metadata Schema(AI Agent 必须理解)

### 顶层字段(每个 GLB 都有)

| 字段 | 类型 | 取值 | 说明 |
|---|---|---|---|
| `floorName` | string | `A_1F` / `BASEMENT_B1` / `LANDSCAPE_TERRAIN` | **唯一标识**,等于 scene 名 |
| `building` | string \| null | `A` / `B` / `C` / `COMMON` / null | 楼栋;`COMMON`= 共享设施;null = 景观 |
| `level` | number \| null | 1~24 / 99 / 100 / 101 / -1~-4 / null | 楼层号;`T`=max+1, `RF`=max+2, `DING`=max+3;`B\d+`=负数;景观=null |
| `floorType` | string | `FLOOR` / `TOWER` / `ROOF` / `BASEMENT` / `LANDSCAPE_TERRAIN` / `LANDSCAPE_FACADE` / `FACILITY` | 楼层类型 (v3: 7 种,ROOF_DECORATION 并入 ROOF) |
| `semantic` | object | ⭐ **中文语义层,给 AI 用** | 见下 |

### ⭐ `semantic` 字段(给 AI 用的中文)

每个 metadata 都带一个 `semantic` 对象,**AI 应优先读这个**,避免解析英文 ID。

**楼层级 semantic**(scene / asset / root node 都有):
```js
{
  "category": "楼层",              // 固定为 "楼层"
  "subcategory": "标准层",          // 中文:标准层 / 塔楼顶层 / 屋顶机房 / 地下室 / 地形 / 建筑外立面 (v3 起"屋顶装饰"已并入"屋顶")
  "displayName": "A 楼 第 1 层 (标准层)",   // ⭐ 完整中文显示名
  "description": "A 楼 的 第 1 层 楼层,类型: 标准层",  // ⭐ 给 AI 的描述
  "buildingCN": "A 楼",            // ⭐ 楼栋中文
  "levelDesc": "第 1 层",           // ⭐ 楼层中文(地下 / 顶层 也支持)
  "typeCN": "标准层"               // 中文 floorType
}
```

**构件级 semantic**(每个 mesh):
```js
{
  "category": "门",                // ⭐ 中文大分类: 窗 / 门 / 电梯 / 楼梯 / 天花板 / 屋顶
  "subcategory": null,             // 未来可扩展
  "displayName": "A 楼 第 1 层 1 号 门",  // ⭐
  "description": "A 楼 第 1 层 的一个门",  // ⭐
  "buildingCN": "A 楼",
  "levelDesc": "第 1 层",
  "typeCN": "DOOR"                 // 原始 renderType(英文)
}
```

### 子 mesh 字段(可能存在)

| 字段 | 类型 | 取值 | 说明 |
|---|---|---|---|
| `name` | string | `DOOR_1_2035616329_0` 等 | 原始节点名,用于 renderType 推断 |
| `renderType` | string \| null | `WINDOW` / `DOOR` / `ELEVATOR` / `STAIR` / `CEILING` / `ROOF` / null | 构件类型(自动标注,不保证完整) |
| `renderTypeConfidence` | string | `high` / `low` | 标注置信度 |
| `semantic` | object | ⭐ 中文语义(同楼层级 schema) | 给 AI 看 |

### 楼层号(level)映射规则

```
A_1F.glb   → level 1       (1-15 是楼层,共 15 层)
A_15F.glb  → level 15
A_T.glb    → level 16       (T = max + 1 = 塔楼顶层)
A_DING.glb → level 18       (DING = max + 3 = 屋顶, v3 起含原屋顶装饰)
B_24F.glb  → level 24
B_T.glb    → level 25       (T = max + 1 = 塔楼顶层)
B_DING.glb → level 27
BASEMENT_B1.glb → level -1 (B1 地下室)
LANDSCAPE_TERRAIN.glb → level null
```

---

## 🤖 AI Agent 怎么用

### ⭐ 推荐:用 `semantic.category` 字段(中文,直接用)

**AI 不需要解析英文节点名**,直接读 `semantic.category` 字段就行:

```js
// 用户问"找这栋楼的所有门"
// → 直接遍历子 mesh,看 semantic.category === '门'
group.traverse(o => {
  if (o.userData?.semantic?.category === '门') {
    // 高亮,标注,等
  }
})
```

```js
// 用户问"找 A 楼所有窗"
group.traverse(o => {
  const s = o.userData?.semantic
  if (s?.category === '窗' && s?.buildingCN === 'A 楼') {
    // ...
  }
})
```

```js
// 用户问"显示楼层描述"
const desc = scene.userData.semantic.description
// "A 楼 的 第 1 层 楼层,类型: 标准层"
```

```js
// 用户问"找所有地下室"
INDEX.filter(e => e.semantic?.subcategory === '地下室')
```

### 任务 1:回答"X 楼有多少层?"

```js
const buildings = {
  A: { floors: [], tower: null, ding: null },
  B: { ... },
  // ...
}
// 扫描所有 GLB 的 scene.extras.building + level 聚合
```

### 任务 2:回答"X 楼有哪些 WINDOW?"

```js
// 方式 1:用中文 semantic(推荐)
group.traverse(o => {
  if (o.userData?.semantic?.category === '窗') { /* ... */ }
})

// 方式 2:用英文 renderType
group.traverse(o => {
  if (o.userData?.renderType === 'WINDOW') { /* ... */ }
})
```

### 任务 3:用户问"带我去 B 楼 24 层"

```js
// 1. 加载 B_24F.glb
// 2. scene.userData.building === 'B'
// 3. scene.userData.level === 24
// 4. flyToObject(scene)
```

### 任务 4:用户问"展示所有楼栋的入口"

```js
// 用中文 semantic 找门
for (const gltf of allGlbs) {
  gltf.scene.traverse(o => {
    if (o.userData?.semantic?.category === '门') {
      // 标红高亮
    }
  })
}
```

---

## 🔨 不需要任何外部库即可解析

任何语言 10 行内就能读 metadata:

### Python

```python
import struct, json

def read_metadata(path):
    with open(path, 'rb') as f:
        data = f.read()
    c0_len = struct.unpack('<I', data[12:16])[0]
    gltf = json.loads(data[20:20+c0_len].decode('utf-8'))
    return gltf

gltf = read_metadata('A_1F.glb')
print(gltf['scenes'][0]['extras'])
# {'floorName': 'A_1F', 'building': 'A', 'level': 1, 'floorType': 'FLOOR', ...}
```

### Node.js

```js
import fs from 'fs'

function readMetadata(path) {
  const buf = fs.readFileSync(path)
  const c0Len = buf.readUInt32LE(12)
  const jsonStr = buf.subarray(20, 20 + c0Len).toString('utf-8')
  return JSON.parse(jsonStr)
}

const gltf = readMetadata('A_1F.glb')
console.log(gltf.scenes[0].extras)
// { floorName: 'A_1F', building: 'A', level: 1, floorType: 'FLOOR', ... }
```

### Browser (JS)

```js
const res = await fetch('A_1F.glb')
const buf = await res.arrayBuffer()
const view = new DataView(buf)
const c0Len = view.getUint32(12, true)
const jsonStr = new TextDecoder().decode(buf.slice(20, 20 + c0Len))
const gltf = JSON.parse(jsonStr)
console.log(gltf.scenes[0].extras)
```

---

## 📐 数据规模参考

| 项目 | 数量 |
|---|---|
| GLB 文件总数 | 55 |
| 单层 mesh 数量 | 60 ~ 600(平均 ~150) |
| 总体 mesh 数 | ~8000 |
| 单 GLB 大小 | 1MB ~ 50MB |
| 总大小 | ~700MB |
| WINDOW mesh 数(标注) | ~30 ~ 60 per floor |
| DOOR mesh 数(标注) | ~2 ~ 100 per floor |

---

## ⚠️ 重要注意事项(AI 必须知道)

1. **每个 GLB 是独立的场景**——不要尝试合并 GLB 文件来"加快加载"。55 个独立 GLB 是设计决定,合并会丢失 instancing 优化。

2. **`renderType` 标注只覆盖 6 种**(WINDOW/DOOR/ELEVATOR/STAIR/CEILING/ROOF)。其他节点(如 `mesh_339`、`MERGED_0_*`)没有标注,不代表它们没有功能,只是没分类。

3. **GLB 的坐标系是原平台导出的世界坐标**,不是楼层相对坐标。**不要试图重新计算坐标**。每个 GLB 加载后可以直接 `add` 到主场景,位置由其内部 mesh matrix 决定。

4. **GLB 文件依赖 HTTP 服务**,浏览器禁止 `file://` 加载 binary GLB。

5. **metadata 在 JSON 的多个位置都有冗余**(`asset.extras` / `scene.extras` / `node.extras`),取一个就行。

---

## 📚 关联文档

| 文档 | 说明 |
|---|---|
| [../GLB metadata import/README.md](../GLB%20metadata%20import/README.md) | GLB 注入工具使用指南 |
| [../GLB metadata import/PROGRESS.md](../GLB%20metadata%20import/PROGRESS.md) | 工具开发记录 |
| [../GLB metadata import/INTEGRATION_PROMPT.md](../GLB%20metadata%20import/INTEGRATION_PROMPT.md) | 下游 chat 接入提示词 |

---

## 🎯 验证步骤

在你开始用之前,先用 1 个文件验证:

```bash
# 在 glb_cleaned/ 目录
python3 -c "
import struct, json
with open('A_1F.glb', 'rb') as f: data = f.read()
c0_len = struct.unpack('<I', data[12:16])[0]
gltf = json.loads(data[20:20+c0_len])
print('scene.extras:', gltf['scenes'][0].get('extras'))
print('asset.extras:', gltf.get('extras'))
print('first mesh node:', next((n for n in gltf['nodes'] if n.get('mesh') is not None), None))
"
```

期望输出:
```
scene.extras: {'floorName': 'A_1F', 'building': 'A', 'level': 1, 'floorType': 'FLOOR', ...}
asset.extras: {'floorName': 'A_1F', 'injectedBy': '...', ...}
first mesh node: {'name': 'DOOR_1_...', 'extras': {'renderType': 'DOOR', ...}, ...}
```

如果你看到了 metadata,就可以开始用了。

---

最后更新:2026-07-25