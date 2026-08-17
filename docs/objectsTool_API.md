# objectsTool API 文档

> 场景内对象操作 — 有界查询与描述 / 高亮租约 / 可见性 / 楼层炸开
> 文件: `src/ssp/objects/objectsTool.ts`
> 命名空间: `ssp.objectsTool.*`

---

## 1. 查找与有界查询 API

### 1.1 `getById(id, opts?)`

**业务唯一短 ID 查找** (推荐, 99% 场景用这个)

```ts
getById(id: string, opts?: FindOptions): THREE.Object3D | null
```

**id 匹配顺序**:
1. `userData.sid` 优先 (业务短 ID, e.g. `DOOR_A_6F_1`)
2. `userData.findId` fallback (GLB 内自动派生, e.g. `A_6F_mesh_42`)
3. 返回 `null` (不模糊匹配 name, 避免歧义)

**例子**:
```js
const door = ssp.objectsTool.getById('DOOR_A_6F_1')
if (door) {
  console.log(door.userData.sid, door.userData.renderType)
}
```

---

### 1.2 `getByUserDataProperty(key, value, opts?)`

**按 userData 字段查找**, 返回数组 (可能有多个匹配)

```ts
getByUserDataProperty(key: string, value: unknown, opts?: FindOptions): THREE.Object3D[]
```

**兼容**: 直接 `userData[key]` 或 `userData.extras[key]` (GLTF loader 行为差异, GLTF 默认会展开 extras 到 userData)

**常用字段**:
| key | 例子 | 含义 |
|---|---|---|
| `renderType` | `'CEILING'` / `'DOOR'` / `'WINDOW'` ... | 构件种类 |
| `spaceType` | `'TOILET'` / `'OFFICE'` ... | 空间类型 (仅 SPACE mesh) |
| `floorName` | `'A_6F'` | 楼层 ID |
| `building` | `'A'` | 楼栋 (A/B/C/COMMON) |
| `level` | `6` | 楼层号 |
| `sid` | `'DOOR_A_6F_1'` | 业务短 ID |
| `findId` | `'A_6F_mesh_42'` | GLB 内 ID |

**opts.scope**: 限定查找范围 (按 subcategory / building)
```js
// 限定 A 楼
const aFloor = ssp.objectsTool.getByUserDataProperty('renderType', 'CEILING', { scope: 'A' })
```

**例子**:
```js
// 找所有 WINDOW
const wins = ssp.objectsTool.getByUserDataProperty('renderType', 'WINDOW')
console.log(`找到 ${wins.length} 个窗户`)

// 找 A 楼 6 层所有 CEILING
const a6 = ssp.objectsTool.getByUserDataProperty('renderType', 'CEILING', { scope: 'A_6F' })

// 找所有厕所
const toilets = ssp.objectsTool.getByUserDataProperty('spaceType', 'TOILET')
```

---

### 1.3 `getByName(name, opts?)` ⚠️ 慎用

**按 name 查找** (GLB 内部名, 通常 `MERGED_*_*_0` 格式, **不唯一**)

```ts
getByName(name: string, opts?: FindOptions): THREE.Object3D | null
```

**返回第一个匹配** — 因为名字可能重复, 不可靠。**推荐用 `getById` 或 `getByUserDataProperty`**。

---

### 1.4 `FindOptions`

```ts
interface FindOptions {
  /** 模糊匹配 (默认 true), 'mesh_42' 找 'mesh_42*' */
  fuzzy?: boolean
  /** 限定查找范围: subcategory (e.g. 'hospital') 或 building (e.g. 'A') */
  scope?: string
}
```

### 1.5 `query(criteria, options)`

按受控字段白名单查询当前 context 的 scene，返回稳定 scene traversal 顺序的对象引用。对象引用只用于 SSP/模板 Runtime 内部组合，不能直接作为 AI 公共输出。

```ts
query(
  criteria: {
    all?: readonly (
      | { field: SceneQueryField; op: 'equals'; value: string | number | boolean | null }
      | { field: SceneQueryField; op: 'in'; values: readonly (string | number | boolean | null)[] }
    )[]
  },
  options: { limit: number },
): THREE.Object3D[]
```

- 条件固定为扁平 AND；同字段 OR 用 `in`。
- 最多 8 个条件，单个 `in` 最多 50 个值，字符串查询值最长 256 字符。
- `limit` 必填且为 1～200；达到上限立即停止遍历。
- 字段是编译期 union，不接受点路径、回调、正则、嵌套 DSL、排序或分页。
- 只返回当前 scene 中具有 `sid` 或 `findId` 的有效对象。

```js
const objects = ssp.objectsTool.query(
  { all: [
    { field: 'renderType', op: 'equals', value: 'DOOR' },
    { field: 'level', op: 'in', values: [1, 2] },
  ] },
  { limit: 50 },
)
```

### 1.6 `describe(objects, options?)`

把当前 scene 的对象引用转换为有界 plain data。最多 200 个对象、最多 16 个字段；任何对象已脱离 scene、来自其他 context、无稳定 ID 或为伪造引用时，整次调用原子失败。

```ts
describe(
  objects: readonly THREE.Object3D[],
  options?: { fields?: readonly SceneDescriptorField[] },
): SceneObjectDescriptor[]
```

返回项固定包含 `id / name / type / visible / metadata`。`metadata` 只含白名单内的 JSON scalar 或最多 50 项的 scalar 数组；最终 AI 字段投影、脱敏、截断和序列化仍由模板 Runtime 负责。

---

## 2. 高亮 API

### 2.1 `setHighlight(obj, color?, pulse?)`

兼容旧调用的单对象高亮。内部已接入与租约 API 相同的材质状态引擎，不再把高亮状态写入模型 `userData`；旧用法中的 detached `Object3D` 和未初始化 context 场景仍可由 `setHighlight/unHighlight` 成对处理，但新 scoped 租约始终要求当前 scene 与稳定 ID。

```ts
setHighlight(
  obj: THREE.Object3D,
  color?: string | number | THREE.Color,  // 默认 '#ff0000'
  pulse?: boolean                          // 默认 false
): void
```

**color 接受**:
- 十六进制字符串: `'#ff0000'`, `'#29ccff'`
- 数字: `0xff0000`
- THREE.Color 对象

**pulse = true**：每 500ms 切换高亮状态。`unHighlight` 只释放该对象的 legacy 高亮层，不会释放独立租约。

**例子**:
```js
// 一次性高亮
ssp.objectsTool.setHighlight(door, '#ff0000')

// 脉冲高亮 (告警)
ssp.objectsTool.setHighlight(door, '#ff0000', true)

// 取消高亮
ssp.objectsTool.unHighlight(door)
```

---

### 2.2 `unHighlight(obj)`

**还原** setHighlight 设置的颜色

```ts
unHighlight(obj: THREE.Object3D): void
```

会自动停止该 legacy 层的 pulse（如果有）。

---

### 2.3 `clearAllHighlights()`

**宿主紧急全局恢复**：释放当前 `objectsTool` 实例中的所有 legacy 与 scoped 高亮。

```ts
clearAllHighlights(): void
```

**例子**:
```js
// 高亮一些
ssp.objectsTool.setHighlight(door, '#ff0000')
ssp.objectsTool.setHighlight(window, '#29ccff')

// 全部取消
ssp.objectsTool.clearAllHighlights()
```

该 API 不得用于新模板的补偿逻辑；模板应保留原始 `HighlightLease` 并调用 `releaseHighlight`，避免误伤其他执行。

### 2.4 `applyHighlight(objects, options?)`

```ts
applyHighlight(
  objects: readonly THREE.Object3D[],
  options?: {
    color?: string | number | THREE.Color
    pulse?: boolean
    durationMs?: number
  },
): HighlightLease
```

- 单租约 1～256 个当前 scene 对象；对象必须有 `sid` 或 `findId`。
- 当前 context 最多 128 个活动租约。
- `durationMs` 省略时必须显式释放；提供时范围为 100～300000ms。
- 重叠高亮按“最后应用者优先”；释放顶层会显示下一活动层，最后释放才恢复原材质。
- 共享 material 使用 clone-on-write；最后一层结束后恢复原引用并 dispose SSP 创建的 clone。
- `pulse` 只影响当前可见的顶层租约，由 manager 级调度器统一驱动。

### 2.5 `releaseHighlight(lease)`

```ts
releaseHighlight(lease: HighlightLease): boolean
```

只接受当前 `objectsTool` 创建的原始不透明 handle；复制对象、伪造 ID 或其他 manager 的 handle 会被拒绝。首次释放活动租约返回 `true`，真实租约在已释放或已过期后再次释放返回 `false`。模型根移除或 context 清理也会自动回收活动租约。

---

## 3. 可见性 API

### 3.1 `setVisible(obj, visible)`

**直接切换 obj.visible**

```ts
setVisible(obj: THREE.Object3D, visible: boolean): void
```

---

### 3.2 `setVisibleByFloor(floorName, visible?)`

**整层切换可见性** — 隐藏其他楼层, 只显示该层 (或反之)

```ts
setVisibleByFloor(floorName: string, visible?: boolean): void  // visible 默认 true
```

**例子**:
```js
// 只看 A_6F
ssp.objectsTool.setVisibleByFloor('A_6F')

// 恢复所有
ssp.objectsTool.setVisibleByFloor('A_6F', true)  // 不会恢复其他
// 正确做法: 重新加载场景 或 跑 clearAllHighlights 之后 clear visible
```

---

## 4. 楼层炸开 ⭐

### 4.1 `explodeFloor(opts?)`

**把每层楼的 root 沿指定轴拉开间距**, 便于看到内部结构 (比如楼板 / 管线 / 设备)

```ts
explodeFloor(opts?: {
  gap?: number        // 每层间距 (米), 默认 20
  axis?: 'x' | 'y' | 'z'  // 炸开方向, 默认 'y' (垂直)
  durationMs?: number  // 动画过渡毫秒, 默认 600; 0 = 立刻
}): void
```

**算法**:
1. 收集所有 root (按 `userData.level` 数字)
2. 缓存原始 position (第一次时, 存 `userData.__originalPosition`)
3. 找 midLevel (中位数)
4. 每层 `root.position[axis] = originalPos[axis] + (level - midLevel) * gap`

**例子**:
```js
// 垂直炸开, 20 米间距
ssp.objectsTool.explodeFloor()

// 自定义: 30 米间距, 垂直, 立刻
ssp.objectsTool.explodeFloor({ gap: 30, durationMs: 0 })

// 沿 X 轴炸开 (水平方向)
ssp.objectsTool.explodeFloor({ axis: 'x' })

// 5 秒后自动收起
ssp.objectsTool.explodeFloor({ gap: 25 })
setTimeout(() => ssp.objectsTool.collapseFloor(), 5000)
```

---

### 4.2 `collapseFloor(durationMs?)`

**楼层炸开收回** — 还原每层 root 到原始 position

```ts
collapseFloor(durationMs?: number): void  // 默认 600ms
```

---

### 4.3 `isExploded()`

**查当前是否炸开状态**

```ts
isExploded(): boolean
```

---

## 5. 完整 API 表

| API | 返回 | 说明 |
|---|---|---|
| `getById(sid)` | `Object3D \| null` | 按 sid 找 |
| `getByUserDataProperty(key, value, opts?)` | `Object3D[]` | 按 userData 字段找 |
| `getByName(name, opts?)` | `Object3D \| null` | 按 name 找 (不可靠) |
| `query(criteria, {limit})` | `Object3D[]` | 有界白名单查询，仅供 Runtime 内部消费 |
| `describe(objects, opts?)` | `SceneObjectDescriptor[]` | 有界 plain-data 描述 |
| `setHighlight(obj, color, pulse?)` | `void` | 高亮 / 闪烁 |
| `unHighlight(obj)` | `void` | 还原单对象 |
| `clearAllHighlights()` | `void` | 宿主紧急全局恢复 |
| `applyHighlight(objects, opts?)` | `HighlightLease` | 创建 scoped 高亮租约 |
| `releaseHighlight(lease)` | `boolean` | 按不透明 handle 释放租约 |
| `setVisible(obj, visible)` | `void` | 切换可见 |
| `setVisibleByFloor(floorName, visible?)` | `void` | 整层可见 |
| `resetVisibility()` | `{restored, hiddenBefore}` | 恢复 mesh 可见性 |
| `explodeFloor(opts?)` | `void` | 楼层炸开 |
| `collapseFloor(durationMs?)` | `void` | 楼层收回 |
| `isExploded()` | `boolean` | 查炸开状态 |

---

## 6. 配套模板 (ssp-shim)

| 模板 | 用的 API |
|---|---|
| `ssp_templates/objects/getObjectById` | `getById` |
| `ssp_templates/objects/getObjectByUserDataProperty` | `getByUserDataProperty` |
| `ssp_templates/objects/findObjectBySid` | `getById` (走 sid 优先) |
| `ssp_templates/objects/highlight-objects.json` | `getByUserDataProperty` + `setHighlight` |
| `ssp_templates/objects/focus-on-object.json` | `getById` + `setHighlight` + `cameraController.flyToObject` |
| `ssp_templates/objects/floor.json` | `setVisibleByFloor` |
| `ssp_templates/objects/flash-alarm.json` | `getByUserDataProperty` + `setHighlight` (闪烁) |
| `ssp_templates/objects/explode-floor.json` ⭐ | `explodeFloor` + `isExploded` |
| `ssp_templates/objects/highlight-objects.json` | `getById` + `setHighlight(obj, color, true)` (pulse) |
| `ssp_templates/objects/floor.json` | `setVisibleByFloor` + `flyToObject` |

---

## 7. 内部实现细节 (debug 用)

### 7.1 内部状态

| key | 类型 | 含义 |
|---|---|---|
| `__originalPosition` | `Vector3` | explodeFloor 前的 position, collapseFloor 还原 |
| `__isExploded` | `true` | 标记炸开状态 (collapse 时 delete) |

高亮状态不再写入 `userData`：manager 按 `mesh + material slot` 保存原材质、SSP-owned clone 和租约层栈，并统一维护到期与 pulse 调度。`__originalPosition` / `__isExploded` 仍是炸开功能的内部 key，LLM 模板和业务代码不应读写。

### 7.2 跳过规则

`findInScene` 跳过:
- `instanceof THREE.Camera`
- `instanceof THREE.Light`
- `obj.name` 以 `ssp_helper_` 开头 (内部 helper)
- 限定 `opts.scope` 时, 不在 scope 内的 root 下的对象

### 7.3 错误处理

- `getSspContext()` 失败 → 抛错 (ssp context 未初始化)
- 找不到对象 → 返回 `null` 或 `[]` (不抛错)
- `new Function(code)` SyntaxError → 上层 runner 捕获 (沙盒)

---

## 8. 跟 GLB metadata 的关系

objectsTool 的稳定查询、描述、按楼层操作和 scoped 高亮依赖符合通用 GLB metadata 契约的数据；医院模型仅是测试样例，不是生产命名或业务边界：

| objectsTool 调用 | 依赖的 userData 字段 |
|---|---|
| `getById('DOOR_A_6F_1')` | `userData.sid === 'DOOR_A_6F_1'` |
| `getByUserDataProperty('renderType', 'WINDOW')` | `userData.renderType === 'WINDOW'` |
| `getByUserDataProperty('spaceType', 'TOILET')` | `userData.spaceType === 'TOILET'` |
| `setVisibleByFloor('A_6F')` | `userData.floorName === 'A_6F'` |
| `explodeFloor()` | `userData.level` (数字) |

缺少对应 metadata 时，依赖该字段的查询或操作不可用；直接持有有效 `Object3D` 的基础显隐和 legacy 操作仍可工作。详见 [GLB_METADATA_SPEC.md](./GLB_METADATA_SPEC.md)。
