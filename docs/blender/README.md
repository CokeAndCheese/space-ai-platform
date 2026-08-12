# docs/blender/

> **Blender 端工具脚本**, 不是项目代码。

## 为什么放这里?

这些 Python 脚本**只跑在 Blender 里**,**不**被前端 / Node.js / Vite / vue-tsc 引用。

- ✅ 放 `scripts/blender/` 会被项目 vite 配置扫描 (虽然 Python 不编译, 但路径噪声)
- ✅ 放 `docs/blender/` 跟规范文档同级, **明确"工具参考"定位**

## 内容

| 文件 | 用途 |
|---|---|
| `bulk_inject_metadata.py` | 在 Blender 里批量加 sid / renderType / spaceType (按 mesh 名字 + collection 名字猜) |
| `suggest_direction.py` | 算每个 mesh 该放哪个 8 方位 collection (输出分组建议,人工搬) |
| `assign_fire_type.py` | 批量给 FACILITY mesh 填 fireType (11 种消防/安防器材分类) |

## 怎么用

详细用法见每个脚本顶部 docstring, 以及:
[BLENDER_METADATA_GUIDE.md §11](../BLENDER_METADATA_GUIDE.md)

## 跟项目代码的关系

- ❌ **不** 在 `package.json` 注册
- ❌ **不** 在 `src/` 引用
- ❌ **不** 跑 `npm` / `node` 来跑 (Python + Blender 环境)
- ✅ **不** 影响 `vue-tsc --noEmit` / `vite build` / `audit-template-schema`

> 如果未来 Blender 操作员反馈脚本要改, 直接改这里, 不影响项目部署。