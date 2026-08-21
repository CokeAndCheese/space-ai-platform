# models 目录

把要测试的 `.glb` 文件直接丢进这个目录就行。

## 显式清单刷新

`npm run dev`、`npm run build` 和 `npm run verify:r1` 都不会改写模型清单。
只有在用户明确要求刷新清单、已备份现有文件并确认预期差异后，才运行
`npm run list-models`。该命令会扫描本目录的 `.glb` 并有意覆盖生成
`src/model-manifest.json`，随后模型才会在 UI（Home 右上角 / Sandbox 顶部）出现。

## 命名规范

- 文件名必须 **英文** + 数字,不要中文 / 空格 / 括号 (Three.js / Draco 都不友好)
- 推荐用下划线或短横线分隔单词:`building_a.glb`、`park_lot_v2.glb`
- 优化版用 `.opt.glb` 后缀,会被 `displayName` 自动识别:`building_a.opt.glb` → `Building A`

## 切换后是否丢状态

- 切换 GLB 会 dispose 旧模型的几何 / 材质
- ssp-shim 的相机视角不会重置 (你看哪里就停哪里)
- 想回主视角:在 Sandbox 里跑 `flyMainViewpoint` 模板 (后续会加)

## 写回清单（需明确确认）

```bash
npm run list-models
```
