# R1 最终验收结论

> 验收日期：2026-08-22
>
> 功能候选提交：`239ad46`
>
> 分支：`codex/r1-generic-spatial-chain`
>
> 状态：内部验收通过，待用户批准关闭

## 1. 最终结论

R1「通用空间链路可验收版」已完成合同范围内研发、自动化门禁、真实浏览器 P0、独立 QA、架构复核和产品范围核对。内部结论为 PASS，没有未关闭的 P0、P1 或 P2；可以提交用户验收。

本结论不代表生产发布。生产 LLM gateway、CI/CD、账号权限、凭据治理、性能预算和线上部署均仍在 R1 非目标或后续里程碑中。

本结论也只证明 Platform 当前 `v3.1 + external topology sidecar v1` 链路。后续同步发现 Studio 当前生产基线为 `3.3-semantic + embedded sspTopology v1`，两者尚未对齐；R1 PASS 不得被解释为 Studio → Platform 跨项目兼容证明。差异见 [`CROSS_PROJECT_DATA_CONTRACT.md`](./CROSS_PROJECT_DATA_CONTRACT.md)。

## 2. 独立签字

### QA工程师-R1终验代理

- 结论：独立 QA PASS，0 个 P0/P1/P2，建议提交用户验收。
- 独立复跑：Topology 10/10、sidecar 18/18、scene lifecycle 27/27、Quick Action 20/20、本地 gate 自测、三组边界审计、类型检查和 `git diff --check` 全部通过。
- 安全结论：Quick Action 固定走注册模板；AI 不直连 SSP；诊断只投影有限 code/phase；门禁在失败、信号和漂移时安全失败，不恢复或覆盖用户文件。
- 浏览器证据：认可 [`R1_BROWSER_P0_REPORT.md`](./R1_BROWSER_P0_REPORT.md) 对 A_1F 成功/清除、A_2F `NO_PATH`、A_3F 缺失/非法 sidecar、模型/页面切换及 console 的覆盖。

### 技术负责人-R1终验代理

- 结论：架构验收 PASS，可提交用户验收。
- 边界结论：sidecar/AssetProof/world-space、场景生命周期、Quick Action、非污染门禁均符合合同；相对 R1 基线没有 `src/ssp/**` 改动，SSP–Template–AI 窄腰未被破坏，范围无漂移。
- 初审提出的流程 P1“独立 QA 结论缺失”已由上述 QA PASS 关闭；格式 P2“里程碑文档行尾空格”已修正并通过 `git diff --check`。

### space AI platform产品经理-项目总控

- 范围核对：R1 只交付通用 sidecar → world-space graph、Three.js 路线、受控触发、非污染本地验证和浏览器 P0；未扩张到生产后端、部署、账户权限、完整 Template Phase 2 或 GitHub。
- 资产与源码保护：未修改 `src/ssp/**`；临时非法 A_3F sidecar 已移除；用户 `src/model-manifest.json` 始终排除于 staged 与 commit。
- 发布建议：批准关闭 R1；随后按既定轻量 Git 流程创建本地里程碑记录，并由用户完成外部手动备份。

## 3. 合同验收映射

| 合同门槛 | 证据 | 结论 |
|---|---|---|
| 两个独立 fixture，非医院硬编码 | rotated single-root、multi-root cross-layer 契约 fixture；A_1F/A_2F 正式浏览器 sidecar | PASS |
| node/edge/connector/blocker、世界坐标 | sidecar 18/18，Topology 10/10 | PASS |
| 有路、无路、非法输入、跨层、资源清理 | sidecar、lifecycle、Quick Action 专项负向回归 | PASS |
| 受控触发到 Three.js 路线闭环 | 真实 Runtime + SSP 集成测试；A_1F 浏览器路线 | PASS |
| AI/template/topology 边界和类型 | 三组审计与 TypeScript 检查 | PASS |
| 非污染本地生产构建 | `verify:r1` 10/10；manifest 与完整 porcelain 前后不变 | PASS |
| 浏览器 P0 | [`R1_BROWSER_P0_REPORT.md`](./R1_BROWSER_P0_REPORT.md) | PASS |
| 独立 QA、架构、产品范围 | 本文件三方结论 | PASS |

## 3A. 2026-08-27 可见性 UX 修正版补充验收

用户在原候选版待关闭期间批准取消 hide 原生确认并新增一步精确可见性撤回。该修正现已完成：hide/show/isolate 共用一个最新事务；“全部显示”仍是独立全局恢复；模型切换或重载使旧撤回失效；没有增加多步撤回或 redo，也没有修改 `src/ssp/**`。

补充验收为 PASS：Template Runtime 15/15、真实浏览器 hide/show/isolate/undo/全部显示/模型切换、独立正确性/复用/性能复核以及 `verify:r1` 10/10 全部通过。manifest 与完整 Git porcelain 在 gate 前后保持不变。详细证据见 [`R1_VISIBILITY_UNDO_REPORT.md`](./R1_VISIBILITY_UNDO_REPORT.md)。

本补充结论替换“原候选证据不覆盖可见性 UX 修正”的临时限制；R1 当前重新具备本地检查点和用户关闭条件。

## 4. 不阻断 R1 的剩余风险

- A_1F/A_2F 路线数据用于证明通用链路，尚不是生产级走廊中心线测绘。
- 路线 overlay 以可见性优先，会透过墙体或楼板。
- 尚未建立浏览器堆/GPU、低端设备和大场景性能预算；生产构建仍有大 chunk 警告。
- R1 没有生产 LLM 服务、CI/CD、凭据治理、账号权限或部署能力；不得将本地验收等同于生产可发布。
- 项目暂停 GitHub，用户完成本地里程碑外部手动备份前，不应进入下一个高风险里程碑。
- Space Model Studio 与 Platform 的当前机器契约未对齐；该差异不推翻 R1 的 Platform 内部证据，但阻断跨项目兼容发布声明，需由用户另行批准收敛方案。

## 5. 待用户决策

唯一待决事项：是否批准关闭 R1。

批准后，产品经理将按既定授权完成关闭记录、本地里程碑 Git 操作和临时终验代理撤销，并提示用户执行包含源码、Git 元数据和模型资产的外部手动备份。用户确认备份前，不进入下一个高风险里程碑。
