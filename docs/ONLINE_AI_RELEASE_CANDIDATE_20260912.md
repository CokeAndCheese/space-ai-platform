# 在线 AI 发布候选 — 2026-09-12

> 当前状态：源码候选已获架构与独立 QA 的 SOURCE GO；最终计数 P2 已核销，总控接收本地发布检查点。本记录不是公网放行。
> 发布方式：用户手动 GitHub push；尚未配置或证明自动部署。

## 候选身份与授权边界

- 仓库分支：`codex/r2-standard-model-package`；验证父提交：`896705773df82e009915b6f2c89cde068836b85d`。
- 18 文件最终源码摘要：`38f229d06024de7e4e7bdc8222326985f603879b42638301a6a05ef741b07337`。定义为路径默认字符串升序的 `[{path,sha256},...]` 经 `JSON.stringify`（无尾换行）再作 SHA-256。下表提供全部输入，报告与治理记录不参与该源码摘要。
- 用户已授权匿名访客在线 AI、固定 MiniMax-M3、Asia/Shanghai 全站 100 次/天，耗尽仅暂停 AI。另已批准生成两枚内部服务令牌及必要的共享网关短暂重建；已说明其他站点连接可能短暂中断，MiniMax 密钥不更换。
- 实际生产修改仍须精确已推送提交、网关协调/CAS、可恢复备份和分层验收。不得代用户 push、force-push、合入 local main、公开其他模型、放宽数据契约、扩大日额或把此发布解释为三平台兼容里程碑。
- 真正的服务端运行配置、模型资产和持久配额不在本源码交付中。没有真实密钥、令牌值或凭据摘要。

## 精确源码文件

| 路径 | SHA-256 |
|---|---|
| `.env.runtime.example` | `dd27d87ebe3ec955e64ffbf1920dc13bf511404b528be629e187be168df019b4` |
| `Dockerfile` | `56182cf20ad829886d59747647d1636fd006790f1ed3eba966616661b7a1aefb` |
| `compose.ai.yml` | `3e9aa081da941ef1fa1e9c7384c7350ea8b2d3f1b00c8e034af4862c5a9cbc1d` |
| `deploy/nginx.ai.conf.template` | `08580479983f9706ae76e7b889418b2288b39344bdba4c852d7202066458c68c` |
| `docs/TENCENT_LIGHTHOUSE_DEPLOYMENT.md` | `a478e279259735a8ec26a210a367f523737f886c566bedbf2e19f2a94bb5800f` |
| `package-lock.json` | `db42586a6e5f7bfd9ce8c102200a639fc14aed748816fca1db1a60edfb8e3453` |
| `package.json` | `9cb4c1d6e1d634c599f17b1587bd4cf4ddcd8333d22b69fa3625435dbfba48f2` |
| `scripts/test-llm-client.mjs` | `769368551b34a6164ee9bb2f6100d15cae90de08c0b983a39300fe764e21f7b3` |
| `scripts/test-llm-proxy.mjs` | `3b1700d9a0988de064943540d05eca4253ec696feadf963dda0f382a1f140f32` |
| `scripts/test-llm-quota.mjs` | `bdcfa246b36ad75d87971b55ebe61a7aef72f2bf8c70188487b697e95f488cde` |
| `scripts/test-online-container-boundary.mjs` | `76816e78bbd1cf690e645751dbf996e8af157b3f507907f4b2b8cb251cd42e30` |
| `scripts/test-online-deployment.mjs` | `2dc8ccc55b06e5528778914bf63352075081cc1bc1a4523f0d291cd2a9e6dcb2` |
| `scripts/test-package-zip64-security.mjs` | `ea99aebeba9dcf0e6c676bbe9615d4b2e57d64619b271f34e3f739360b3ef57f` |
| `server/llm-proxy.mjs` | `ec5968ec315ac7011ba085190a9c4e973e0d4f7df772927f2b864b351396c5a8` |
| `server/llm-quota.mjs` | `e1b1fecda39e9017bd4db39e550cc58b9947139ac71974e255cfa44d578e5a03` |
| `src/ai/parser/llmClient.ts` | `5dba4391af3dafb248ca6a4eeda003c9108d843d963e313839b4bfaba0828011` |
| `src/test/package/packageCloseoutSuite.ts` | `98175845609dec5cfcabdd814984078db189e0031b531108c12c50f9494e9d9d` |
| `src/views/ChatPanel.vue` | `1e3abd88cf69c402233cde774168243b62a776837a0955784c065c31d6569033` |

## 实施范围

固定模型/供应商/生成预算；浏览器只使用项目子路径同源 API。代理执行双域令牌唯一头校验、精确 HTTPS Origin、受控客户端 IP、请求/响应大小与时间上限、全局/单客户端频率及并发限制、流式完成/取消保护、持久 100 次/天原子预占以及错误去敏。

edge 与 proxy 令牌独立且互异。web 不持 edge 的配置、环境或持久副本，但在精确 API 请求内存中接收并透传它，因此 Nginx/web 属于可信计算边界。此方案防普通同机兄弟容器伪造，不声称防已攻陷的 Caddy/web/proxy 或 Docker/root 管理员。网络成员隔离只是纵深防护，不替代双令牌认证。

默认静态 Compose 保持 AI-off/API 404；在线 AI 通过显式 override 启用，不开放每项目主机端口。回滚保留精确 static/AI image ID，使用 no-build/no-pull，不清空配额。依赖修正仅 fflate 0.8.3、postcss 8.5.23、nanoid 3.3.18；Package 测试辅助只修正 owned Uint8Array 类型兼容。

## 主控实际执行结果

全部命令使用无真实环境的隔离导出；既有共享工作区不产生 dist。下表是主控执行，不冒充独立 QA 运行。

全套执行时的源码摘要为 `12b678ec3b504cb0148ee37d5a5772b9deacf3aba707c04c47692a4c6b5ff065`。最终修订仅将 runbook 一处 `passed 11/11:` 校正为 `passed 13/13:`；其余 17 文件与精确 Caddy 配置片段不变。校正后 static 20/20、真实 Caddy 13/13 与 diff 检查再通过，result.json 绑定最终 runbook SHA。临时 verification-summary.json 保留原 12b… 执行身份，不冒充最终摘要上的全套重跑。

| 验证 | 结果 | 证据边界 |
|---|---|---|
| `node scripts/test-llm-proxy.mjs` | 28/28 PASS | 真 proxy 模块、本机假上游 |
| `node scripts/test-llm-quota.mjs` | 17/17 PASS | 自有临时持久文件/并发进程，不是真实云端额度 |
| `node scripts/test-llm-client.mjs` | 8/8 PASS | 浏览器 client 代码的隔离测试 |
| `node scripts/test-package-zip64-security.mjs` | 4/4 PASS | bounded child、v1/v2 fail closed |
| `node scripts/test-online-deployment.mjs` | 20/20 PASS | 静态接线/边界断言 |
| `node scripts/test-online-container-boundary.mjs` | 17/17 PASS | 真 Nginx+真 proxy 源码，假 quota/fetch；无 Caddy/TLS |
| Package/lifecycle/Home/capability 六命令 | 96/96 PASS | v1 35、v2 18、生命周期 13+8、Home 13、capability 9 |
| R1 五测试套件 | 97/97 PASS | topology 10、sidecar 18、legacy lifecycle 27、Quick Action 22、templates 20 |
| R1 其余门禁 | 3 审计、typecheck、build PASS | 原十步骤 10/10；与前行合计 193 应用测试 |
| 独立客户端 Caddy 组件 fixture | 13/13 PASS | 真 Caddy 2.11.4+假后端；无真实 quota/provider/TLS |
| `git diff --check` / `git diff --cached --check` | PASS | 精确 21 路径；18 源码 index blob 与最终摘要一致 |

容器机器结果：共享 sibling DNS 为 ENOTFOUND；已知 IP 上 missing/wrong/repeated 均实际 HTTP 401；独立无正确令牌的可达负客户端三类均 HTTP 401，每项 quota/upstream=0/0。独立正控 HTTP 200，计数=1/1；三个相邻 API 路径为 404 且无额外计数。自身五容器、四网络已清理，无 host ports。

构建产物4个JS共1804422字节，对长key模式、fixture服务令牌和edge字段的定向扫描零命中；18文件仍与导出逐SHA匹配。最终暂存21路径已核对允许清单，两个事实文档只含批准的部署插入hunks；暂存文本的长key/私钥模式零命中、manifest与ssp未暂存。暂存操作前后59个现场文件内容SHA无变化。这是指定模式检查，不宣称完整秘密泄漏证明。

Caddy fixture 从 runbook 提取精确 route/client-IP placeholder/两类日志 filter，仅替换测试上游地址与 HTTP listener。独立客户端没有令牌环境或挂载，转发 IP 严格等于检查所得的客户端网络 IP。13 项涵盖配置验证、运行时占位符、头覆盖、邻路、双日志去敏、SSE 及时首块和取消；自身三容器、一内部网络已清理。

临时复现材料（机器本地，可被系统清理）：

- `/private/tmp/space-platform-release.PC9iuU/candidate-sha256.json`
- `/private/tmp/space-platform-release.PC9iuU/run-final-gates.mjs`
- `/private/tmp/space-platform-release.PC9iuU/verification-summary.json`
- `/private/tmp/space-platform-caddy-evidence.gee58v/check-caddy.mjs` 与 `result.json`
- Caddy 配置片段摘要：`9dd0dc8c2695089c9ef50304e8bf7050cb063dac163f2f8d3f05306c942f87e9`。

## 失败记录与独立验收

- 旧容器 13 项未区分不可达/实际 HTTP，旧 Caddy 11 项客户端与持密后端共容器且没有验证真实 client-IP，不再作为最终精确证据。
- 中间候选 `622028c8…` 出现过时的 Mounts.map 静态匹配和 Compose null 网络成员 truthiness 两个测试接线失败；均已修正并在本候选实际重跑，不把旧失败记为通过。
- 最终三路径由 DevOps 明确交回并关闭排队旧包。技术负责人（`01a02381-9ea7-7560-9b30-538075fdedff`）对 12b… 确认 A/B/C 充分、SOURCE 架构 GO。独立 QA（`01a02381-a3e1-76e3-ae68-0cb2fa3a347d`）对同一摘要给 SOURCE GO，原 A/B 两项 P1 与文档重复 P2 已关闭；仅新增非阻断计数 P2（0/0/1）。计数按建议修正后，QA 在 COUNT-CLOSE 独立复算 18/18 SHA、38f… 新摘要与12b… 反向还原、Caddy 13 项身份，确认 P2 关闭，当前 SOURCE delta 为 0/0/0、SOURCE GO 保留；历史开发工具风险不在该增量归零中。此前 8ae… 的 GO→MODIFY 历史不作为本次放行依据。
- 独立 QA 既有无监听生产 handler 13 项与配置负向 7 项 PASS，只证明 handler/config。其 loopback listen EPERM 属环境阻止，没有进入 socket 断言；不冒充它运行了主控容器或回归。

## 保护与回滚

- 用户 `src/model-manifest.json`：15073 字节，SHA-256 `2ed654ea23f091008e8bd91f2996077c938026ade8183dea972205997bea9fbc`，不暂存/提交/上传。
- 导出及已提交 manifest：`8c9d1b468e4e943225a40cbcff7ec77ae8470410d5f415b6d3bae2e636493818`。
- 本次三路径实现前后，其余 55 个 dirty 路径内容逐 SHA 不变；`src/ssp/**` 无改动；治理/模板既有 hunks 仍保留。
- 既有 local main：`d364477bedf220df07e25b4fd99a9b843961c379`，本次不切换或合入。
- GitHub 当前回滚基线：`896705773df82e009915b6f2c89cde068836b85d`；旧 `61cdaebebad4a9754239384fcc40114fb0c8206f` 已保留于 `codex/pre-lighthouse-20260909`。
- 06:42 UTC 只读服务器核验仍为 8967057、checkout 干净、静态容器 healthy；镜像 `sha256:52c60f980f429b5c178aec8629d4562c41309bb5cf9be3e2600d3d95d10960ec`。运行 env 仅核普通文件/0600/ubuntu 元信息。
- 网关 Caddyfile 摘要 `d1c5c188f555fba33c533974833f2470ed1e47a6524b7159bee7adbd8c8317a4`，compose `eacc4dfdd658c4c410d37bff1f0d374acc9c709735d107bd44781325911203ba`，root data `edd3d5544c6a53201acb74d81b365bdddf96fd32491fff90995618264011e263`；真正变更前必须重新 CAS，不盲目恢复全网关旧备份。
- 历史真实镜像 static/AI 本地 no-build/no-pull 回滚 8 项 PASS 早于 edge-auth 修订，只是回滚方式证据，不是本最终镜像或真实配额/网关回滚证明。

## 尚未完成的公网门禁

真实双令牌生成/分组件持有、Caddy 进程环境与精确生产路由、真实持久额度初始化和一次计额、受控真实 MiniMax 调用、TLS/公网浏览器导入与模型路径、邻路拒绝、现场日志去敏、根索引卡片、既有 15 站点回归及路由级回滚。任何失败保持 AI 关闭，不退回 HTTP、bridge-only 或浏览器 key。

仍保留 >500KiB 构建体积警告。既有 QA 识别的开发工具风险不随本修正自动接受：不得把 Vite/esbuild 开发服务器暴露给不可信网络，不得用 sharp/gltf-transform 压缩链处理不可信资产；brace-expansion 工具链风险仍单列。生产部署仅 Nginx 和独立 Node proxy，不包含这些开发工具。

历史本地浏览器 v1/v2/legacy 可见链路证据不替代此精确候选的公网验收。本记录不证明 local main 或 Studio/Forge/Platform 三端兼容，不构成公开上线完成声明。
