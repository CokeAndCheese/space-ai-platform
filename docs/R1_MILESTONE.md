# R1 里程碑合同 — 通用空间链路可验收版

> 批准日期：2026-08-21  
> 状态：已批准，研发中  
> 决策人：用户 / 项目决策人  
> 负责人：`space AI platform产品经理-项目总控`  
> 活动分支：`codex/r1-generic-spatial-chain`

## 1. 产品目标

让符合公开 GLB 基础元数据与配套 topology sidecar 契约的场景，不依赖医院项目硬编码，即可生成 Three.js 世界坐标中的通用拓扑图；用户通过 Quick Action 或受控 AI 模板触发寻路后，可以在 3D 场景中看到并管理路线。该链路必须能够在本地重复构建和验收，且不得污染用户已有的 `src/model-manifest.json` 修改。

## 2. R1 范围

1. 定义并实现通用“GLB 基础 metadata + 外置 topology sidecar v1”→ world-space topology graph 适配器。R1 契约见 [`R1_TOPOLOGY_SIDECAR_V1.md`](./R1_TOPOLOGY_SIDECAR_V1.md)。
2. 明确 node、edge、connector、blocker 的输入责任和错误报告；Topology 核心继续只消费显式通用图数据。
3. 将适配结果接入现有 Three.js / SSP context，并完成路线渲染与生命周期回收。
4. 通过 Quick Action 或 Registry 明确开放的模板触发至少一条完整寻路链路；AI 不得直接调用 SSP。
5. 建立不会生成、覆盖或暂存用户 manifest 修改的本地验收门禁。
6. 完成 R1 关键浏览器路径验收、架构复核和独立 QA 结论。

## 3. 非目标

- 生产 LLM gateway、CI/CD、线上部署、账号权限和服务端持久化。
- 完整 Template Phase 2 或全部 v2 模板迁移；R1 仅实现链路所需的最小受控模板能力。
- 在 Topology 核心中解释医院、楼梯、消防设施等行业语义。
- 自动推断任意缺失数据；输入不满足契约时必须返回可诊断错误。
- GitHub、远程分支、PR、push、生产发布或凭据处理。

## 4. 产品验收标准

R1 只有同时满足以下条件才可提交用户验收：

- 至少两个相互独立的模型/sidecar fixture 证明适配器不是医院单场景硬编码。
- 输出节点、边、跨层 connector 和 blocker 均为显式、可校验的通用数据；世界坐标变换正确。
- 有路径、无路径、非法 metadata、跨层和资源清理场景均有自动化证据。
- Quick Action 或受控模板能够完成“触发 → 规划 → Topology → Three.js 路线显示”的闭环。
- AI/template boundary、topology boundary、类型检查和相关回归全部通过。
- 本地生产构建可以重复执行，执行前后用户拥有的 `src/model-manifest.json` 内容与工作区状态保持不变。
- 浏览器 P0 验收覆盖模型加载、触发寻路、路线显示/清除、模型切换和失败反馈。
- 技术负责人完成边界复核，QA 给出独立验收结论，产品经理确认范围没有漂移。

## 5. 工作包与写入队列

单工作区只允许一个实现任务写入。只读方案评审和 QA 设计可以并行。

| 顺序 | 工作包 | 负责人 | 主要交付 | 状态 |
|---|---|---|---|---|
| 0 | R1 合同、接口边界与验收矩阵 | `space AI platform产品经理-项目总控`、`技术负责人-架构与边界`、`QA工程师-质量与安全` | 本合同、sidecar v1 契约、测试矩阵 | 已完成 |
| 1 | 通用 sidecar → graph 适配器与契约测试 | `空间数据工程师-Topology适配` | 适配器、fixture、错误模型、单元/契约测试 | 已完成 |
| 2 | Three.js 场景接入与路线生命周期 | `前端工程师-Three.js体验` | AssetProof、原子建图、场景集成、交互与资源回收 | 已完成 |
| 3 | 受控模板 / Quick Action 链路 | `AI工程师-Template Runtime` | Registry 模板与触发闭环 | 已完成 |
| 4 | 非污染构建与本地验收入口 | `平台工程师-后端与DevOps` | 本地 gate、构建状态保护与运行说明 | 待开始 |
| 5 | 浏览器 P0、回归与安全验收 | `QA工程师-质量与安全` | 独立报告、缺陷结论、发布建议 | 待开始 |
| 6 | 架构复核与产品验收 | `技术负责人-架构与边界`、`space AI platform产品经理-项目总控` | 边界结论、范围核对、里程碑汇报 | 待开始 |

### WP2 检查点（2026-08-22）

- 视觉模型加载与 topology proof 已解耦：proof 不可用时保留可正常显示的模型，但不签发 proof、不创建不可信 graph。
- 多资产场景保持成员级容错；sidecar 只对其显式引用资产要求完整加载与可信 proof，未引用的装饰资产失败不阻断合法图。
- 同响应字节缓存租约、URL 授权、原子建图、可信 graph ID 补偿、A→B 失效和“路线 → graph → legacy topology → 模型”清理顺序已实现。
- 场景生命周期专项回归 27/27、sidecar 18/18、Topology 10/10、边界审计与类型检查通过；独立三视角复审为 0 个 P0/P1，发现的 1 个 P2 公共导出面问题已关闭。
- 真实浏览器中的 GLTFLoader/THREE.Cache、55-GLB 内存峰值、快速切换与 GPU 释放仍属于 WP5 浏览器 P0，不在本检查点内提前宣称通过。

### WP3 检查点（2026-08-22）

- ChatPanel 已提供只接受当前 ready topology session 显式节点选择的路径 Quick Action；起点和终点默认均为空，不根据节点顺序、kind 或 subtype 自动猜测。
- 业务链路只通过注册的 `findPath`、`renderRoute`、`removeRoute` 模板执行，模板 ID、执行选项、路线样式与参数形状均固定；不直连 SSP，不经过 LLM、Intent 或 Planner。
- 本地 operation token、场景 epoch、状态、graph ID 与端点快照共同阻断陈旧结果；同 graph ID 重载、清除竞态、组件卸载和迟到渲染均执行精确 route ID 补偿。
- path receipt 与 route ID 均绑定同 facade 的签发记录；未经签发的路径或 route ID 在进入 Template Runtime 前被拒绝，模板异常和畸形输出只投影为有限、稳定的 UI 错误。
- Quick Action 专项回归 19/19，其中包含真实注册 Template Runtime + SSP context 的 `findPath → renderRoute → removeRoute` 集成；生命周期 27/27、sidecar 18/18、Topology 10/10、模板/AI/topology 边界审计、类型检查和 diff 检查通过。
- 正确性、安全/边界、可维护性/UI 三视角独立复审均无 P0/P1；发现的 2 个 P2（route ID 所有权、真实 Runtime 集成缺口）均已修复并由原审查者关闭。ChatPanel DOM、Home↔Sandbox 清理及真实 GPU 释放仍留给 WP5 浏览器 P0。

## 6. 强制边界

- `src/model-manifest.json` 始终属于用户；不得覆盖、暂存或提交。
- 修改 `src/ssp/**` 前，必须由技术负责人给出范围、影响和验证方案，并由产品经理明确授权；优先把行业/模型适配留在 SSP 外。
- AI 只能调用 Registry 注册模板，不能直接调用原始 SSP 方法。
- 同一时刻只有一个代码写入负责人；交接前记录修改文件、验证结果和工作区状态。
- 所有 Git 操作仅限本地，并使用精确路径暂存。

## 7. 里程碑关闭

全部验收通过后，产品经理提交用户验收。用户批准关闭 R1 后，创建本地里程碑 commit；随后由用户完成包含源码、Git 元数据和 `public/models/` 资产的外部手动备份。用户确认备份完成前，不进入下一个高风险里程碑。
