# Standard Model Package v1/v2 T/RF — Platform 消费端独立验收

> 日期：2026-09-04
>
> 结论：GO，仅限 Platform 任务分支机器技术封版；P0/P1/P2 = `0/0/0`
>
> 非结论：不是发布批准、用户兼容里程碑、三端兼容或 local `main` 集成结论

## 1. 验证基线与保护现场

- 仓库：`/Users/mac/Documents/Codex/space AI platform`
- 分支：`codex/r2-standard-model-package`
- 验证基线 HEAD：`4ca8645bffc524d78e606eed6abfe24da608dda2`
- local `main`：`d364477bedf220df07e25b4fd99a9b843961c379`；它是任务分支基线，但不包含本候选。
- 验收前后 staging 均为空；`src/ssp/**` 在工作区及 `main..HEAD` 均无差异。
- 受保护的 `src/model-manifest.json` 为 `15073` bytes，SHA-256 `2ed654ea23f091008e8bd91f2996077c938026ade8183dea972205997bea9fbc`，验收前后不变。
- 完整 porcelain 原始字节摘要为 SHA-256 `0a9f6e654f6a2a0d7d2e5adb3c900f45149a3949de744e269df35012153feb17`，验收前后不变；现有部署/LLM proxy 与未跟踪模板均未写入、暂存或混入。

## 2. 三平台角色与非消费者边界

- Standard Model Package v1/v2：Studio 是 producer 与 authority-fixture owner；Platform 是显式 consumer；Forge 非消费者。
- Studio metadata-free 单层 Source GLB naming authority：`docs/AI_SOURCE_GLB_NAMING_SPEC_V1.md`，SHA-256 `33150f24fae21f7c2e15a9f804bb9067c9b75200cd089dce4703355c493fe679`。Platform 不消费该 authoring authority；该限定 authority 不替换、迁移或重定义 Forge 自身 SHA 前缀 `8bdf440a` 的产品 authority。
- Studio Building Source GLB authority：`docs/AI_BUILDING_SOURCE_GLB_SPEC_V1.md`，SHA-256 `c41dedc540037cfadbae828e82da4f170a97732e7a96d2ff14744ef75e4446ae`；权威 `Building.glb` 为 `1024` bytes，SHA-256 `86244b9a40f75e11397cf8ebc65dc0509ffb0337eece3c2a8ba2e1d32a04b864`。Platform 非消费者。
- Studio Building Source Bundle 1.0 authority：`docs/AI_BUILDING_SOURCE_BUNDLE_SPEC_V1.md`，SHA-256 `32944bb4206d5e09f449d70fcfdd6cd67d510a9e1ed9a202b9b7442da24e1e41`；fixture ZIP SHA-256 `9f75a9502847fd2caea7a5b29d0d44f3763ffbe34953ae79f7bf2c4d7c3f0964`，index SHA-256 `40187738f3f31f79255b04bd73ec6cf66a3d3758c59dd32848ad0a83bdb89018`。Platform 非消费者，不提供 fallback。

## 3. Package 与 T/RF exact vectors

| 向量 | bytes | SHA-256 / revision | 结果 |
|---|---:|---|---|
| v1 baseline success ZIP | 21956 | `d0662cdfb95656def2d553a727ddeb88a3b946c9f2ecbefe2558fd83723423b0` | PASS |
| v1 baseline index | 2869 | `1d1200d064b39997457acac9beac9b8b003e1eeb17894fb118010801488d7b2a` | PASS |
| v2 baseline success ZIP | 8310 | `be0b7734ebbb3effb1f220f601d047d69dcf849c5d16bf7fdc1cd54f4f90e0c7` | PASS |
| v2 baseline index | 2070 | `c559d47222f6d7d61160d74676885e61ea0c0a462f0f67d6c7e5cdd2cc78a91c` | PASS |
| T/RF authority index | 4235 | `085a3a08f54fb7f02ee9ef6e16242e47d7741bb5821fdc95869df10ef6cc4485` | Studio source ↔ Platform mirror `cmp=0`；13/13 entries 匹配 |
| T/RF v1 ZIP | 38058 | SHA `1080cc8717eed98d18eb7a1c8708596ac43c90a7181c28fb55ac5a69df3b3e76`；package/sidecar revision `482a129ffeef87de842d86ecb62e9e2d2f693ebcc0ae194543ab6e82c7f142bb` | Studio source ↔ Platform mirror `cmp=0` |
| T/RF v2 ZIP | 16419 | SHA `a07fe215f0c878d407378d033328f8ad7d3602b94c89701c2266896ac41ef77c`；canonical revision `b89bdf4c02f7c99182483a3f5119a4ed10141c11889108108bc47cf260f7c8d4` | Studio source ↔ Platform mirror `cmp=0` |

v1 保持 strict topology sidecar v1，embedded topology 不作为 Platform fallback。v2 保持显式 topology `ABSENT`、零 topology entry/embedded bytes，并投影 `TOPOLOGY_UNAVAILABLE / PACKAGE_DECLARED_ABSENT`，不是 v1 降级或 silent fallback。

## 4. Metadata 3.3 nullable requiredness

- TOWER/ROOF：`building` 键存在且为非空字符串；`level` 键存在，值为 `null` 或既有有限整数。
- FLOOR/BASEMENT/FACILITY：`building` 为非空字符串，`level` 为有限整数。
- LANDSCAPE_TERRAIN/LANDSCAPE_FACADE：`building: null`、`level: null`。
- Manifest、默认 scene 与每个 mesh node 的 `floorName/building/level/floorType` 必须逐字段一致；失败向量 fail closed。
- 不从 elevation、文件名、楼层顺序或 floor type 推导、补算、归一化 level/order。v1 的 `A_T`/`A_RF` embedded/sidecar layer 无 `order`；`A_5F`/`A_6F` 保留 `5`/`6`。
- 精确 `floorName`/`floorType` 查询可用于 nullable 特殊层；整数 level 查询不得匹配 `null`。

## 5. 自动门禁

- parser：v1 `35/35`，v2 `18/18`。
- lifecycle：v1 `13/13`，v2 `8/8`。
- Home package import `13/13`；topology capability gate `9/9`；Template/query `20/20`。
- topology sidecar `18/18`；topology core `10/10`；legacy scene lifecycle `27/27`；Quick Action `22/22`。
- `npm run verify:r1` 为 `10/10`：上述核心回归、三项边界审计、TypeScript 与生产构建全部 PASS。Vite 仅保留既有大于 500 kB chunk 警告。
- 独立 QA 复核结论为 GO，P0/P1/P2 = `0/0/0`；保护现场摘要不变。

## 6. 真实浏览器链路

从 Studio 权威仓库路径直接选择修订后的 v1/v2 T/RF ZIP，在 Platform 本地 Vite 页面完成同会话导入与切换：

- v1：4 floors；revision `482a129ffeef87de842d86ecb62e9e2d2f693ebcc0ae194543ab6e82c7f142bb`；Graph ready；`A_T`/`A_RF` 可作为 endpoint；控制台 error `0`。
- v2：4 floors；revision `b89bdf4c02f7c99182483a3f5119a4ed10141c11889108108bc47cf260f7c8d4`；Scene/Metadata ready；无 graph；稳定显示 `TOPOLOGY_UNAVAILABLE / PACKAGE_DECLARED_ABSENT`；Quick Action 不可用；控制台 error `0`。
- 查询“飞到塔楼”只命中 `WALL_A_T_01`、`SPACE_A_T_OFFICE_01`；“飞到屋顶”只命中 `WALL_A_RF_01`、`SPACE_A_RF_OFFICE_01`。
- 两次导入各出现 4 条相同 Three GLTFLoader warning，均为权威最小 fixture 缺少 POSITION min/max；没有 error，也不改变契约判定。

这关闭了 nullable 修订后的 Platform 消费端真实浏览器门禁；它不替代 Forge→Studio、Bundle A/B/C、Studio producer/final-reparse 等其他产品证据，也不是三端联合验收结论。

## 7. 回滚与剩余门禁

- 本报告不改 reader、fixture、`src/ssp/**` 或运行时状态；文档提交可由其单一 local commit 回退。
- v1/v2 运行时选择不建立 revision registry；回滚由用户显式重新导入。v2 停发、停收、存量迁移及 reader 删除必须 Studio/Platform 协同，并按既定门禁另获用户批准。
- Platform local `main` 尚未包含任务分支候选；本轮禁止切换分支或快进 `main`。
- Platform 可称“任务分支机器技术封版”。在 Forge、Studio、Platform 各自具备精确 HEAD/SHA/自动门禁/真实链路、分别取得用户兼容里程碑、集成各自 local `main` 且集成后门禁通过前，只能称“三平台兼容候选”，不得宣称三平台封版、发布或 `main` 兼容。
