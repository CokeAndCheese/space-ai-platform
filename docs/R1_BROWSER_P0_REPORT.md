# R1 浏览器 P0 验收报告

> 验收日期：2026-08-22
>
> 验收分支：`codex/r1-generic-spatial-chain`
>
> 验收环境：Codex 应用内浏览器，`1280 × 720`；Vite `127.0.0.1:5173`
>
> 执行人：`space AI platform产品经理-项目总控`
>
> 结论：PASS

## 1. 验收范围

本轮按 [`R1_MILESTONE.md`](./R1_MILESTONE.md) 的浏览器 P0 标准，验证真实 GLB 加载、显式端点选择、路线显示与清除、无路径、模型和页面切换、缺失/非法 sidecar 失败反馈，以及浏览器控制台状态。

浏览器验收只使用 Quick Action 已登记的 `findPath → renderRoute → removeRoute` 链路；未接入 LLM、未直接调用 SSP、未修改 `src/ssp/**`，也未写入或暂存用户的 `src/model-manifest.json`。

## 2. 验收矩阵

| 编号 | 操作 | 预期 | 实际证据 | 结果 |
|---|---|---|---|---|
| B-P0-01 | 选择真实模型 `A_1F` | 模型可见；会话 ready；端点不自动猜测 | 模型正常显示；Graph 为 `scene/a1f/explicit-route`；起点和终点均保持“请选择”且执行按钮禁用 | PASS |
| B-P0-02 | 显式选择 `scene/a1f/node/start` → `scene/a1f/node/goal` 并执行 | 经受控模板查路并显示路线 | DOM 返回 `ROUTE_RENDERED`；长度/权重均为 `57.02`；Route 为 `topology_route_1` | PASS |
| B-P0-03 | 目视检查 A_1F 路线 | 路线与流动标记在建筑模型上持续可辨识 | 橙色路线及浅色流动标记完整覆盖在模型上方；修正为 overlay 后未再被楼板/墙体大面积遮挡 | PASS |
| B-P0-04 | 点击“清除路线” | 只清除当前受控路线 | Route ID 与成功结果消失；清除按钮恢复禁用；模型保持显示 | PASS |
| B-P0-05 | 选择 `A_2F`，显式选择 start → goal 并执行 | blocker 阻断唯一通路；不渲染路线 | Graph 为 `scene/a2f/explicit-blocked-route`；DOM 返回 `NO_PATH` 和“当前起点与终点之间没有可用路径”；无 Route ID，清除按钮禁用 | PASS |
| B-P0-06 | 选择无 sidecar 的真实模型 `A_3F` | 模型保留；拓扑不可用；反馈可诊断且控件禁用 | 模型正常显示；Graph 为 `—`；状态为 `SIDECAR_NOT_FOUND / DISCOVER`；两个端点及执行/清除按钮均禁用 | PASS |
| B-P0-07 | 临时向 `A_3F` 提供非法 JSON sidecar 后重选模型 | 模型保留；解析失败；不暴露底层内容 | 模型正常显示；状态为 `SIDECAR_JSON_INVALID / PARSE`；Graph 为空且控件禁用；临时文件随后移除，重选后恢复 `SIDECAR_NOT_FOUND / DISCOVER` | PASS |
| B-P0-08 | A_1F 有活动路线时进入 Sandbox，再返回 Home | 页面切换必须回收路线和会话状态 | Sandbox 不提供 Quick Action；返回 Home 后重新建立 A_1F graph，端点重置，旧 Route ID 消失，执行/清除按钮禁用 | PASS |
| B-P0-09 | 快速执行 A_1F → A_2F → A_1F | 最终场景胜出，不出现陈旧 graph/路线/结果 | 最终只显示 A_1F 模型和 `scene/a1f/explicit-route`；端点为空，无陈旧 Route ID 或结果 | PASS |
| B-P0-10 | 检查本轮浏览器日志 | 无运行错误 | 未发现 error；仅发现整院 55 GLB 初次适配视角时已有的相机最大距离钳制 warning，单楼层路径链路无新增 warning/error | PASS |

## 3. 视觉与 DOM 证据摘要

- A_1F 成功态同时可见真实模型、橙色路线、流动标记、`ROUTE_RENDERED`、`57.02` 和精确 Route ID。
- A_3F 缺失及非法 sidecar 两种失败态均保留真实模型，右侧 Quick Action 显示结构化代码/阶段，端点与操作按钮保持禁用。
- 本轮在活动浏览器会话中分别截取并目视检查 A_1F 成功态、A_3F 缺失态和 A_3F 非法 JSON 态；不向仓库加入临时二进制截图，持久化证据以本报告的操作、DOM 值和结果矩阵为准。

## 4. 自动化与构建交叉验证

浏览器 P0 完成后执行 `npm run verify:r1`，结果为：

- Topology 10/10；sidecar 18/18；场景生命周期 27/27；Quick Action 20/20。
- topology、template、AI 三组边界审计通过；TypeScript 类型检查通过；Vite 生产构建通过。
- 用户 manifest 前后 SHA-256 均为 `2ed654ea23f091008e8bd91f2996077c938026ade8183dea972205997bea9fbc`。
- 完整 Git porcelain 前后摘要一致，门禁未恢复、覆盖、暂存或清理用户文件。

## 5. 结论与剩余风险

R1 规定的浏览器 P0 已全部通过，没有浏览器验收阻断缺陷。

以下为后续风险，不阻断 R1：

- `A_1F` / `A_2F` sidecar 是用于证明通用链路的显式验收数据；其折线仍是示范性路径，不代表已完成生产级走廊中心线测绘与校准。
- overlay 路线以“始终可见”为优先，会透过墙体或楼板显示；未来可按产品场景增加遮挡模式或双层样式，但不得恢复为当前视角下大面积不可见。
- 本轮验证了 55 GLB 场景可加载、快速切换和语义清理，但没有建立浏览器堆/GPU 指标预算；内存、低端设备和大场景性能基线应进入后续发布基础里程碑。
- 生产构建仍有大于 500 kB 的 chunk 警告；不影响本地 R1 功能验收，需在发布性能预算中关闭。
