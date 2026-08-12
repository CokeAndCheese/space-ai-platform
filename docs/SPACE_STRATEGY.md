# SPACE 设计策略 + A→B 切换方案

> **当前方案**: A(占位 mesh)
> **未来切换**: B(真实建筑 mesh 集合)
> **最后复核**: 2026-08-10（策略未变；模板回归基线已更新为当前 79 个）
>
> 这份文档记录两个方案的对比 + A→B 切换的工作量, **未来需要时再回来翻**。

---

## 1. 背景

GLB metadata 里需要表达"空间"概念(男厕 / 会议室 / 走廊)。
两种实现方式:
- **A(当前)**: 每个空间放一个 mesh(占位),形态任意(推荐 plane)
- **B(未来)**: 用 Collection / 多 mesh 表达空间的真实几何

---

## 2. 方案 A:占位 mesh(当前)

### 数据形态

```
A_6F 男厕:
  - 1 个 mesh(任意几何, 推荐 plane 框出范围)
  - userData:
    - sid:         "SPACE_A_6F_MR_TOILET_01"
    - renderType:  "SPACE"
    - spaceType:   "TOILET"
    - floorName:   "A_6F"
    - building:    "A"
    - level:       6
  - 渲染建议: 半透明色块(便于用户看到空间边界)
    - TOILET          = 半透明绿色
    - MEETING_ROOM    = 半透明黄色
    - 其他            = 半透明蓝色
```

### 优点

| | 说明 |
|---|---|
| ✅ 跟前 6 种 renderType 一致 | userData 结构完全一样,代码 0 改动 |
| ✅ 点击 / 高亮 / flyToObject 直接命中 mesh | 跟 WINDOW/DOOR 同等待遇 |
| ✅ Blender 建模简单 | 放一个 plane 就行 |
| ✅ LLM 友好 | `getByUserDataProperty('spaceType', 'TOILET')` 直接拿到 mesh 列表 |
| ✅ 跨 GLB 一致 | 每个 GLB 独立,无相互依赖 |

### 缺点

| | 说明 |
|---|---|
| ❌ 几何不对齐真实建筑 | 占位 mesh 是"近似范围",不是真实房间轮廓 |
| ❌ "剖切"功能弱 | 不知道房间 6 个面方向,需要手动指定 |
| ❌ "飞向门口"功能弱 | 不知道哪个 mesh 是入口 |
| ❌ 每个空间要单独建模 | 300+ 空间 × 几小时人工 |

### 当前 cover 的功能

| 功能 | 是否支持 |
|---|---|
| 按 spaceType 查询 | ✅ |
| 高亮 | ✅ |
| 点击命中 | ✅ |
| flyToObject(飞中心) | ✅ |
| flyToObject(飞门口) | ❌ |
| 剖切(切掉一面墙) | ❌ |

---

## 3. 方案 B:真实 mesh 集合(未来)

### 数据形态

```
A_6F 男厕:
  - 6 个真实 mesh(4 面墙 + 地板 + 顶):
    - wall_1 (renderType: WALL)
    - wall_2 (renderType: WALL)
    - wall_3 (renderType: WALL)
    - wall_4 (renderType: WALL)
    - floor_1 (renderType: CEILING)
    - ceiling_1 (renderType: CEILING)
  - 一个"空间标记"机制:
    - 方案 B1: 一个主 mesh 加 sid + spaceType, 其他 5 个 mesh 加 spaceRef 指向主 mesh
    - 方案 B2: 用 Blender Collection 概念(运行时按父级 group 节点算)
  - GLTF extras:
    - 主 mesh:
      sid: "SPACE_A_6F_MR_TOILET_01"
      renderType: "SPACE"
      spaceType: "TOILET"
      spaceRef: "SPACE_A_6F_MR_TOILET_01"  // 自身
    - 其他 mesh:
      spaceRef: "SPACE_A_6F_MR_TOILET_01"  // 指向主 mesh 的 sid
```

### 优点

| | 说明 |
|---|---|
| ✅ 几何对齐真实建筑 | 6 个 mesh 就是房间的 6 个面 |
| ✅ bbox 自动算 | 用 6 个 mesh 算 THREE.Box3 包围盒 |
| ✅ 剖切自然支持 | bbox 的 6 个面 = 房间 6 个方向 |
| ✅ 飞向门口可用 | 距离 bbox 一个面最近的实际 mesh = 入口 |
| ✅ 视觉空间感强 | 用户看到的是真房间,不是占位 |

### 缺点

| | 说明 |
|---|---|
| ❌ Blender Collection 导出 GLB **不保留** | 运行时只能从 mesh 反推 |
| ❌ 需要 sid 在多 mesh 间共享 | `getById` 当前返回 1 个 Object3D,要改成返回数组 |
| ❌ flyToObject 接受 collection 参数 | 新 API 或扩展 |
| ❌ 数据迁移成本高 | Blender 里重新整理 collection + 给多 mesh 加 spaceRef |
| ❌ 现有 LLM 模板失效 | `getByUserDataProperty('spaceType', 'TOILET')` 拿不到结果,改 API |
| ❌ 跟现有代码架构冲突 | 需要新增 `ssp.spaceTool` 或大量改 `objectsTool` |

---

## 4. A→B 切换成本

### 代码改动(3-4 天)

| 改动 | 工作量 | 依赖 |
|---|---|---|
| 数据迁移(Blender 整理 collection + 加 spaceRef) | 2-3 天 | Blender 操作员 |
| `setHighlight` 支持 spaceRef(多 mesh) | 半天 | objectsTool |
| `flyToObject` 接受 spaceRef(用 bbox) | 半天 | cameraController |
| 新 `ssp.spaceTool` 提供 `getBySpaceType` / `getBoundingBox` 等 | 1 天 | (可选,如果不想改 objectsTool) |
| 模板迁移(`getByUserDataProperty('spaceType', ...)` 用法保持兼容) | 半天 | 模板 |
| Blender Python 脚本改(支持多 mesh 加 spaceRef) | 半天 | docs/blender/ |
| docs 更新 | 1-2 小时 | docs |
| 测试 + 回归（当前 79 个模板全量跑一遍） | 1 天 | — |

**总:3-4 天工作量**(数据迁移占一半)。

### 不需要改的

- ✅ SPACE mesh 本身不用删(可以转成"主 mesh",其他 mesh 加 spaceRef)
- ✅ 渲染逻辑(ssp.objectsTool.setHighlight 用 mesh 数组就行)
- ✅ 前端 ssp API 接口(只增不删)

### 风险

| 风险 | 评估 |
|---|---|
| 引用 `SPACE/spaceType` 的模板受返回结构变化影响 | 中，可同时保留 A 作为 fallback，并用 Registry 审计实际引用 |
| GLB 导出丢失 collection 结构 | 中(用 mesh 父子关系反推) |
| flyToCollection 的 bbox 计算 | 低(标准 THREE.Box3) |
| LLM 提示词失效 | 低(参数名不变,只是返回值从 1 个变多个) |

---

## 5. 何时切 B?

**触发条件**(满足任一即建议切):

| 触发 | 为什么 |
|---|---|
| 用户要求"飞向房间门口"(不是中心) | A 方案无法精确知道门口在哪 |
| 用户要求"剖切"功能 | A 方案需要手动指定切面,B 自动 |
| 用户要求"按空间范围搜索"(找哪几个空间在视野内) | A 方案能近似,B 更准 |
| 5+ 个 SPACE 相关模板无法在 A 下实现 | 已逼近 A 方案能力边界 |

**暂不切**的判断依据:
- 当前 SPACE 模板只用 `getByUserDataProperty('spaceType', 'X')` + `setHighlight`,A 100% cover
- 30+ 个非 SPACE 模板不受影响
- 数据迁移成本高(2-3 天人工)

---

## 6. 推荐路径

```
阶段 2 (现在):  用 A 方案
  ↓ SPACE 占位 mesh 建模(预计几小时人工 × N 层)
阶段 3 (4-6 个月后): 视需求决定
  ├─ 没新需求 → 保持 A
  └─ 有剖切/门口需求 → 切 B (3-4 天工作量)
```

---

## 7. 相关文档

- 当前规范: [GLB_METADATA_SPEC.md §0.7](./GLB_METADATA_SPEC.md)
- Blender 指南: [BLENDER_METADATA_GUIDE.md](./BLENDER_METADATA_GUIDE.md)
- 枚举变更历史: [GLB_METADATA_SPEC.md 头部 v3 变更](./GLB_METADATA_SPEC.md)
