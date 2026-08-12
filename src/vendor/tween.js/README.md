# tween.js v21.0.0 (本地化版)

## 来源

- 上游仓库: <https://github.com/tweenjs/tween.js>
- 上游版本: v21.0.0
- 上游 ESM 单文件: `dist/tween.esm.js` (jsDelivr CDN)
- License: MIT (见 [LICENSE](./LICENSE))
- 上游版权: Copyright (c) 2010-2012 Tween.js authors; Easing equations Copyright (c) 2001 Robert Penner

## 本地化做了什么

1. 把上游 ESM 单文件 (858 行) 拆成 7 个职责单一的 TS 模块:
   - `Tween.ts` — Tween 类 + 主 group 单例 (TWEEN) + add/remove/update/getAll 等顶层 API
   - `Easing.ts` — 11 个缓动组 × 4 种变体 = 44 个缓动函数,加 `getEasing(name, variant)` 字符串查找
   - `Interpolation.ts` — Linear / Bezier / CatmullRom
   - `Group.ts` — tween 容器
   - `Sequence.ts` — 全局 id 生成器
   - `Now.ts` — 时间源 (performance.now)
   - `index.ts` — 统一命名导出 + 默认导出
2. `var` → `export const/let`,`prototype` → `class`,加完整 TS 类型注解
3. 删除临时 `tween.esm.js` 引用,代码完全可控

## API 与上游 100% 兼容

| 上游用法 | 本地化用法 |
|---|---|
| `import { Tween, Easing } from '@tweenjs/tween.js'` | `import { Tween, Easing } from '@/vendor/tween.js'` |
| `import TWEEN from '@tweenjs/tween.js'` | `import TWEEN from '@/vendor/tween.js'` |
| `TWEEN.update()` | `TWEEN.update()` (不变) |
| `new Tween(obj).to({x:1}, 1000).easing(Easing.Cubic.InOut).start()` | 同上 |

## 主循环集成示例

```ts
import { update as tweenUpdate } from '@/vendor/tween.js'

function tick() {
  requestAnimationFrame(tick)
  tweenUpdate()   // 每帧推进所有 tween
  renderer.render(scene, camera)
}
```

## 何时更新到新版

v21 之后上游主版本升级时,重新跑一遍:
1. 从 jsDelivr 拉新版 ESM 单文件
2. 与本目录的 .ts 文件逐行 diff
3. 合并新逻辑 → 重导出
