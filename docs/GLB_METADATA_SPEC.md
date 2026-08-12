# GLB Metadata 规范 (v3.1)

> 给 BIM / Blender 导出 GLB 时的元数据 (extras) 注入规范。
> 配套验证脚本: `node scripts/validate-metadata.mjs`
>
> **Blender 操作员看这份**: [BLENDER_METADATA_GUIDE.md](./BLENDER_METADATA_GUIDE.md) — 简化版,只讲 Blender 怎么填。

## v3.1 变更(2026-07,在 v3 基础上)

| 字段 | 变化 |
|---|---|
| `renderType` | 7 → **8** 种:加 `FACILITY`(消防 / 安防器材),必须配 `fireType` 子分类 |
| `fireType` | **新增**字段,11 种 (HYDRANT / SMOKE_DETECTOR / SPRINKLER / EXTINGUISHER / ...) |
| `VALID_FIRE_TYPES` | 新增 Set,在 `validate-metadata.mjs` 顶部 |

## v3 变更(2026-07)

| 字段 | 变化 |
|---|---|
| `floorType` | 8 → **7** 种:删 `ROOF_DECORATION`,并入 `ROOF` |
| `renderType` | 7 种,删 `ROOF` 加 `WALL`:屋顶 mesh 一律归 `CEILING`;墙/柱/梁等结构用新 `WALL` |
| §0.X 边界规则 | 新增,明确 floorType / renderType 各管什么 |

## v3.1 变更(2026-07-29,A_1F 实测后确认)

| 字段 | 变化 |
|---|---|
| `renderType` | 7 → **8** 种:加 `FACILITY`(消防 / 安防器材, 11 种 fireType 强制必填) |
| `fireType` | **新增** enum (11 种, 仅 FACILITY mesh 用) |
| `WALL` | 在 v3 加了, v3.1 仍是渲染外墙/承重墙/幕墙/玻璃幕墙(独立于 FACILITY) |
| §3.4 mesh.name 命名 | 8 方位 (`N / NE / E / SE / S / SW / W / NW`) + 顺时针 SEQ |

**A_1F 实际数据**(2026-07-29 注入完成, 139 mesh):
- CEILING 2, DOOR 101, ELEVATOR 4, FACILITY 7 (全 HYDRANT), STAIR 4, WALL 1, WINDOW 20

---

## 0. 总览

每个 GLB 包含两类 metadata:

| 层级 | 字段 | 说明 |
|---|---|---|
| **scene.extras** | 描述整个 GLB 是什么 (1 份) | floorName / building / level / floorType / name |
| **node.extras** | 描述每个 mesh 节点 (n 份) | sid / findId / renderType / spaceType / name / 冗余字段 |

---

## 0.5. 边界规则(关键)

**`floorType` 和 `renderType` 各管一头,互不越界**:

| 字段 | 负责回答 | 颗粒度 | 不负责 |
|---|---|---|---|
| `floorType` (scene 级) | "**这层**整体是什么?" | 7 种(v3 起, 每层 1 个) | 不管里面 mesh 种类 |
| `renderType` (node 级) | "**这个 mesh** 是什么构件?" | **8 种**(v3.1 起, 每 mesh 1 个) | 不管这层是什么 |

### 边界 1:`floorType.ROOF` 是整层,跟 `renderType` 无关

`renderType=ROOF` **不存在** (v3 删了)。屋顶层的所有 mesh 一律按几何特性标:
- 朝上的板(瓦片/防水层)= `CEILING`(含义扩大,包括任何水平板)
- 朝下的板(室内顶/楼板)= `CEILING`
- 屋顶装饰/天线 = `CEILING`(v3 起,没有 ROOF_DECORATION)

### 边界 2:`renderType.CEILING` 的含义扩大

**`CEILING` 现在覆盖**:
- 标准层楼板(`floorType=FLOOR` 的层)
- 地下室楼板(`floorType=BASEMENT`)
- 屋顶层楼板 + 屋顶装饰(`floorType=ROOF`)
- 任何水平的"板"类 mesh

### 边界 3:`renderType` 8 种列表(v3.1)

| 值 | 含义 | 例子 |
|---|---|---|
| `WINDOW` | 窗户 | 玻璃 + 窗框 |
| `DOOR` | 门 | 单扇 / 双扇 |
| `ELEVATOR` | 电梯 | 电梯井 + 电梯门 |
| `STAIR` | 楼梯 | 踏步 + 栏杆(构件级,不是空间) |
| `CEILING` | **任何水平的板**(楼板 / 屋顶板 / 装饰) | 覆盖 v2 的 CEILING + ROOF |
| `WALL` | **结构**(墙 / 柱 / 梁) | v3 新增 |
| `SPACE` | 空间区域(必须有 spaceType) | 男厕 / 会议室 / 走廊(占位 mesh) |
| `FACILITY` | **消防 / 安防器材**(必须有 fireType) | v3.1 新增:消火栓 / 烟感 / 喷淋 / 灭火器 / ... |

> **SPACE 占位 mesh**:每个空间放一个简单的几何体(plane),userData 跟其他 renderType 一致。详见 §0.7。
>
> **FACILITY 设备 mesh**:每台器材放一个 mesh(userData 加 fireType 子分类),详见 §0.8。

### 边界 4:floorType 7 种列表(v3)

| 值 | 含义 |
|---|---|
| `FLOOR` | 标准楼层 |
| `TOWER` | 塔楼顶层 |
| `ROOF` | 屋顶(**含**原 ROOF_DECORATION) |
| `BASEMENT` | 地下室 |
| `LANDSCAPE_TERRAIN` | 地形 |
| `LANDSCAPE_FACADE` | 外立面 |
| `FACILITY` | 共享设施 |

### 边界 5:`LANDSCAPE_FACADE` mesh 的标法

`LANDSCAPE_FACADE.glb` 里的 mesh 没有 CEILING 以外的合适枚举。**建议标法**:

| mesh 类型 | renderType |
|---|---|
| 楼板 / 地面 | `CEILING` |
| 外立面墙体 | `WALL` |
| 屋顶 | `CEILING` |

> 之前妥协是全部归 `CEILING`,v3 起优先用 `WALL`。

---

## 0.7. SPACE 定义(占位 mesh 方案,A)

**当前方案**:每个空间 = 1 个 mesh(占位),形态自由(推荐 plane)。

```
例 A_6F 男厕:
  - 1 个 mesh(任意几何,推荐 plane 框出范围)
  - userData:
    - sid: "SPACE_A_6F_MR_TOILET_01"
    - renderType: "SPACE"
    - spaceType: "TOILET"
    - floorName: "A_6F"
    - building: "A"
    - level: 6
  - 渲染建议:半透明色块(便于用户看到空间边界)
    - TOILET = 半透明绿色
    - MEETING_ROOM = 半透明黄色
    - 其他 = 半透明蓝色
```

**优点**:
- 跟前 6 种 renderType 一致,userData 一样,代码 0 改动
- 点击 / 高亮 / flyToObject 直接命中 mesh

**未来切换到 B 方案**:见 [SPACE_STRATEGY.md](./SPACE_STRATEGY.md)

---

## 0.8. FACILITY 定义(消防 / 安防器材,v3.1 新增)

**当前方案**:每台器材 = 1 个 mesh(独立 mesh,跟 SPACE 占位思路类似,但 FACILITY mesh **就是器材本身**,不是占位)。

```
例 A_6F 烟感:
  - 1 个 mesh(器材实际几何)
  - userData:
    - sid:        "FACILITY_A_6F_SMOKE_DETECTOR_01"
    - renderType: "FACILITY"
    - fireType:   "SMOKE_DETECTOR"
    - floorName:  "A_6F"
    - building:   "A"
    - level:      6
```

### fireType 枚举(11 种,**严格大写**)

| 值 | 中文 | 用途 |
|---|---|---|
| `HYDRANT` | 消火栓 | 室内 / 室外消火栓 |
| `SMOKE_DETECTOR` | 烟感 | 烟雾报警器 |
| `SPRINKLER` | 喷淋 | 自动喷淋头 |
| `EXTINGUISHER` | 灭火器 | 手提式 / 推车式 |
| `EMERGENCY_LIGHT` | 应急照明 | 应急灯 / 疏散指示灯 |
| `EXIT_SIGN` | 安全出口标志 | 出口标志牌 |
| `BREAK_GLASS` | 破玻按钮 | 手动火灾报警按钮 |
| `ALARM_BELL` | 警铃 | 火灾警铃 |
| `FIRE_HOSE` | 水带接口 | 消防水带接口 |
| `FIRE_DOOR` | 防火门 | 防火卷帘 / 防火门(跟 DOOR 区别) |
| `OTHER` | 其他 | 其他消防 / 安防器材 |

### 边界(跟其他 renderType 不冲突)

| 类型 | 标什么 |
|---|---|
| 烟感(挂天花板) | `FACILITY` + `fireType=SMOKE_DETECTOR`,**不**标 CEILING |
| 喷淋头(挂天花板) | `FACILITY` + `fireType=SPRINKLER`,**不**标 CEILING |
| 消火栓(挂墙) | `FACILITY` + `fireType=HYDRANT`,**不**标 WALL |
| 灭火器(挂墙 / 放地) | `FACILITY` + `fireType=EXTINGUISHER`,**不**标 WALL |
| 防火门 | `FACILITY` + `fireType=FIRE_DOOR`(是消防设备) **或** `DOOR`(是普通门)— 看建模意图 |

> **原则**:`renderType=FACILITY` 跟位置无关,**不管挂墙还是挂顶** — 它**本身就是设备**,不是建筑构件。

### sid 命名

```
FACILITY_<FLOORNAME>_<FIRE_TYPE>_<SEQ>

例:
  FACILITY_A_6F_HYDRANT_01
  FACILITY_A_6F_SMOKE_DETECTOR_01
  FACILITY_B_24F_SPRINKLER_01
  FACILITY_A_1F_EMERGENCY_LIGHT_03
```

### 前端用法

```js
// 找所有烟感
const detectors = ssp.objectsTool.getByUserDataProperty('fireType', 'SMOKE_DETECTOR')

// 找 A_6F 所有消防设备
const floorFire = ssp.objectsTool.getByUserDataProperty('renderType', 'FACILITY', { scope: 'A_6F' })

// 警报: 所有消火栓红色闪烁
const hydrants = ssp.objectsTool.getByUserDataProperty('fireType', 'HYDRANT')
ssp.objectsTool.setHighlight(hydrants, '#ff0000', true)  // pulse
```

### 跟 floorType.FACILITY 的关系

| 字段 | 含义 |
|---|---|
| `floorType.FACILITY` (scene 级) | "**这整层**是共享设施"(机房、整层电梯) |
| `renderType.FACILITY` (node 级) | "**这个 mesh** 是一台消防 / 安防器材" |

**两个独立,词根一致** — 跟 v3 边界规则一致,颗粒度不同。

---

## 1. scene.extras (整层)

存放在 GLTF JSON 的 `scenes[0].extras`。

| 字段 | 类型 | 必填 | 说明 | 例子 |
|---|---|---|---|---|
| `floorName` | string | ✅ | 全局唯一 ID, 跟文件名一致 | `"A_6F"` |
| `building` | string \| null | ⚠️ 推荐 | 楼栋编号; LANDSCAPE 必填 null | `"A"` / `"B"` / `"C"` / `"COMMON"` / `null` |
| `level` | number \| null | ⚠️ 推荐 | 楼层号; LANDSCAPE 必填 null | `1` ~ `24` / `-1` ~ `-4` / `99` / `null` |
| `floorType` | enum | ✅ | 见下表 | `"FLOOR"` |
| `name` | string | 推荐 | 中文人类可读名, 给人/大模型看 | `"A 楼 6 层"` |

**floorType 枚举**(7 种,v3 起):

| 值 | 含义 |
|---|---|
| `FLOOR` | 标准楼层 |
| `TOWER` | 塔楼顶层 (最高层上面) |
| `ROOF` | 屋顶(**含**装饰/天线,v3 起) |
| `BASEMENT` | 地下室 |
| `LANDSCAPE_TERRAIN` | 地形 (LANDSCAPE_TERRAIN.glb) |
| `LANDSCAPE_FACADE` | 外立面 (LANDSCAPE_FACADE.glb) |
| `FACILITY` | 共享设施 (机房 / 整层电梯) |

**完整例子**:
```json
{
  "scenes": [
    {
      "extras": {
        "floorName": "A_6F",
        "building": "A",
        "level": 6,
        "floorType": "FLOOR",
        "name": "A 楼 6 层"
      }
    }
  ]
}
```

---


## 2. node.extras (每个 mesh 节点)

存放在 `nodes[i].extras`, **i 是 mesh 节点在 GLB JSON `nodes` 数组中的索引**。

只有 `node.mesh !== undefined` 的节点需要填 (空 group 节点不用填)。

| 字段 | 类型 | 必填 | 说明 | 例子 |
|---|---|---|---|---|
| `name` | string | 推荐 | GLB 节点名, 中文人类可读 | `"A 楼 6 层 主入口门"` |
| `sid` | string | ✅ | **业务唯一短 ID** (前端 API 查找用) | `"DOOR_A_6F_1"` |
| `findId` | string | ✅ 自动 | **GLB 内唯一 ID** (脚本自动派生) | `"A_6F_mesh_42"` |
| `floorName` | string | 推荐 | 冗余, 方便过滤 | `"A_6F"` |
| `building` | string | 推荐 | 冗余, 方便过滤 | `"A"` |
| `level` | number | 推荐 | 冗余, 方便过滤 | `6` |
| `renderType` | enum | ✅ | **构件种类** (不是渲染模式, 见下表) | `"WINDOW"` |
| `renderTypeConfidence` | string | 推荐 | 标注可信度, 让人工 review 优先级 | `"high"` / `"low"` |
| `spaceType` | enum | renderType=SPACE 时必填 | 空间分类 (13 种) | `"TOILET"` |
| `fireType` | enum | renderType=FACILITY 时必填 | 消防/安防器材分类 (11 种, v3.1) | `"SMOKE_DETECTOR"` |

### 2.1 renderType 枚举 (8 种,v3.1 起)

| 值 | 含义 | 例子 |
|---|---|---|
| `WINDOW` | 窗户 | `WINDOW_3_472431094_0` |
| `DOOR` | 门 | `DOOR_1_2035616329_0` |
| `ELEVATOR` | 电梯 | `ELEVATOR_2_...` |
| `STAIR` | 楼梯 | `STAIR_1_...` |
| `CEILING` | **任何水平的板**(楼板 / 屋顶板 / 装饰) | v3 起覆盖原 CEILING + ROOF |
| `WALL` | **结构**(墙 / 柱 / 梁) | v3 新增 |
| `SPACE` | 空间区域 (男厕 / 会议室 / 走廊,占位 mesh) | `TOILET_01` |
| `FACILITY` | **消防 / 安防器材**(必须配 fireType) | v3.1 新增,`FACILITY_A_6F_HYDRANT_01` |

> **注意**: renderType 表示"是什么", 不是"怎么渲染" (那是 material 的事)。
> 比如 `WINDOW` 标注的是"这是窗户", 透明与否由 material 决定。
>
> **v3.1 重要变化**:
> - `FACILITY` 新增 → 消防 / 安防器材(消火栓、烟感、喷淋等),必须配 `fireType` 子分类(11 种)
>
> **v3 重要变化**:
> - `ROOF` 删除 → 屋顶 mesh 一律 `CEILING`(避免 `floorType.ROOF` 跟 `renderType.ROOF` 跨界)
> - `WALL` 新增 → 覆盖墙/柱/梁等结构(之前只能归 CEILING / ROOF,语义不准)

### 2.2 spaceType 枚举 (13 种, 仅 SPACE 用)

| 值 | 中文 | 例子 |
|---|---|---|
| `TOILET` | 厕所 | 男厕 / 女厕 / 无障碍厕所 |
| `LAUNDRY` | 洗衣房 | |
| `KITCHEN` | 厨房 | |
| `OFFICE` | 办公室 | 单人 / 多人 |
| `MEETING_ROOM` | 会议室 | |
| `BEDROOM` | 卧室 | |
| `CORRIDOR` | 走廊 | |
| `STAIRWELL` | 楼梯间 (注意区分 STAIR 构件, 这里是空间) | |
| `ELEVATOR_HALL` | 电梯厅 | |
| `MECHANICAL_ROOM` | 机房 | 强电 / 弱电 / 空调 |
| `STORAGE` | 储藏室 | |
| `LOBBY` | 大堂 | |
| `BALCONY` | 阳台 | |

> **新增枚举**: 业务发展过程可能需要, 直接在 `scripts/validate-metadata.mjs` 里加进 `VALID_SPACE_TYPES` 集合即可。

### 2.3 完整例子 (mesh 节点)

```json
{
  "nodes": [
    {
      "name": "A 楼 6 层 主入口门",
      "mesh": 0,
      "extras": {
        "sid": "DOOR_A_6F_1",
        "findId": "A_6F_mesh_0",
        "floorName": "A_6F",
        "building": "A",
        "level": 6,
        "renderType": "DOOR",
        "renderTypeConfidence": "high"
      }
    },
    {
      "name": "A 楼 6 层 西北角窗户",
      "mesh": 1,
      "extras": {
        "sid": "WINDOW_A_6F_1",
        "findId": "A_6F_mesh_1",
        "floorName": "A_6F",
        "building": "A",
        "level": 6,
        "renderType": "WINDOW",
        "renderTypeConfidence": "high"
      }
    },
    {
      "name": "A 楼 6 层 男厕",
      "mesh": 2,
      "extras": {
        "sid": "SPACE_A_6F_MR_TOILET_01",
        "findId": "A_6F_mesh_2",
        "floorName": "A_6F",
        "building": "A",
        "level": 6,
        "renderType": "SPACE",
        "spaceType": "TOILET",
        "renderTypeConfidence": "high"
      }
    }
  ]
}
```

---

## 3. 命名规范

### 3.1 sid 格式

```
<RENDERTYPE>_<FLOORNAME>_<SEQ>
```

- `RENDERTYPE`: renderType 大写
- `FLOORNAME`: scene.extras.floorName 一致
- `SEQ`: 同 floorName + renderType 内的整数序号, 从 1 开始

**例子**:
```
WINDOW_A_6F_1       # A 楼 6 层 第 1 个窗户
WINDOW_A_6F_2       # A 楼 6 层 第 2 个窗户
DOOR_A_6F_1         # A 楼 6 层 第 1 个门
DOOR_B_24F_3        # B 楼 24 层 第 3 个门
ELEVATOR_B_24F_1    # B 楼 24 层 第 1 个电梯
SPACE_A_6F_MR_TOILET_01  # A 楼 6 层 男厕 #1 (SPACE 可加描述)
```

> **SEQ 编号规则**: 同一层同类构件按 z 序或空间顺序递增, 不强制, 保证唯一即可。

### 3.2 findId 格式 (自动派生)

```
<FLOORNAME>_mesh_<NODE_INDEX>
```

- `FLOORNAME`: scene.extras.floorName
- `NODE_INDEX`: mesh 节点在 `nodes` 数组中的索引 (从 0 开始)

**例子**: `A_6F_mesh_42` (A 楼 6 层, nodes 数组第 42 个 mesh)

> **findId 永远自动化生成**, 工具脚本负责填, **人手不要填**。

### 3.3 name 字段 (人类可读, 给人/大模型看)

- 简体中文
- 建议格式: `<楼栋> <位置> <种类>`, 例:
  - `"A 楼 6 层 主入口门"`
  - `"A 楼 6 层 西北角窗户"`
  - `"B 楼 24 层 男厕"`
- 没有强制, 但**建议加**, LLM 读着会方便很多

---

### 3.4 方位 + 顺时针编号规则

**目标**: 让 mesh 命名 / sid SEQ 在一层楼内**唯一 + 可预测**,避免 LLM/前端模糊查找。

#### 3.4.1 方位定义 (8 分组, 俯视)

```
        N (-Y, 0°)
        ↑
        │
NW ───── O ───── NE
(-X)    │      (+X)
        │
        ↓
        S (+Y, ±180°)

8 方位 (推荐)         4 方位 (简化版, 可选)
  N / NE / E / SE        N / E / S / W
  S / SW / W / NW
```

**判断依据**:从**楼层中心**看,mesh 在哪个方向。

- **俯视**:从上往下看平面图
- **北向上**:Blender 默认 +Y 是南,**-Y 是北**(屏幕向上是北)
- **角度→方位**:用 `atan2(dx, -dy)` 算 0°~360°,归到 8/4 分组

#### 3.4.2 顺时针 SEQ 规则

**核心**:每组构件**从西北端(NW 方向)开始,沿该方向墙顺时针编号**。

```
N 组示例 (整层北面 8 个窗户):

  NW ●─1─●─2─●─3─●─4─●─5─●─6─●─7─●─8─● NE
     起点                                 终点
     (整层 NW 角)                       (沿北墙顺时针走到 NE 角)

E 组示例 (整层东面 6 个窗户):

  NE ●
     │
     1●
     │
     2●
     │
     3●
     │
     4●
     │
     5●
     │
     6●
     ↓
  SE ●
     起点 NE 角 (顺时针往下走到 SE)
```

**起点约定**(每组都从该方向的"最北/最西北"那端起):

| 分组 | 起点位置 |
|---|---|
| N | 整层 NW 角 |
| NE | NE 角 |
| E | NE 角 |
| SE | SE 角 |
| S | SE 角 |
| SW | SW 角 |
| W | SW 角 |
| NW | NW 角 |

#### 3.4.3 编号实现(人工或自动)

**人工法**(Blender 里手动数):

1. Blender 大纲展开同组构件
2. 从该组起点(NW 端)开始,**沿该方向墙顺时针**数 1, 2, 3, ...
3. 把数字写进 sid

**自动法**(代码辅助):

```python
def get_direction(mesh_pos, floor_center):
    """mesh 在哪组 (8 方位)"""
    dx = mesh_pos.x - floor_center.x
    dy = mesh_pos.y - floor_center.y  # Blender: +Y 是南
    angle = math.degrees(math.atan2(dx, -dy)) % 360  # 0° = N
    # 8 分组 (每 45°)
    idx = int((angle + 22.5) / 45) % 8
    return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][idx]

def get_seq(mesh_pos, direction, floor_corners):
    """该方向上,mesh 离起点多远 → SEQ"""
    # 把 mesh 投影到该方向墙,投影点距起点的距离 → SEQ
    ...
```

#### 3.4.4 在 mesh 名字里体现方位

**mesh.name** 应该带方位(LLM 用得着):

```
推荐命名:
  Window_NW_01     ← 西北组,第 1 个
  Window_N_05      ← 北组,第 5 个
  Window_NE_03
  Door_E_02        ← 东组,第 2 个门
  Staircase_S      ← 南侧楼梯
```

#### 3.4.5 v3.1 状态:sid **不带**方位

> ⚠️ **v3.1 sid 格式仍为 `<RT>_<FN>_<SEQ>`**(不带方位)。
>
> 方位信息放在 **mesh.name** 里,不污染 sid(避免破坏现有数据)。
>
> 未来 v3.2 如果需要 sid 带方位,再做数据迁移。

#### 3.4.6 实际工作流

```
Blender 打开 A_6F.glb
  ↓
1. 在 Blender 大纲里,从 NW 角开始顺时针扫一圈北墙
   - 第 1 扇窗 → mesh 改名 Window_NW_01, 加 sid = WINDOW_A_6F_1, renderType = WINDOW
   - 第 2 扇窗 → mesh 改名 Window_NW_02, sid = WINDOW_A_6F_2
   - ...
   - 走到 NE 角后,改方向到 NE 组(沿 NE 边顺时针)
2. 同理处理 E / SE / S / SW / W / N 组
3. 验证:Blender 大纲里按名字排序,应该看到:
   Window_E_01 ... Window_E_06
   Window_N_01 ... Window_N_08
   Window_NE_01 ... Window_NE_03
   Window_NW_01 ... Window_NW_05
   Window_S_01 ... Window_S_07
   Window_SE_01 ... Window_SE_04
   Window_SW_01 ... Window_SW_06
   Window_W_01 ... Window_W_05
```

---

### 3.5 mesh 合并 vs Collection 分组(关键)

**问题**:一扇窗户 / 一扇门在 BIM 模型里可能是多块 mesh(玻璃 + 窗框 + 把手)。GLB 导出前怎么处理?

#### 3.5.1 决策表

| 场景 | 操作 | 理由 |
|---|---|---|
| **同一种构件的几块**(一扇窗 = 玻璃 + 窗框 + 把手)| **Ctrl+J 合并** | 一物 = 1 mesh,跟 spec sid 1:1 对齐 |
| **同区域同类**(北侧 20 扇窗) | **Ctrl+G Collection**(可选) | 建模期批量操作(批量改材质),GLB 导出后无影响 |
| **不同种构件聚一组**(门 + 门框 + 锁 + 门牌号) | **不建议合并**,各为独立 mesh + 同 collection | 各自 sid 不同(门是 DOOR,牌号是 OTHER) |

#### 3.5.2 推荐:每扇窗 Ctrl+J 合并

```
合并前 (3 mesh):           合并后 (1 mesh):
  玻璃 (mesh)               ┌──────────┐
  窗框 (mesh)               │          │
  把手 (mesh)               │  Window   │ ← 1 个 mesh
                            │  _NW_01  │
                            └──────────┘
                            sid = WINDOW_A_6F_<SEQ>
```

**好处**:
- ✅ 一个 sid 对应 1 个 mesh,跟前 6 种 renderType 一致
- ✅ draw call 减少(每扇窗 3 → 1),性能好
- ✅ 点击/高亮/飞行**直接命中窗户整体**
- ✅ Blender 文件更简洁

**代价**:
- ❌ 不能再单独编辑玻璃/窗框(要先解开)
- ❌ 多材质变单材质混合(运行时不再区分)

#### 3.5.3 Collection 在 GLB 导出后**不保留**

**关键事实**:Blender 的 Collection 是**建模期概念**。导出 GLTF 后,GLB JSON 里**只有节点父子关系**,Collection 信息丢失。

| 阶段 | Collection 信息 |
|---|---|
| Blender 编辑 | ✅ 完整 |
| GLB 导出 | ❌ 丢失(只在父节点结构体现) |
| 运行时加载 | ❌ 不知道 mesh 原属哪个 Collection |

→ **Ctrl-G 的好处在 GLB 导出后基本没了**,所以**不要依赖 Collection 来存业务信息**(方位 / 区域分类)。业务信息存 mesh.name / mesh.userData.sid。

#### 3.5.4 实际工作流(完整)

```
Blender 打开 GLB:
1. 一扇窗户的 3 块 mesh(玻璃 + 窗框 + 把手)→ Ctrl+J 合并 → 1 个 mesh
2. 改名:Window_NW_01 (按方位 + 顺时针 SEQ)
3. 加 Custom Properties:
   - sid = WINDOW_A_6F_<SEQ>  (或 WINDOW_A_6F_NW_<SEQ>, 看你怎么编号)
   - renderType = WINDOW
   - renderTypeConfidence = high
   - floorName / building / level (冗余)
4. 同区域多扇窗可选放进 Collection "Windows_North_Wing"(仅建模期方便)
5. 处理完所有窗 / 门 / 楼梯 / 电梯 → 导出 GLB(勾 Custom Properties)
```

---

## 4. 冗余字段一致性

`node.extras.floorName / building / level` 应该跟 `scene.extras` 一致:

```json
// scene
{ "floorName": "A_6F", "building": "A", "level": 6 }

// 每个 mesh
{ "extras": { "floorName": "A_6F", "building": "A", "level": 6 } }
```

**好处**:
- 不用 traverse 找 parent root, 直接从 userData 过滤
- 校验脚本能检查一致性

---

## 5. LANDSCAPE 特殊规则

`LANDSCAPE_TERRAIN.glb` 和 `LANDSCAPE_FACADE.glb` 是**地形和外立面**, 不属于任何楼:

```json
{
  "scenes": [{
    "extras": {
      "floorName": "LANDSCAPE_TERRAIN",
      "building": null,
      "level": null,
      "floorType": "LANDSCAPE_TERRAIN",
      "name": "地形 (基础场景)"
    }
  }]
}
```

里面的 mesh 节点 (`node.extras`):
- `building` 填 `null`
- `level` 填 `null`
- `renderType` 填 `TERRAIN` ❌ **不允许** (不在 8 种里)
- 建议填 `CEILING` 或 `ROOF` (不严格), 或在脚本里扩展枚举

**`node.extras.sid` 仍然必填**, 格式:
```
CEILING_LANDSCAPE_TERRAIN_1
CEILING_LANDSCAPE_TERRAIN_2
```

---

## 6. 通用例外 (warn 不算 error)

| 情况 | 规则 |
|---|---|
| mesh 节点 `name` 为空 (匿名 mesh) | warning, 仍可注入 sid (脚本自动生成 name) |
| `renderType` 缺失 | warning, 仍可注入 sid (仅 sid 查找可用, renderType 过滤不可用) |
| `spaceType` 缺失但 `renderType` 不是 SPACE | OK, 正常 |
| `spaceType` 缺失且 `renderType` 是 SPACE | **error** (必须填) |
| 匿名 mesh 的 sid | 仍必填, 格式 `<RENDERTYPE>_<FLOORNAME>_<SEQ>` (无 NAME 部分) |

---

## 7. Blender 操作流程 (推荐)

1. **装 GLB Extras 插件** (或用 Blender 自带 + script)
2. **导入 GLB** → File → Import → glTF 2.0 (.glb/.gltf)
3. **左侧大纲** 选中 Scene 根 → N 面板 → Custom Properties → 添 `floorName / building / level / floorType / name`
4. **选中每个 mesh** → 同样添 `sid / findId / renderType / spaceType`
5. **导出 GLB** → File → Export → glTF 2.0 → 勾选 **Custom Properties** ✅
6. **GLTF Extras** 自动写入 JSON chunk

> 关键: **导出时勾选 Custom Properties**, 不然 extras 全丢。

---

## 8. 验证

```bash
# 全部
node scripts/validate-metadata.mjs

# 单个 subcategory
node scripts/validate-metadata.mjs hospital

# 单个文件
node scripts/validate-metadata.mjs hospital --file A_6F

# 警告也算错
node scripts/validate-metadata.mjs hospital --strict

# 输出 JSON
node scripts/validate-metadata.mjs hospital --json > report.json
```

**退出码**:
- `0` 通过 (可能有 warning)
- `1` 有 error (或 `--strict` 下有 warning)
- `2` 脚本自身错误

**报告字段**:
- `totalFiles` / `totalMeshNodes`
- `passRate.sid` / `passRate.renderType` / `passRate.spaceType`
- `sidDuplicates` (全局 sid 唯一性)
- per-file: 错误 / 警告详情

---

## 9. 前端 API 用法 (跟 spec 对应)

**`ssp.objectsTool`** 一旦 spec v2 落地, 前端 API:

```js
// 1. 按 sid 查 (最常用)
const door = ssp.objectsTool.getById('DOOR_A_6F_1')

// 2. 按 userData 字段查
const windows = ssp.objectsTool.getByUserDataProperty('renderType', 'WINDOW')
const toilets = ssp.objectsTool.getByUserDataProperty('spaceType', 'TOILET')

// 3. 限定楼层/楼栋
const a6windows = ssp.objectsTool.getByUserDataProperty('renderType', 'WINDOW', {
  scope: 'A_6F',
})

// 4. 高亮 / 可见性
ssp.objectsTool.setHighlight(toilets[0], '#ff0000')
ssp.objectsTool.setVisible(door, false)

// 5. flyToObject
await ssp.cameraController.flyToObject(door)
```

**LLM 友好模板** (soonspace 风格):
```js
// 找所有厕所
const toilets = ssp.objectsTool.getByUserDataProperty('spaceType', 'TOILET')
console.log(`找到 ${toilets.length} 个厕所`)

// 高亮男厕
const mr = ssp.objectsTool.getByUserDataProperty('spaceType', 'TOILET', { scope: 'A_6F' })
ssp.objectsTool.setHighlight(mr[0], '#29ccff')
```

---

## 10. 数据规范扩展 (后续)

如果需要新枚举 (比如 `spaceType` 加新种类), 改 `scripts/validate-metadata.mjs` 顶部的 `VALID_*` Set 即可, **不破坏现有数据**。

如果需要新字段 (比如 `material` 渲染方式):
- 先在 spec 里定义
- 改 validate-metadata.mjs
- 现有数据不影响 (缺字段只 warn)
- 逐步回填新字段

---

## 11. 工作量估算 (以 hospital 55 层为基准)

| 指标 | 数量 |
|---|---|
| GLB 总数 | 55 |
| Mesh 节点总数 | 7,942 |
| 当前带 sid | 0 (0.0%) |
| 当前带 renderType | 189 (2.4%) |
| 当前带 spaceType | 0 (0.0%) |
| **完全覆盖后预估** | 7,942 个 mesh 全部 sid+renderType, ~1,500 个 SPACE mesh 加 spaceType |

**自动化建议**:
- findId: 脚本自动派生 (0 工作量)
- 冗余字段 (floorName/building/level): 脚本自动从 scene.extras 复制 (0 工作量)
- sid: 脚本基于 (renderType + 楼层内 sequence) 自动生成 (0 工作量, 但 sequence 规则需约定)
- renderType: **人工判断** (每层 50-500 mesh, v3.1 共 8 种枚举)
- name: **人工** (可选但推荐)
- spaceType: **人工** (仅 SPACE mesh 必填, ~1500 个)
- material / 其他可选字段: **不强制**

**真实工作量**: 取决于每层 mesh 数量, 大约每层 1-3 小时 (人工看 + 填)。55 层 ≈ 80-160 小时。

---

## 12. 扩展字段 (可选, 工具方可加)

工具方在 55 个 GLB 实际加的额外字段, 不在 v2 规范核心, 但已用上:

### `scene.extras.semantic` (中文语义描述, 整层)

```json
{
  "scenes": [{
    "extras": {
      "floorName": "A_6F",
      "building": "A",
      "level": 6,
      "floorType": "FLOOR",
      "name": "A_6F",
      "semantic": {
        "category": "楼层",                          // 中文类型
        "subcategory": "标准层",                    // 中文子类型
        "displayName": "A 楼 第 6 层 (标准层)",    // 完整中文名
        "description": "A 楼 的 第 6 层 楼层,类型: 标准层",  // 完整描述
        "buildingCN": "A 楼",                       // 楼栋中文
        "levelDesc": "第 6 层",                    // 层级描述
        "typeCN": "标准层"                         // 类型中文
      }
    }
  }]
}
```

### `node.extras.semantic` (中文语义描述, 每个 mesh)

```json
{
  "nodes": [{
    "extras": {
      "sid": "CEILING_A_6F_1",
      "findId": "A_6F_mesh_0",
      "floorName": "A_6F",
      "renderType": "CEILING",
      "semantic": {
        "category": "天花板",
        "subcategory": null,
        "displayName": "A 楼 第 6 层 2 号 天花板",
        "description": "A 楼 第 6 层 的一个天花板",
        "buildingCN": "A 楼",
        "levelDesc": "第 6 层",
        "typeCN": "CEILING"
      }
    }
  }]
}
```

**用途**:
- LLM 友好(中文, 一眼懂)
- UI 可以直接显示 `obj.userData.semantic.displayName`
- 跨语言 (CN / EN 都能 show)

**不影响 v2 核心**(validate-metadata.mjs 不校验 semantic, 工具方自由发挥)。

---

## 13. 工具脚本清单

| 脚本 | 用途 |
|---|---|
| `scripts/validate-metadata.mjs` | 验证 GLB metadata 符合规范 |
| `scripts/list-models.mjs` | 扫描 public/models/ 生成 manifest (已有) |
| `scripts/inject-csv.mjs` | (待写) 读 CSV 注入 metadata 到 GLB |
| `scripts/auto-fill.mjs` | (待写) 自动派生 findId / 冗余字段 / 基础 sid |

---

## 13. 一份完整 JSON 例子 (A_6F 第一层)

```json
{
  "asset": { "version": "2.0" },
  "scenes": [
    {
      "name": "A_6F",
      "extras": {
        "floorName": "A_6F",
        "building": "A",
        "level": 6,
        "floorType": "FLOOR",
        "name": "A 楼 6 层"
      },
      "nodes": [/* node index list */]
    }
  ],
  "nodes": [
    {
      "name": "A 楼 6 层 主入口门",
      "mesh": 0,
      "extras": {
        "sid": "DOOR_A_6F_1",
        "findId": "A_6F_mesh_0",
        "floorName": "A_6F",
        "building": "A",
        "level": 6,
        "renderType": "DOOR",
        "renderTypeConfidence": "high"
      }
    }
  ]
}
```


---

## 14. 注入规则 checklist (给注入工具方)

**A_1F 的实际注入规则**,根据 mesh.name 命名格式推导(2026-07 测试)。

### 14.1 scene.extras 注入 (每个 GLB 必须)

```json
{
  "floorName": "<从 GLB 文件名推导>",   // A_1F.glb → "A_1F"
  "building":  "<从 floorName 推导>",     // "A_1F" → "A"
  "level":     <number>,                  // "A_1F" → 1, "B_24F" → 24
  "floorType": "<合法 floorType>",        // FLOOR / ROOF / BASEMENT 等
  "name":      "<中文名>",                 // "A栋1层"
}
```

**推导规则**(见 `scripts/inject-scene-name.mjs` 已实现):

| 文件名 | building | level | floorType | name |
|---|---|---|---|---|
| `A_1F.glb` | A | 1 | FLOOR | A栋1层 |
| `B_24F.glb` | B | 24 | FLOOR | B栋24层 |
| `A_T.glb` | A | 25 | TOWER | A栋塔楼 |
| `A_DING.glb` | A | max+1 | ROOF | A栋屋顶 |
| `BASEMENT_B1.glb` | - | -1 | BASEMENT | 地下室B1层 |
| `LANDSCAPE_TERRAIN.glb` | - | null | LANDSCAPE_TERRAIN | 地形 |
| `LANDSCAPE_FACADE.glb` | - | null | LANDSCAPE_FACADE | 外立面 |

### 14.2 node.extras 注入 (每个 mesh 必须)

**字段** (按 mesh.name 解析):

```json
{
  "sid":               "<推导>",
  "renderType":        "<从 mesh.name 前缀>",
  "renderTypeConfidence": "high",
  "fireType":          "<仅 FACILITY>",
  "floorName":         "<同 scene.extras>",
  "building":          "<同 scene.extras>",
  "level":             "<同 scene.extras>",
  "name":              "<= mesh.name>"
}
```

### 14.3 mesh.name → renderType / sid 推导 (v3.1 实战规则)

| mesh.name 格式 | renderType | sid 模板 |
|---|---|---|
| `WINDOW_<DIR>_<SEQ>` | WINDOW | `WINDOW_<FN>_<DIR>_<SEQ>` |
| `DOOR_<DIR>_<SEQ>` | DOOR | `DOOR_<FN>_<DIR>_<SEQ>` |
| `ELEVATOR_<DIR>_<SEQ>` | ELEVATOR | `ELEVATOR_<FN>_<DIR>_<SEQ>` |
| `STAIR_<DIR>_<SEQ>` | STAIR | `STAIR_<FN>_<DIR>_<SEQ>` |
| `CEILING_<SUB>` | CEILING | `CEILING_<FN>_<SUB>` |
| `WALL_<SUB>` | WALL | `WALL_<FN>_<SUB>` |
| `FACILITY_<FIRE_TYPE>_<SEQ>` | FACILITY | `FACILITY_<FN>_<FIRE_TYPE>_<SEQ>` |

**`<DIR>`** ∈ { N, NE, E, SE, S, SW, W, NW }(8 方位,**严格大写**)
**`<FN>`** = scene.extras.floorName (如 `A_1F`)
**`<SUB>`** = 自定义后缀(如 `LOWER` / `UPPER` / `PARTITION`)
**`<FIRE_TYPE>`** ∈ { HYDRANT, SMOKE_DETECTOR, SPRINKLER, EXTINGUISHER, EMERGENCY_LIGHT, EXIT_SIGN, BREAK_GLASS, ALARM_BELL, FIRE_HOSE, FIRE_DOOR, OTHER }
**`<SEQ>`** = 2 位零填充数字 (01, 02, ..., 99)

### 14.4 解析伪代码

```js
function parseMeshName(name) {
  if (!name) return null
  const parts = name.split('_')
  const type = parts[0].toUpperCase()

  // FACILITY 特殊: <TYPE>_<FIRE_TYPE>_<SEQ>
  if (type === 'FACILITY' && parts.length >= 3) {
    const fireType = parts[1].toUpperCase()
    return { type, fireType, seq: parts.slice(2).join('_') }
  }

  // CEILING / WALL: <TYPE>_<SUB>
  if (type === 'CEILING' || type === 'WALL') {
    return { type, sub: parts.slice(1).join('_') }
  }

  // DOOR/WINDOW/ELEVATOR/STAIR: <TYPE>_<DIR>_<SEQ>
  if (parts.length >= 3) {
    return { type, direction: parts[1].toUpperCase(), seq: parts[2] }
  }

  return null
}

function deriveSid(type, floorName, parsed) {
  let seq
  if (type === 'FACILITY') seq = `${parsed.fireType}_${parsed.seq}`
  else if (type === 'CEILING' || type === 'WALL') seq = parsed.sub
  else seq = `${parsed.direction}_${parsed.seq}`
  return `${type}_${floorName}_${seq}`
}
```

### 14.5 A_1F 实际推导示例 (139 个 mesh)

```
CEILING_LOWER              → renderType=CEILING,  sid=CEILING_A_1F_LOWER
CEILING_UPPER              → renderType=CEILING,  sid=CEILING_A_1F_UPPER
DOOR_E_01                  → renderType=DOOR,     sid=DOOR_A_1F_E_01
DOOR_W_15                  → renderType=DOOR,     sid=DOOR_A_1F_W_15
ELEVATOR_E_01              → renderType=ELEVATOR, sid=ELEVATOR_A_1F_E_01
STAIR_N_01                 → renderType=STAIR,    sid=STAIR_A_1F_N_01
WALL_PARTITION             → renderType=WALL,     sid=WALL_A_1F_PARTITION
WINDOW_N_03                → renderType=WINDOW,   sid=WINDOW_A_1F_N_03
WINDOW_SE_02               → renderType=WINDOW,   sid=WINDOW_A_1F_SE_02
FACILITY_HYDRANT_01        → renderType=FACILITY, fireType=HYDRANT, sid=FACILITY_A_1F_HYDRANT_01
FACILITY_HYDRANT_07        → renderType=FACILITY, fireType=HYDRANT, sid=FACILITY_A_1F_HYDRANT_07
```

### 14.6 fireType 11 种 (注入时严格大写)

```
HYDRANT, SMOKE_DETECTOR, SPRINKLER, EXTINGUISHER,
EMERGENCY_LIGHT, EXIT_SIGN, BREAK_GLASS, ALARM_BELL,
FIRE_HOSE, FIRE_DOOR, OTHER
```

**强制规则**:
- `renderType === 'FACILITY'` → **必须**有 `fireType`
- `fireType` 不在这 11 种内 → **error**(validate-metadata.mjs 会拒)
- `renderType !== 'FACILITY'` 但有 `fireType` → **warning**(允许但不规范)

### 14.7 ⚠️ 注入时容易出错的地方

1. **不要改顶层 gltf 字段**(asset, scenes, nodes, meshes, buffers, bufferViews, accessors, images, textures) — 这些是几何数据,**会破坏 GLB**
2. **必须保留 BIN chunk**(几何 / 纹理数据) — 写到 GLB 时**不能**只写 JSON chunk
3. **GLB 字节对齐** — JSON chunk data 用 0x20 padding 到 4 字节对齐,BIN chunk 同理
4. **scene.extras 不能修改 schema** — 字段名严格按本规范 (floorName / building / level / floorType / name)
5. **冗余字段** (floorName / building / level) **必须从 scene.extras 复制到每个 node.extras** — 不是手动填

### 14.8 注入验证 (工具方必跑)

注入完成后跑:
```bash
node scripts/validate-metadata.mjs
```

期望: **PASS — all files conform to v3.1 spec**

如果 FAIL, 看 errors / warnings 列表,定位问题。

### 14.9 注入流程 (推荐)

```
1. 读 GLB 文件 (含 JSON + BIN chunks)
2. 解析 JSON chunk (注意 c0Len 含 padding, 解析时跳过尾部 0x20)
3. 注入 scene.extras (按 §14.1)
4. 逐个 mesh 注入 node.extras (按 mesh.name 解析, §14.3-14.4)
5. 重新写 GLB:
   - GLB header (20 bytes) = magic + version + totalLength + jsonChunkLength + 'JSON\0'
   - JSON chunk data (含 padding)
   - BIN chunk header (8 bytes) = binChunkLength + 'BIN\0'
   - BIN chunk data (原始二进制, 不动)
6. 写文件, 跑 validate-metadata.mjs 验收
```

**绝对不能**:
- ❌ 只重写 JSON chunk, 丢掉 BIN chunk (Blender 会 import 失败)
- ❌ 用 `JSON.stringify` 后不重算 c0Len (会让 Blender 找错 JSON 边界)
- ❌ 在 `bufferView.byte_offset` 累加 JSON chunk 的偏移 (BIN 数据是从 BIN chunk 起始算偏移, 不是从 JSON chunk)

---