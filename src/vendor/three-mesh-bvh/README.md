# three-mesh-bvh 源码归档(未集成)

## 状态

**当前不导入,纯源码归档**。原因:

- 上游 `src/` 是 .js 源码(没配 .d.ts),改造成 TS 工作量大
- 本项目模板测试当前阶段不需要精确射线检测
- `flyToObject` 现在用 `THREE.Box3.setFromObject` 已够用(粗略包围盒)

## 来源

- 上游仓库: <https://github.com/gkjohnson/three-mesh-bvh>
- License: MIT (上游 LICENSE 文件)
- 上游版本: master 分支

## 文件清单

```
core/
  BVH.js                 # 基类
  BVHNode.js
  BVHTraversalHelper.js
  Constants.js           # CENTER / AVERAGE / SAH / 交集枚举
  GeometryBVH.js
  LineBVH.js
  MeshBVH.js             # ⭐ Mesh raycast 用这个
  ObjectBVH.js
  PointsBVH.js
  SkinnedMeshBVH.js
  build/                 # 树构建 (buildTree / sortUtils 等)
  cast/                  # 各种 cast 算法 (.template.js 是 rollup 模板,会被编译成 .js)
  utils/                 # BufferStack / intersectUtils 等
math/
  ExtendedTriangle.js
  MathUtilities.js
  OrientedBox.js
  SeparatingAxisBounds.js
objects/
  BVHHelper.js           # 可视化调试用
utils/
  ArrayBoxUtilities.js
  BufferUtils.js
  ExtensionUtilities.js  # ⭐ patchedMesh / acceleratedRaycast 扩展
  GeometryRayIntersectUtilities.js
  PrimitivePool.js
  StaticGeometryGenerator.js
  ThreeRayIntersectUtilities.js
  TriangleUtilities.js
debug/
  Debug.js               # getBVHExtremes / estimateMemoryInBytes 等工具
```

## 何时启用

当模板测试碰到:
- **大模型 raycast 卡顿**(73 MB hospital.glb 点击明显延迟)
- **测量距离 / 拾取精度要求到三角形**
- **shapecast / closestPointToPoint 等高级操作**

此时:
1. 用 rollup / esbuild 把上游 src/ 整个编译一次到 dist/ 单文件 ESM
2. 写到 `src/vendor/three-mesh-bvh/dist/three-mesh-bvh.esm.js`
3. 写 `index.ts` re-export 关键 API
4. 在 useThreeScene 里 `mesh.geometry.boundsTree = new MeshBVH(mesh.geometry)` 加速

## 当前替代方案

`flyToObject` 用 `Box3.setFromObject` + `Box3.getBoundingSphere` 算距离 + 位置。够用且零依赖。
