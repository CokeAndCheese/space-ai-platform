# R1 可见性一步撤回 UX 修正验收报告

> 验收日期：2026-08-27
>
> 分支：`codex/r1-generic-spatial-chain`
>
> 状态：内部 PASS，符合本地检查点条件

## 1. 产品结论

用户批准的 R1 收口 UX 修正已经实现并通过内部验收：

- `query-scene` 的 hide、show、isolate 直接执行，不再弹浏览器原生确认框；
- 只保留最新一次精确可见性撤回，恢复该次操作真实改变对象的操作前状态；
- 既有“全部显示”作为显式全局恢复保留，但不等同于撤回；
- 不提供多步撤回或 redo；
- 模型切换、重载或场景卸载会使旧撤回失效；
- 没有修改 `src/ssp/**`、Metadata、topology sidecar 或 Standard Model Package 契约。

## 2. 实现边界

- `src/adapters/visibilityUndo.ts`：单步事务、操作前状态、after 冲突校验、失败补偿和对象挂载校验。
- `src/adapters/visibilityUndoRuntime.ts`：唯一 SSP/context/setVisible host facade；对象引用不进入 receipt、Store、Intent 或 AI catalog。
- `src/templates/legacyRuntime.ts`：只对 legacy `query-scene` 的 hide/show/isolate 接入封闭 facade；撤回是显式 host-only action。
- `src/stores/chat.ts` 与 `src/views/ChatPanel.vue`：移除 hide confirm，提供非阻塞“撤回”提示和“全部显示”反馈。
- Home 与 Sandbox 的模型 URL 变更、卸载和组件卸载均清除撤回代次。

## 3. 自动化证据

- Template Runtime：18/18 PASS。覆盖 mixed hide/show、isolate 的无 SID 与预隐藏 Mesh、单步覆盖、操作失败回滚、after 冲突、部分撤回补偿、generation 失效，以及自然语言 host-only 撤回路由。
- R1 本地 gate 自测：PASS。
- `npm run verify:r1`：10/10 PASS，包括 topology 10/10、sidecar 18/18、scene lifecycle 27/27、Quick Action 20/20、Template Runtime 18/18、三组边界审计、TypeScript 和生产构建。
- 非污染门禁：`src/model-manifest.json` 前后 SHA-256 均为 `2ed654ea23f091008e8bd91f2996077c938026ade8183dea972205997bea9fbc`；完整 Git porcelain 原始字节在 gate 前后相同。

## 4. 真实浏览器证据

在本地生产同源界面使用 A_3F 与 A_2F 实测：

- hide 不出现 JavaScript dialog；A_3F 产生“改变 2 个对象”的撤回入口并成功精确恢复；
- A_2F hide/show 均产生最新一步撤回；show 覆盖前一次 hide，而不会形成第二步历史；
- A_2F isolate 匹配 40 个门，事务记录 166 个真实可见性变化对象；撤回精确恢复 166 个对象；
- “全部显示”清除撤回入口并明确提示其不是撤回；
- A_3F → A_2F 模型切换后旧撤回入口立即消失；
- 浏览器 console 中 0 error、0 warning。

## 5. 自然语言“撤回”缺陷闭环

追加复核发现，原聊天“撤回”未前置路由而进入 LLM，导致模型生成非法 `operation`。最终修复改为确定性 host-only 路由：

- 聊天与顶部撤回按钮共用同一 helper，不进入 Intent、Planner 或 AI catalog；
- host UI 将撤回 user/assistant turns 标为 `llmVisible=false`，与 context ring 解耦；普通后续 LLM history 不包含这些 host turns；
- 审计与 host-only 语义一致：成功撤回记录成功结果，无记录撤回返回确定性反馈并记录失败原因，不生成伪 Intent；
- A_1F 真实浏览器验证：隐藏 101 个门后用聊天“撤回”精确恢复 101 个；再次撤回得到确定性无记录反馈；再次隐藏后点击顶部按钮仍精确恢复 101 个；
- 三轮 QA 闭环：首轮发现 P1 泄漏与 P2 审计问题，第二轮发现 P2 churn 问题；修复后最终 GO，未遗留 P0/P1/P2。

## 6. 独立复核

- 正确性审查：PASS，未发现 P0/P1/P2。
- 复用/窄腰审查：初审的 adapter 落层问题已修复；复核 PASS。
- 性能审查：初审的 `filter + map` 瞬时中间分配 P2 已改为单循环构建；复核关闭。
- 非阻塞后续：Hospital/55-GLB 的 hide/isolate/undo 耗时与堆分配尚未建立正式性能预算；不阻断本次 R1 UX 修正。

## 7. 结论与后续门禁

本修正内部验收 PASS；自然语言“撤回”缺陷闭环最终 GO，未遗留 P0/P1/P2。可创建授权的本地 R1 修正检查点；检查点完成后，仍需用户完成外部手动备份确认，才关闭 R1 并进入下一高风险里程碑。
