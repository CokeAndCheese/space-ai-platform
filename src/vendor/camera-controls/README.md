# camera-controls 本地化 (vendor 版)

## 来源

- 上游仓库: <https://github.com/yomotsu/camera-controls>
- License: MIT (见 [LICENSE](./LICENSE))
- 上游版权: Copyright (c) 2017 @yomotsu

## 本地化做了什么

直接复制 `camera-controls-dev/src/` 到 `src/vendor/camera-controls/`。

上游源码已经是 TypeScript,无需重写;只改 import 路径让其走 Vite alias 即可。

## API 用法

```ts
import CameraControls from '@/vendor/camera-controls'

const controls = new CameraControls(camera, renderer.domElement)

// 平滑飞行到目标 (内置 tween,无需外部 tween.js)
await controls.setLookAt(
  posX, posY, posZ,        // 目标相机位置
  targetX, targetY, targetZ, // 注视点
  enableTransition         // 是否动画
)
```

## 替换 OrbitControls 的迁移点

[src/composables/useThreeScene.ts](file:///Users/mac/Documents/Trae%20Project/space%20AI%20platform/src/composables/useThreeScene.ts) 里目前用的是 `three/examples/jsm/controls/OrbitControls.js`,
后续会替换成 CameraControls 以获得更好的平滑过渡。
