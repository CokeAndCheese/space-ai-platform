# SSP Change Requests from Template Phase 0

> 最后更新：2026-08-17
> 对接状态：主任务已获用户明确授权并完成 CR-SSP-001 与 CR-SSP-003 的 SSP 实施和复审；CR-SSP-002 维持关闭。
> 模板任务边界：本任务未修改任何 `src/ssp/**` 文件，也不重复实现 SSP。
> 职责边界：AI 公共输出的字段投影、脱敏、截断和最终序列化仍属于模板 Runtime，不下沉 SSP。

| 编号 | 最终状态 | SSP 结果 | 模板侧状态 |
|---|---|---|---|
| CR-SSP-001 | SSP 已批准并实施 | `objectsTool.query` / `objectsTool.describe` | `query-scene` 声明式组合迁移待完成 |
| CR-SSP-002 | 已驳回并关闭 | 不新增 SSP 命名视角能力 | 转宿主适配器/应用会话状态 |
| CR-SSP-003 | SSP 已批准并实施 | 不透明 `HighlightLease`、统一高亮状态引擎与 lifecycle cleanup | execution-local capability 接入待完成 |

## CR-SSP-001：有界结构化场景查询（SSP 已实施）

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

已实施边界：

- `SceneQueryField` / `SceneDescriptorField` 是编译期白名单，不支持动态属性路径。
- 条件只允许扁平 AND 与 `equals/in`；最多 8 个条件，`in` 最多 50 个值，字符串查询值最长 256 字符。
- `limit` 必填且为 1～200；结果按稳定 scene traversal 顺序，达到上限立即停止。
- 输入只接受严格 plain-data shape/array；只返回当前 context/current scene 中具有稳定 `sid` 或 `findId` 的对象。
- `describe` 最多接收 200 个对象、最多 16 个字段；foreign/stale/无稳定 ID 的对象使整次调用原子失败。
- 描述结果只含有界 plain data，不返回任意 `userData` 对象。
- 不包含 `group/compare/summarize/project/sort/offset/cursor`，也不包含行业、项目、楼栋或楼层业务判断。
- 原有 `getById/getByName/getByUserDataProperty` 保持兼容。

`query` 返回的 `Object3D[]` 仅供受控 Runtime 内部步骤消费；AI 公共响应必须经过 Runtime 的 schema 投影、脱敏、截断和序列化。

模板侧待办：将旧 `query-scene` 拆为 `query -> describe`（只读）或 `query -> setHighlight/flyToObject/setVisible`（动作），删除模板内 scene traversal、metadata 直读、timer 和自由业务分支。

## CR-SSP-002：命名视角存取（继续关闭）

`cameraController.getViewpoint/setViewpoint` 已提供 SSP 原子能力；命名、默认值和持久化属于宿主应用/会话状态。宿主适配器保存受控状态，禁止 `window.__chatStore`，不新增 SSP API。

模板侧待办：`captureMainViewpoint` 移出严格 SSP 模板 Registry；默认视角由宿主解析，再调用通用 `setViewpoint` 原子模板，或保留为宿主触发动作。

## CR-SSP-003：受作用域约束的高亮租约（SSP 已实施）

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

已实施边界：

- SSP 只接受当前 manager 创建的原始 handle identity；复制、伪造或其他 manager 的 handle 被拒绝。真实 handle 首次释放返回 `true`，已释放/已过期后再次释放返回 `false`。
- 单租约最多 256 个对象，当前 context 最多 128 个活动租约，`durationMs` 为 100～300000ms。
- 状态按 `mesh + material slot` 维护，重叠采用 last-applied-wins；释放非顶层不改变视觉，释放顶层显示下一活动层，最后释放恢复原材质。
- 共享单材质和 `Material[]` 均使用 clone-on-write；最后一层结束后恢复原引用并 dispose SSP-owned clone。
- apply 失败原子回滚；子 Mesh/模型根移除、scene/context cleanup 会释放对应租约和视觉资源。
- pulse 使用 manager 级共享调度器，周期固定 500ms。
- legacy `setHighlight/unHighlight/clearAllHighlights` 接入同一状态引擎；`setHighlight/unHighlight` 兼容 detached/no-context，`unHighlight` 只释放 legacy owner layer。
- `clearAllHighlights` 仅保留为宿主紧急全局恢复能力，AI/template 和补偿流程不得直接调用。

模板 Runtime 仍必须实现：

- 每次 execution 独立的 capability table，租约只能在本 execution 的 internal output 中传递；
- 每 execution 最多 32 个活动租约，AI `durationMs <= 60000`；
- cancel/timeout/finally 时逐一释放本 execution 持有的原始 handle；
- 拒绝跨 execution 解引用、顶层参数伪造和公共输出句柄残留；
- AI 只接收如 `{ applied, objectCount, expiresAt? }` 的有界回执。

## 当前模板迁移风险

- 旧 `query-scene` 仍直接 traverse scene、读取 metadata 并创建 timer；现有审计通过不代表其满足严格 SSP 组合语义。
- `clearAllHighlights` 仍是 AI-enabled legacy 模板，但公共 API 已明确为 host-only 紧急恢复；必须撤销 AI 直接暴露。
- 新模板应使用通用 GLB metadata 命名，不得引入面向单一 fixture 或行业的生产命名。
- CR-SSP-001/003 的 SSP 实施已完成，但只有 Runtime capability、声明式组合和 AI policy 迁移完成后才算端到端关闭。

## 主任务实施与验证记录

主任务实施范围：

- `src/ssp/objects/objectsTool.ts`
- `src/ssp/objects/highlightLeaseManager.ts`
- `src/ssp/core/context.ts`（仅新增内部 cleanup hook，不挂到公共 `ssp` namespace）
- `src/composables/useThreeScene.ts`（销毁时先释放 scene-bound SSP 资源，再 dispose 模型材质）
- `src/test/objects/objectsToolSuite.ts`
- `scripts/test-objects.mjs`

本模板任务只读核对接口与提交，不修改上述 SSP 实施文件。主任务验证命令：

```bash
npm run test:objects
npm run typecheck
npm run test:topology
npm run audit:topology-boundary
npm run audit:templates
npm run audit:ai-boundary
npm run build
```

独立对象回归共 13 项，覆盖 inherited/non-enumerable 与严格输入、重叠与到期、伪造 handle、共享单材质与材质数组、异常原子回滚、资源上限、子 Mesh/模型根移除、复用 context 对象切换 scene、context 清理和 detached legacy 兼容。

实现授权不扩大到行业适配器。后续 topology 数据适配必须以“通用 GLB metadata -> world-space 显式 graph”为目标；行业模型仅可作为测试 fixture，生产函数、变量、模板和文档不得使用 `hospital-navigation` 一类定向命名。
