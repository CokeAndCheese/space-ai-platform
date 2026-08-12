---
id: highlight-with-undo
intent:
  - 高亮并延时还原
  - 高亮几秒后自动取消
  - 临时高亮
inputSchema:
  target:
    type: object
    required: true
    desc: Intent target (renderType / fireType / spaceType 等)
  durationMs:
    type: number
    required: false
    default: 5000
    desc: 高亮持续时间 (ms)
  color:
    type: string
    required: false
    default: "#29ccff"
    desc: 高亮颜色
returns: 高亮的 mesh 数
description: |
  高亮一组 mesh 持续指定时间后自动还原。
  用于"临时提醒"型交互 — 高亮一闪而过,无需手动清。
---

# highlight-with-undo: 高亮 + 自动还原

## 流程

1. 调 template `highlight-objects` 把目标 mesh 高亮
2. 等 `durationMs` 毫秒
3. 调 template `clearAllHighlights` 清掉所有高亮

## 代码

```typescript
const { target, durationMs = 5000, color = '#29ccff' } = params

// 1. 先查目标 (用 query template)
const { sids } = await ctx.runTemplate('getObjectByUserDataProperty', {
  key: target.key ?? 'renderType',
  value: target.value,
})

if (!sids || sids.length === 0) {
  ctx.log('highlight-with-undo: no mesh matched target', target)
  return { count: 0, sids: [] }
}

// 2. 高亮
await ctx.runTemplate('highlight-objects', {
  sids,
  color,
})

ctx.log(`highlight-with-undo: highlighted ${sids.length} meshes`)

// 3. 等
await ctx.sleep(durationMs)

// 4. 清
await ctx.runTemplate('clearAllHighlights', {})

ctx.log(`highlight-with-undo: cleared highlights after ${durationMs}ms`)

return { count: sids.length, sids, durationMs }
```

## Examples

- 用户: "高亮消防栓 3 秒后还原" → params: { target: { key: 'renderType', value: 'FACILITY' }, durationMs: 3000 }
- 用户: "临时高亮所有窗户 (5 秒)" → params: { target: { key: 'renderType', value: 'WINDOW' }, durationMs: 5000 }

## Guard

- target 必须包含 key (userData 字段名) 和 value
- durationMs 不应超过 60 秒 (用户体验)
- clearAllHighlights 会清掉所有高亮,不只是本次高亮的 (设计取舍)