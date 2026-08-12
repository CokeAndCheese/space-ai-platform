# GLB Metadata 填写规范 — Blender 版

> **面向 Blender 操作员**: 怎么在 Blender 里给 GLB 加 Custom Properties,导出后被前端模板正确识别。
>
> **完整字段定义 / 命名规范 / 校验逻辑**: [GLB_METADATA_SPEC.md](./GLB_METADATA_SPEC.md)
>
> **验收脚本**: `node scripts/validate-metadata.mjs`

---

## 1. 整体流程

```
Blender 导入 GLB
  → 选中根节点 → N 面板 → Custom Properties → 加 5 个场景级字段
  → 选中每个 mesh → 同样位置 → 加 9 个节点级字段
  → File → Export → glTF 2.0
  → ✅ 勾选  "Custom Properties"     ← 不勾会全丢
  → ✅ 勾选  "GLTF Extras"            ← 默认勾
  → 导出
```

> ⚠️ **关键警告**: 导出时**不勾 Custom Properties = 全白填**。

---

## 2. 两类构件要填

| 构件 | 位置 | 填几份 | 用的字段 |
|---|---|---|---|
| **场景(Scene)根** | 选中 `Scene Collection` 或根节点 → N 面板 → Custom Properties | **1 份** / GLB | floorName / building / level / floorType / name |
| **每个 mesh 节点** | 选中 mesh → N 面板 → Custom Properties | **n 份** / GLB(每个 mesh 一份) | sid / findId* / renderType / spaceType / name + 冗余 3 个 |

> `findId` 带 * = **不需要手填**,工具脚本会自动校验一致性。

---

## 3. 场景级字段(Scene 根)

Blender 操作: 选中根 → **N 面板**(右边的 N 图标)→ Custom Properties(下方列表)→ 点 **➕** 新建 → 输入名字 + 值。

| Blender 属性名 | 类型 | 必填 | 值例子 | 命名规则 |
|---|---|---|---|---|
| `floorName` | String | ✅ | `A_6F` | **必须跟文件名一致**(`A_6F.glb` → `A_6F`) |
| `building` | String | ⚠️ | `A` / `B` / `C` / `COMMON` | 大写字母;**地形/外立面填 `"null"`**(Blender 里直接写字符串 `null`) |
| `level` | Integer | ⚠️ | `1` ~ `24` / `-1` ~ `-4` / `99` | 楼层号;**地形/外立面填 `0`** |
| `floorType` | String(枚举) | ✅ | 见下表 | 必须从下表里选,严格大小写 |
| `name` | String | 推荐 | `A 楼 6 层` | 中文,人类可读 |

### floorType 枚举(7 种,v3 起,严格匹配)

| 值 | 用于 |
|---|---|
| `FLOOR` | 标准楼层(A_1F ~ B_24F 等) |
| `TOWER` | 塔楼顶层 |
| `ROOF` | 屋顶(**含**装饰/天线,v3 起) |
| `BASEMENT` | 地下室 |
| `LANDSCAPE_TERRAIN` | `LANDSCAPE_TERRAIN.glb`(地形) |
| `LANDSCAPE_FACADE` | `LANDSCAPE_FACADE.glb`(外立面) |
| `FACILITY` | 共享设施(机房 / 整层电梯) |

### 场景级 Blender 实操示例(A_6F)

```
属性名              类型      值
─────────────────────────────────
floorName          String    A_6F
building           String    A
level              Integer   6
floorType          String    FLOOR
name               String    A 楼 6 层
```

地形 GLB:

```
floorName          String    LANDSCAPE_TERRAIN
building           String    null
level              Integer   0
floorType          String    LANDSCAPE_TERRAIN
name               String    地形 (基础场景)
```

---

## 4. 节点级字段(每个 mesh)

Blender 操作: **选中 mesh**(左边大纲 / 右键 Select)→ N 面板 → Custom Properties → ➕ 新建。

| Blender 属性名 | 类型 | 必填 | 值例子 | 命名规则 |
|---|---|---|---|---|
| `sid` | String | ✅ | `DOOR_A_6F_1` | **业务唯一 ID**,前端用它查物体,见 §6 命名规范 |
| `findId` | String | 自动 | `A_6F_mesh_42` | **通常不手填**,工具自动生成;但 Blender 里能看到工具写的值 |
| `name` | String | 推荐 | `A 楼 6 层 主入口门` | 节点中文名(可覆盖 Blender 默认名) |
| `floorName` | String | 推荐 | `A_6F` | 跟场景级一致(冗余) |
| `building` | String | 推荐 | `A` | 跟场景级一致(冗余) |
| `level` | Integer | 推荐 | `6` | 跟场景级一致(冗余) |
| `renderType` | String(枚举) | ✅ | `WINDOW` / `DOOR` / `ELEVATOR` / `STAIR` / `CEILING` / `WALL` / `SPACE` / `FACILITY` | 见 §5,8 种选 1,严格大写 |
| `renderTypeConfidence` | String | 推荐 | `high` / `medium` / `low` | 标注可信度,辅助人工 review 优先级 |
| `spaceType` | String | renderType=SPACE 时必填 | `TOILET` / `MEETING_ROOM` 等 | 见 §5.2,13 种选 1 |
| `fireType` | String | renderType=FACILITY 时必填 | `SMOKE_DETECTOR` / `HYDRANT` 等 | 见 §5.3,11 种选 1(v3.1 新增) |

### 节点级 Blender 实操示例(主入口门)

```
属性名                类型      值
───────────────────────────────────
sid                   String    DOOR_A_6F_1
name                  String    A 楼 6 层 主入口门
floorName             String    A_6F
building              String    A
level                 Integer   6
renderType            String    DOOR
renderTypeConfidence  String    high
```

### 节点级示例(男厕 SPACE)

```
属性名                类型      值
───────────────────────────────────
sid                   String    SPACE_A_6F_MR_TOILET_01
name                  String    A 楼 6 层 男厕
floorName             String    A_6F
building              String    A
level                 Integer   6
renderType            String    SPACE
renderTypeConfidence  String    high
spaceType             String    TOILET
```

---

## 5. renderType / spaceType 枚举表

### 5.1 renderType(8 种,**严格大写**,v3.1 起)

| 值 | 含义 | 怎么判断 |
|---|---|---|
| `WINDOW` | 窗户 | 玻璃 + 窗框,有 view 边界 |
| `DOOR` | 门 | 单扇 / 双扇门,有门框 |
| `ELEVATOR` | 电梯 | 电梯井 / 电梯门 |
| `STAIR` | 楼梯 | 踏步 + 栏杆(构件级,不是空间) |
| `CEILING` | **任何水平的板**(楼板 / 屋顶板 / 装饰) | v3 起覆盖原 CEILING + ROOF |
| `WALL` | **结构**(墙 / 柱 / 梁) | v3 新增 |
| `SPACE` | 空间区域 | 男厕 / 会议室 / 走廊(必须有 spaceType) |
| `FACILITY` | **消防 / 安防器材** | 消火栓 / 烟感 / 喷淋(必须有 fireType, v3.1 新增) |

> 💡 **不确定的填什么?** → `CEILING`(默认值,不会报错),`renderTypeConfidence: low` 让人工后续 review。
>
> ⚠️ **v3.1 重要变化**:
> - `FACILITY` 新增 → 消防 / 安防器材(消火栓、烟感、喷淋等),必须配 `fireType` 子分类(11 种)
>
> ⚠️ **v3 重要变化**:
> - `ROOF` 删除 → 屋顶 mesh 一律 `CEILING`(避免 `floorType.ROOF` 跟 `renderType.ROOF` 跨界)
> - `WALL` 新增 → 覆盖墙/柱/梁等结构(之前只能归 CEILING / ROOF,语义不准)

### 5.2 spaceType(13 种,**仅 renderType=SPACE 用**)

| 值 | 中文 | 用于 |
|---|---|---|
| `TOILET` | 厕所 | 男 / 女 / 无障碍 |
| `LAUNDRY` | 洗衣房 | |
| `KITCHEN` | 厨房 | |
| `OFFICE` | 办公室 | |
| `MEETING_ROOM` | 会议室 | |
| `BEDROOM` | 卧室 | |
| `CORRIDOR` | 走廊 | |
| `STAIRWELL` | 楼梯间 | 跟 STAIR 构件区别,这里是"楼梯所占的空间" |
| `ELEVATOR_HALL` | 电梯厅 | |
| `MECHANICAL_ROOM` | 机房 | 强电 / 弱电 / 空调 |
| `STORAGE` | 储藏室 | |
| `LOBBY` | 大堂 | |
| `BALCONY` | 阳台 | |

### 5.3 fireType(11 种,**仅 renderType=FACILITY 用**,v3.1 新增)

| 值 | 中文 | 用于 |
|---|---|---|
| `HYDRANT` | 消火栓 | 室内 / 室外 |
| `SMOKE_DETECTOR` | 烟感 | 烟雾报警器 |
| `SPRINKLER` | 喷淋 | 自动喷淋头 |
| `EXTINGUISHER` | 灭火器 | 手提 / 推车 |
| `EMERGENCY_LIGHT` | 应急照明 | 应急灯 / 疏散指示灯 |
| `EXIT_SIGN` | 安全出口标志 | 出口标志牌 |
| `BREAK_GLASS` | 破玻按钮 | 手动火灾报警按钮 |
| `ALARM_BELL` | 警铃 | 火灾警铃 |
| `FIRE_HOSE` | 水带接口 | 消防水带接口 |
| `FIRE_DOOR` | 防火门 | 防火卷帘 / 防火门 |
| `OTHER` | 其他 | 其他消防 / 安防器材 |

**重要边界**: `renderType=FACILITY` **跟位置无关** — 不管挂墙 / 挂顶 / 落地,**就是设备本身**,不标 CEILING / WALL。

---

## 6. 命名规范

### 6.1 `sid`(节点级,**业务唯一短 ID**)

**格式**:
```
<RENDERTYPE>_<FLOORNAME>_<SEQ>
```

- `RENDERTYPE`: renderType **大写**(注意 SPACE 用 `SPACE`)
- `FLOORNAME`: scene.extras.floorName
- `SEQ`: 同 floorName + renderType 内的整数序号,**从 1 开始**

**例子**:
```
WINDOW_A_6F_1              # A 楼 6 层 第 1 个窗户
WINDOW_A_6F_2              # A 楼 6 层 第 2 个窗户
DOOR_A_6F_1                # A 楼 6 层 第 1 个门
DOOR_B_24F_3               # B 楼 24 层 第 3 个门
ELEVATOR_B_24F_1           # B 楼 24 层 第 1 个电梯
CEILING_A_1F_1             # A 楼 1 层 第 1 块楼板
SPACE_A_6F_MR_TOILET_01    # A 楼 6 层 男厕 #1 (SPACE 可加描述)
```

**SEQ 编号**: 同层同类构件顺序递增,**不强制从某方向起**,保证唯一即可(从 Blender 大纲从上往下数也行)。

### 6.2 `findId`(节点级,**自动派生,通常不手填**)

**格式**:
```
<FLOORNAME>_mesh_<NODE_INDEX>
```

- `FLOORNAME`: scene.extras.floorName
- `NODE_INDEX`: mesh 节点在 GLB 内部 nodes 数组的索引(从 0 开始)

**例子**: `A_6F_mesh_42`

> Blender 里这个字段**工具脚本会填**,操作员**不需要管**。但能看到。

### 6.3 `name`(节点级,人类可读)

**格式建议**: `<楼栋> <位置> <种类>`

```
A 楼 6 层 主入口门
A 楼 6 层 西北角窗户
B 楼 24 层 男厕
```

**没有强制,但强烈建议加**。LLM 读着会方便很多。

### 6.4 `floorName`(节点级)

**等于 scene.extras.floorName**,只是冗余放在每个 mesh 上(方便过滤,**不用 traverse 找 parent**)。

---

## 7. 特殊情况:LANDSCAPE

`LANDSCAPE_TERRAIN.glb` / `LANDSCAPE_FACADE.glb` 是地形和外立面,**不属于任何楼**:

| 字段 | 值 |
|---|---|
| scene.floorName | `LANDSCAPE_TERRAIN` 或 `LANDSCAPE_FACADE` |
| scene.building | 字符串 `"null"` |
| scene.level | 整数 `0` |
| scene.floorType | `LANDSCAPE_TERRAIN` 或 `LANDSCAPE_FACADE` |

mesh 节点:
- `building` 填字符串 `"null"`
- `level` 填 `0`
- `renderType` 填 `CEILING`（不允许 `TERRAIN`；v3.1 的 8 种 renderType 中没有该值）
- `sid` 仍然必填,例子: `CEILING_LANDSCAPE_TERRAIN_1`

---

## 8. Blender 自定义属性操作步骤(详细)

### 8.1 加新属性

1. 选中物体(根节点 / mesh)
2. 按 **N** 打开右侧属性面板
3. 滚到最下,找到 **"Custom Properties"** (自定义属性)section
4. 点 **➕** 新建
5. Blender 弹窗问你属性名 → 输入 `floorName` / `sid` 等
6. 选择类型(String / Integer)
7. 点 OK
8. 在新出现的属性行右侧填值

### 8.2 批量加同一属性到多个物体

如果一次要给 50 个窗户都加 `floorName = A_6F`:

1. **全选**这些 mesh(Shift + 点击 / 框选)
2. N 面板 → Custom Properties
3. ➕ 新建 `floorName` → String → `A_6F` → OK
4. Blender 会**对所有选中物体加这个属性**(值都一样)

### 8.3 改了属性值但导出没生效?

99% 是导出时**没勾 Custom Properties**。

**导出步骤**(再确认一次):
1. File → Export → glTF 2.0 (.glb)
2. 右边面板:
   - ✅ **Custom Properties** ← 必勾
   - ✅ **GLTF Extras** ← 默认勾
3. 导出

### 8.4 验证

导出后跑:

```bash
node scripts/validate-metadata.mjs hospital --file A_6F
```

会告诉你:
- sid 缺失多少
- renderType 缺失多少
- 全局 sid 重复
- spaceType 缺失

---

## 9. 完整对照表(打印出来对照填)

### 场景级(1 份 / GLB)

| 字段 | 类型 | 例(A_6F) | 例(LANDSCAPE_TERRAIN) |
|---|---|---|---|
| floorName | String | A_6F | LANDSCAPE_TERRAIN |
| building | String | A | null |
| level | Integer | 6 | 0 |
| floorType | String(枚举) | FLOOR | LANDSCAPE_TERRAIN |
| name | String | A 楼 6 层 | 地形 (基础场景) |

### 节点级(n 份 / GLB)

| 字段 | 类型 | 例(门) | 例(男厕 SPACE) |
|---|---|---|---|
| sid | String | DOOR_A_6F_1 | SPACE_A_6F_MR_TOILET_01 |
| name | String | A 楼 6 层 主入口门 | A 楼 6 层 男厕 |
| floorName | String | A_6F | A_6F |
| building | String | A | A |
| level | Integer | 6 | 6 |
| renderType | String(枚举) | DOOR | SPACE |
| renderTypeConfidence | String | high | high |
| spaceType | String | (留空) | TOILET |

> `findId` 不用手填,工具脚本会自动写入。

---

## 10. 必读注意

1. **导出必勾 Custom Properties**,不勾全白填
2. **floorName 必须等于文件名**(A_6F.glb 的 floorName 就是 A_6F)
3. **sid 全局唯一**(55 个 GLB 之间不能重复 sid)
4. **renderType 大写严格**(`wINDOW` / `door` 都不行)
5. **renderType=SPACE 必须配 spaceType**(漏了 validate 会报错)
6. **不确定的 renderType 填 CEILING**,confidence=low,后续人工 review
7. **冗余字段(floorName/building/level)每个 mesh 都要填**,跟上层 scene 一致

---

## 11. 批次操作(Blender Python 脚本)

> **目标**: 用一个 Python 脚本批量给 GLB 加 metadata,不用一个个 mesh 手动加属性。
>
> **脚本路径**: [`docs/blender/bulk_inject_metadata.py`](./blender/bulk_inject_metadata.py)(放在 `docs/` 下,项目代码**不引用**)
>
> **目录说明**: [docs/blender/README.md](./blender/README.md)

### 11.1 整体思路

```
Blender Python 脚本能跑:
  1. 按 mesh.name 关键词猜 renderType (DOOR/WINDOW/STAIR/ELEVATOR/WALL/FACILITY；未匹配默认 CEILING；SPACE 看 collection)
  2. 按 mesh 名字 + 父级 collection 名字猜 spaceType (TOILET/MEETING_ROOM/...)
  3. 自动写 sid (按 (renderType + 楼层内 sequence) 生成)
  4. findId / 冗余楼层字段仍由 `scripts/auto-fill.mjs` 后处理，本脚本不写
  5. 自动写 renderTypeConfidence (猜出来的 = low, 已知映射的 = high)

→ 命名越规范，自动分类越准；所有 low confidence 和 FACILITY/fireType 结果仍需人工 review
```

### 11.2 前置条件

| 你需要准备 | 必要性 | 说明 |
|---|---|---|
| **mesh 在 Blender 里有合理名字** | ⚠️ 强烈推荐 | 像 `Door_Main_A_6F` / `Window_NW_01` / `Staircase_A` 这种。`MERGED_0_LIBENT...` 这种全归 CEILING |
| **mesh 放进命名 collection** | ⚠️ 强烈推荐 | 例:`TOILET_MALE` / `MEETING_ROOM_LARGE` / `CORRIDOR_EAST`,脚本按 collection 名字猜 spaceType |
| **文件名 = floorName** | ✅ 自动 | 已经在 `validate-metadata` 里校验 |
| **building / level / floorType** | ✅ 自动 | `auto-fill.mjs` 已经能从文件名推 |

### 11.3 用法

```bash
# 在 Blender 里: Scripting 工作区 → Open → 选脚本 → Run Script

# 或者命令行 (需要 Blender CLI):
blender --background \
  --python docs/blender/bulk_inject_metadata.py \
  -- --input path/to/A_6F.glb \
     --output path/to/A_6F_injected.glb \
     --dry-run
```

**输出示意**（实际数量取决于模型）:
```
[bulk-inject] Injected WINDOW / WALL / FACILITY ...
[bulk-inject] Unmatched names defaulted to CEILING (low confidence)
[bulk-inject] SPACE classified from collection names
[bulk-inject] Review list:
  - A_6F_mesh_4521 → CEILING (auto, low)
  - ...
```

### 11.4 名字匹配规则（当前脚本摘要）

```python
# 完整规则以 docs/blender/bulk_inject_metadata.py 为唯一来源。
# v3.1: 没有 ROOF；屋顶 mesh 归 CEILING。SPACE 由 collection 名判断。
RENDER_TYPE_RULES = {
    'DOOR':     ['door', '门', 'door_'],
    'WINDOW':   ['window', 'win_', '窗', 'wd_', 'wn_'],
    'STAIR':    ['stair', 'step', '楼梯'],
    'ELEVATOR': ['elev', 'lift', '电梯'],
    'WALL':     ['wall', '柱', '梁', 'beam', 'column', 'pillar', '墙'],
    'FACILITY': ['hydrant', 'smoke_detector', 'sprinkler', 'extinguisher',
                 'emergency_light', 'exit_sign', 'alarm_bell', 'fire_',
                 '消火栓', '烟感', '喷淋', '灭火器', '应急', '报警器'],
    'SPACE':    None,
}
```

`FIRE_TYPE_RULES`、`SPACE_TYPE_RULES` 和匹配优先级直接查看脚本，避免复制后的规则
再次漂移。修改规则时要同步运行 metadata 验证。

### 11.5 命名建议(在 Blender 里 rename mesh)

**对 mesh 改名**(Blender 大纲里 → 双击 / F2):
- ✅ 推荐: `Door_A_6F_001` / `Window_NW_42` / `Staircase_South`
- ❌ 不行: `MERGED_0_LIBENT2672_0` / `Object_023` / `Cube.001`

**对 collection 改名**(空间标注用):
- `Collection` → 重命名为 `TOILET_MALE_A_6F` / `MEETING_ROOM_BIG` / `CORRIDOR_E`
- 没分 collection 的:全选同空间 mesh → 菜单 M → New Collection → 命名

### 11.6 当前我们有什么

| 脚本 | 状态 | 干什么 |
|---|---|---|
| `scripts/auto-fill.mjs` | ✅ 已存在 | 自动填 findId + 冗余字段 (不动 sid/renderType) |
| `scripts/validate-metadata.mjs` | ✅ 已存在 | 校验 metadata 完整性 |
| `scripts/inject-scene-name.mjs` | ✅ 已存在 | 自动填 scene.extras.name |
| `docs/blender/bulk_inject_metadata.py` | ✅ 已存在 | 在 Blender 里批量加 sid/renderType/spaceType |

### 11.7 方位 + 顺时针编号 + mesh 合并(建模规则)

详细规则见 [GLB_METADATA_SPEC.md §3.4 / §3.5](./GLB_METADATA_SPEC.md),要点:

**方位**(8 分组,俯视,北向上):

```
       N
       ↑
NW ─── O ─── NE
       │
       ↓
       S
```

**SEQ 编号**:每组从该方向的"最西北端"开始,**顺时针**数 1, 2, 3, ...

**mesh.name 推荐**:`Window_NW_01` / `Door_E_02` / `Staircase_S`

**mesh 合并**(关键):

| 场景 | 操作 |
|---|---|
| 一扇窗 = 玻璃 + 窗框 + 把手 | **Ctrl+J 合并** → 1 mesh(跟 sid 1:1) |
| 同区域多扇窗 | **Ctrl+G Collection**(可选,建模期方便批量改材质) |
| 不同种构件聚一组 | **不建议合并**,各为独立 mesh |

**重要**:
- Ctrl-J 后,玻璃/窗框/把手**不能再单独编辑**(要解开重做)
- Ctrl-G 的 Collection 信息**GLB 导出后丢失**,所以业务信息(方位/分类)要存 mesh.name 或 sid,不要存 Collection

---

## 12. 相关文档

- 完整字段定义 / 命名规范 / 校验逻辑:[GLB_METADATA_SPEC.md](./GLB_METADATA_SPEC.md)
- 工具方注入语义描述(`semantic.displayName` 等):[GLB_METADATA_SPEC.md §12](./GLB_METADATA_SPEC.md)
- 验收脚本:`scripts/validate-metadata.mjs`
- 自动填冗余字段:`scripts/auto-fill.mjs`
- 前端 API 用法:[SSPTool_API_CATALOG.md § 2.6](./SSPTool_API_CATALOG.md)
