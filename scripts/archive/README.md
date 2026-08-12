# scripts/archive/

> 一次性 fix 脚本,已用完。保留以备审查 / 历史追溯,**不要在新流程里跑**。

## 来源

这些脚本都是在 **2026-07 阶段 1-2** 的"模板迁移 / soonspace → ssp 改造"期间写的一次性迁移工具。

每个脚本的标题头注释了它的具体目的。

## 名单

| 脚本 | 用途 | 何时跑的 |
|---|---|---|
| `dedupe-template-ids.mjs` | 跨 subcategory 重名 id 加前缀消歧 | 阶段 1 整理 |
| `fix-combo-steps.mjs` | 修复 combo 模板的 step 字段指向不存在的模板 | 阶段 1 整理 |
| `fix-placeholder-code.mjs` | 修 normalize-placeholders 的 code/example bug | 阶段 1 整理 |
| `fix-template-paths.mjs` | 把模板路径从 `core-api/` 改成 `ssp_templates/` | 阶段 1 重命名 |
| `flatten-to-subdirs.mjs` | 把扁平结构 (`core-api.foo.json`) 改成目录式 (`core-api/foo.json`) | 阶段 1 整理 |
| `normalize-placeholders.mjs` | 占位模板规范化 (`status: placeholder` + TODO code) | 阶段 1 整理 |
| `normalize-templates.mjs` | 模板 schema 标准化(intent / signature / params) | 阶段 1 整理 |
| `rename-template-ids.mjs` | id 重命名 + 文件重命名 + 跨引用更新 | 阶段 1 重命名 |
| `strip-bad-api-refs.mjs` | 清除模板 code 里引用不存在的 API | 阶段 1 整理 |
| `translate-templates.mjs` | 把 soonspace 风格 API 翻译成 ssp-shim 风格 | 阶段 1 迁移 |
| `test-ssp.mjs` | 浏览器 console 一次性测试脚本 | 阶段 1 验收 |

## 当前可用的工具

长期工具留在 `scripts/` 根目录:

| 脚本 | npm script |
|---|---|
| `list-models.mjs` | `npm run list-models` (auto-run on `predev` / `prebuild`) |
| `compress-model.mjs` | `npm run compress` |
| `validate-metadata.mjs` | `npm run validate-metadata` |
| `inject-scene-name.mjs` | `npm run inject-scene-name` |
| `auto-fill.mjs` | `npm run auto-fill` |
| `audit-template-schema.mjs` | `npm run audit:templates` (见下面) |

## 怎么跑 archive 里的脚本

```bash
# 单次跑(用 node, 因为是 .mjs)
node scripts/archive/normalize-templates.mjs
```

不需要从 package.json 引用,直接 node 即可。

## 重新需要时

如果你想重新跑某个归档脚本,确认它**幂等**(大部分是),不会破坏当前模板。跑前最好 `git status` 一下,有 diff 再决定是否 commit。