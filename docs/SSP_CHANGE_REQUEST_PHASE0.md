# SSP Change Requests from Template Phase 0

> 最后更新：2026-08-14
> 对接状态：完成两轮接口/边界复审；用户已明确授权在本轮实施获批的 CR-SSP-001 与 CR-SSP-003。CR-SSP-002 维持关闭。
> 职责边界：AI 公共输出的字段投影、脱敏、截断和最终序列化仍属于模板 Runtime，不下沉 SSP。

| 编号 | 最终状态 | SSP 结果 |
|---|---|---|
| CR-SSP-001 | SSP 已批准并实施 | `objectsTool.query` / `objectsTool.describe`；模板迁移待 Phase 0 任务合入 |
| CR-SSP-002 | 已驳回并关闭 | 不新增 SSP 命名视角能力 |
| CR-SSP-003 | SSP 已批准并实施 | 不透明 `HighlightLease`、统一高亮状态引擎与 lifecycle cleanup；Runtime capability 接入待 Phase 0 任务合入 |

## CR-SSP-001：有界结构化场景查询

实施 namespace：`ssp.objectsTool`。

```ts
query(
  criteria: ObjectQueryCriteria,
  options: { limit: number },
): THREE.Object3D[]

describe(
  objects: readonly THREE.Object3D[],
  options?: ObjectDescribeOptions,
): SceneObjectDescriptor[]
```

已固化边界：

- `SceneQueryField` / `SceneDescriptorField` 是编译期白名单，不支持动态属性路径。
- 条件只允许扁平 AND 与 `equals/in`；最多 8 个条件，`in` 最多 50 个值，字符串查询值最长 256 字符。
- `limit` 必填且为 1～200；结果按 scene traversal 顺序，达到上限立即停止。
- 只返回当前 context/current scene 中具有 `sid` 或 `findId` 的有效对象。
- `describe` 最多接收 200 个对象、最多 16 个字段；foreign/stale/无稳定 ID 的对象使整次调用原子失败。
- 描述结果只含有界 plain data；不返回任意 `userData` 对象。
- 不包含 `group/compare/summarize/project/sort/offset/cursor`，也不包含任何医院、项目、楼栋或楼层业务判断。
- 原有 `getById/getByName/getByUserDataProperty` 保持兼容。

`query` 返回的 `Object3D[]` 仅供受控 Runtime 内部步骤消费；AI 公共响应必须经过 Runtime 的 schema 投影与序列化。

## CR-SSP-002：命名视角存取

维持关闭。`cameraController.getViewpoint/setViewpoint` 已提供 SSP 原子能力；命名、默认值和持久化属于宿主应用/会话状态。宿主适配器保存受控状态，禁止 `window.__chatStore`，不新增 SSP API。

## CR-SSP-003：受作用域约束的高亮租约

实施 namespace：`ssp.objectsTool`。

```ts
interface HighlightLease {
  readonly id: string
  readonly objectIds: readonly string[]
  readonly status: 'ACTIVE' | 'RELEASED' | 'EXPIRED'
}

applyHighlight(
  objects: readonly THREE.Object3D[],
  options?: HighlightOptions,
): HighlightLease

releaseHighlight(lease: HighlightLease): boolean
```

已固化边界：

- SSP 只接受当前 manager 创建的原始 handle identity；复制、伪造或其他 manager 的 handle 被拒绝。真实 handle 首次释放返回 `true`，已释放/已过期后再次释放返回 `false`。
- 状态按 `mesh + material slot` 维护，重叠采用后写优先；释放非顶层不改变视觉，释放顶层显示下一活动层，最后释放恢复原材质。
- 共享 material 使用 clone-on-write；最后一层结束后恢复原引用并 dispose SSP-owned clone。
- 单租约最多 256 个对象，当前 context 最多 128 个活动租约，SSP `durationMs` 为 100～300000ms，pulse 周期固定 500ms。
- 模型根移除使相关租约 `EXPIRED`；context 切换/清理使活动租约 `RELEASED`，并回收 listener、timer 与材质 clone。
- legacy `setHighlight/unHighlight/clearAllHighlights` 接入同一引擎。`unHighlight` 只释放 legacy owner layer；`clearAllHighlights` 保留为宿主紧急全局恢复，新模板与补偿流程不得调用。

Runtime 仍负责 execution-local capability table、每 execution 最多 32 个活动租约、AI duration 最多 60000ms，以及 cancel/timeout 时逐一释放本执行持有的 handle。这些不属于 SSP 参数或公共命名空间。

过渡期注意：主分支现有 `query-scene` 仍包含直接 scene traversal、metadata 直读和模板内 timer，`clearAllHighlights` 也仍是 AI-enabled；`audit:templates` / `audit:ai-boundary` 只检查既有 schema 与导入边界，不代表上述语义迁移已完成。Phase 0 模板任务必须改为 `query -> describe/action`、execution-local lease capability，并撤销 AI 对宿主紧急 `clearAllHighlights` 的直接调用后，CR 才能端到端关闭。

## 实施文件与验证

本轮 SSP 实施范围：

- `src/ssp/objects/objectsTool.ts`
- `src/ssp/objects/highlightLeaseManager.ts`
- `src/ssp/core/context.ts`（仅新增内部 cleanup hook，不挂到公共 `ssp` namespace）
- `src/composables/useThreeScene.ts`（销毁时先释放 scene-bound SSP 资源，再 dispose 模型材质）
- `src/test/objects/objectsToolSuite.ts`
- `scripts/test-objects.mjs`

验证命令：

```bash
npm run test:objects
npm run typecheck
npm run test:topology
npm run audit:topology-boundary
npm run audit:templates
npm run audit:ai-boundary
npm run build
```

实现授权不扩大到行业适配器。后续 topology 数据适配必须以“通用 GLB metadata → world-space 显式 graph”为目标，医院模型只作为测试 fixture，函数、变量、模板和文档不得使用 `hospital-navigation` 一类生产指向性命名。

当前独立对象回归共 13 项，覆盖 inherited/non-enumerable 输入、重叠与到期、伪造 handle、共享单材质与材质数组、异常原子回滚、资源上限、子 Mesh/模型根移除、复用 context 对象切换 scene、context 清理，以及 detached legacy 兼容。
