# objectsTool API 文档

> 场景内对象操作 — 查找 / 高亮 / 可见性 / 楼层炸开
> 文件: `src/ssp/objects/objectsTool.ts`
> 命名空间: `ssp.objectsTool.*`

---

## 1. 查找 API

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

---

## 2. 高亮 API

### 2.1 `setHighlight(obj, color?, pulse?)`

**改 material.emissive**, 原始值自动备份 (`userData.__originalEmissive`)

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

**pulse = true**: 1Hz 闪烁 (500ms 切换 0/1 emissive)。`unHighlight` 自动停 pulse。

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

会自动停掉 `pulse` 定时器 (如果有)。

---

### 2.3 `clearAllHighlights()`

**还原场景内所有对象的高亮**

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
| `setHighlight(obj, color, pulse?)` | `void` | 高亮 / 闪烁 |
| `unHighlight(obj)` | `void` | 还原单对象 |
| `clearAllHighlights()` | `void` | 还原全部 |
| `setVisible(obj, visible)` | `void` | 切换可见 |
| `setVisibleByFloor(floorName, visible?)` | `void` | 整层可见 |
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

### 7.1 内部 key (userData 上)

| key | 类型 | 含义 |
|---|---|---|
| `__originalEmissive` | `Map<Mesh, Color>` | setHighlight 前的 emissive, unHighlight 还原 |
| `__pulseTimer` | `setInterval handle` | pulse 定时器, unHighlight / 重新 setHighlight 会 clear |
| `__originalPosition` | `Vector3` | explodeFloor 前的 position, collapseFloor 还原 |
| `__isExploded` | `true` | 标记炸开状态 (collapse 时 delete) |

**注意**: 这些 key 是 `__` 前缀的内部数据, LLM 模板 / 业务代码**不应该**读写。

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

objectsTool **完全依赖** GLB metadata 注入:

| objectsTool 调用 | 依赖的 userData 字段 |
|---|---|
| `getById('DOOR_A_6F_1')` | `userData.sid === 'DOOR_A_6F_1'` |
| `getByUserDataProperty('renderType', 'WINDOW')` | `userData.renderType === 'WINDOW'` |
| `getByUserDataProperty('spaceType', 'TOILET')` | `userData.spaceType === 'TOILET'` |
| `setVisibleByFloor('A_6F')` | `userData.floorName === 'A_6F'` |
| `explodeFloor()` | `userData.level` (数字) |

**所以**:**GLB 没注入 metadata → objectsTool 完全失效**。详见 [GLB_METADATA_SPEC.md](./GLB_METADATA_SPEC.md)。
