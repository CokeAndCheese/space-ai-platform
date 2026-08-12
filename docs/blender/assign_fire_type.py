#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
assign_fire_type.py — 批量给 FACILITY mesh 填 fireType

⚠️ 放在 docs/blender/, 不挂项目代码, 不被 vue-tsc / vite 扫到。

用途:
  选中所有 FACILITY mesh, 然后跑这个脚本 → 按 mesh.name 关键词猜测 fireType,
  写到 Custom Property (renderType=FACILITY + fireType=<11 种之一>)

# === 使用前请读这部分 ===

## Blender 闪退防御
  本脚本做了防御性处理:
  - 每个 mesh 单独 try/except, 单个失败不退出
  - obj 类型 / 名字检查 (避免 None / 空名)
  - Custom Property setter 用安全赋值 (避免 readonly 错)
  - 进度逐个打印, 不会卡住

## 用法 (Blender GUI)

  1. Blender 打开 A_1F.glb
  2. Scripting 工作区
  3. 打开这个脚本 (Open → 选文件)
  4. **可选**: 改头部 OVERRIDE (强制指定某些 mesh 的 fireType)
  5. 点 ▶ Run Script
  6. 看 Blender 底部 console (Window → Toggle System Console)
     Windows: 也可以看脚本工作区下方的 log

## 用法 (命令行, 推荐用于 debug)

  你的机器上 Blender 闪退, 可能是 GUI 渲染问题. 试命令行模式:

  blender --background path/to/A_1F.blb \
    --python docs/blender/assign_fire_type.py \
    -- --input path/to/A_1F.glb

  这样不打开 GUI, 所有输出到 terminal, 闪退也能看到 stack trace.

## 故障排查

  如果还是闪退:
  1. 看 Blender 版本: Help → About (要求 >= 3.0)
  2. 试 --background 模式
  3. 把脚本内容粘贴到 Blender Python Console 一行行跑
  4. 联系开发者
"""

import bpy
import sys
import traceback

# ============================================================================
# CONFIG
# ============================================================================

# 强制覆盖某些 mesh 的 fireType (留空 = 全自动)
# 格式: { 'MESH_NAME': 'FIRE_TYPE' }
OVERRIDE = {
    # 'FACILITY1': 'HYDRANT',
    # 'FACILITY2': 'SMOKE_DETECTOR',
}

# ============================================================================
# fireType 关键词 (跟 bulk_inject_metadata.py 保持一致)
# ============================================================================

FIRE_TYPE_RULES = {
    'HYDRANT':         ['hydrant', '消火栓', 'fire_hydrant'],
    'SMOKE_DETECTOR':  ['smoke', 'smoke_detector', '烟感', '烟雾'],
    'SPRINKLER':       ['sprinkler', '喷淋', '喷头', 'sprink'],
    'EXTINGUISHER':    ['extinguisher', '灭火器', 'fire_ext'],
    'EMERGENCY_LIGHT': ['emergency', 'emergency_light', '应急', '应急灯'],
    'EXIT_SIGN':       ['exit_sign', '出口', '疏散指示', 'exit'],
    'BREAK_GLASS':     ['break_glass', '破玻', '手动报警'],
    'ALARM_BELL':      ['alarm', 'alarm_bell', '警铃', '火警铃'],
    'FIRE_HOSE':       ['fire_hose', '水带'],
    'FIRE_DOOR':       ['fire_door', '防火门', '防火卷帘'],
}
FIRE_TYPE_PRIORITY = list(FIRE_TYPE_RULES.keys())


def log(msg):
    """统一 log"""
    print(f'[assign-fireType] {msg}', flush=True)


def match_fire_type(mesh_name):
    """按 mesh.name 匹配 fireType. 返回 fireType 或 None."""
    if not mesh_name or not isinstance(mesh_name, str):
        return None
    try:
        name_lower = mesh_name.lower()
        for ft in FIRE_TYPE_PRIORITY:
            for kw in FIRE_TYPE_RULES[ft]:
                if isinstance(kw, str) and kw.lower() in name_lower:
                    return ft
        return None
    except Exception:
        return None


def safe_set_custom_prop(obj, key, value):
    """安全地给 obj 设 Custom Property, 失败不抛"""
    try:
        if obj is None or not hasattr(obj, '__setitem__'):
            return False
        # 检查 key 是否合法 (不能含特殊字符)
        if not key or not isinstance(key, str):
            return False
        obj[key] = value
        return True
    except Exception as e:
        log(f'    ⚠️ 设 {key} 失败: {e}')
        return False


def assign_fire_type(obj, ft):
    """给 mesh 加 renderType + fireType Custom Property"""
    safe_set_custom_prop(obj, 'renderType', 'FACILITY')
    safe_set_custom_prop(obj, 'fireType', ft)
    safe_set_custom_prop(obj, 'renderTypeConfidence', 'high')


def is_valid_mesh(obj):
    """检查 obj 是否是合法的 mesh"""
    try:
        return (
            obj is not None
            and hasattr(obj, 'type')
            and obj.type == 'MESH'
            and hasattr(obj, 'name')
            and isinstance(obj.name, str)
            and len(obj.name) > 0
        )
    except Exception:
        return False


def collect_facility_meshes():
    """收集所有 FACILITY mesh (优先用选中的, 否则用 FACILITY collection)"""
    result = []

    # 方式 A: 用选中的
    try:
        selected = list(bpy.context.selected_objects or [])
        sel_facility = [o for o in selected if is_valid_mesh(o)]
        if sel_facility:
            return sel_facility, 'selected'
    except Exception as e:
        log(f'⚠️ 读选中失败: {e}')

    # 方式 B: 找 collection "FACILITY"
    try:
        for c in bpy.data.collections:
            try:
                if c.name and c.name.upper() == 'FACILITY':
                    for o in c.all_objects:
                        if is_valid_mesh(o):
                            result.append(o)
                    return result, f'collection "{c.name}"'
            except Exception as e:
                log(f'⚠️ 读 collection 失败: {e}')
                continue
    except Exception as e:
        log(f'⚠️ 遍历 collections 失败: {e}')

    return result, None


def main():
    log('═══════════════════════════════════════════════')
    log(f'assign_fire_type.py 启动 (Blender {bpy.app.version_string})')
    log('═══════════════════════════════════════════════')

    # 1. 收集 mesh
    try:
        facility_objs, source = collect_facility_meshes()
    except Exception as e:
        log(f'❌ 收集 mesh 失败: {e}')
        log(traceback.format_exc())
        return 1

    if not facility_objs:
        log('❌ 没找到 FACILITY mesh')
        log('   请: 1) 选中所有 FACILITY mesh, 或 2) 建 collection "FACILITY"')
        return 1

    log(f'找到 {len(facility_objs)} 个 mesh (来源: {source})')

    # 2. 逐个匹配 + 分配 (每个单独 try/except)
    auto_count = 0
    override_count = 0
    manual_count = 0
    error_count = 0

    for i, obj in enumerate(facility_objs, 1):
        if not is_valid_mesh(obj):
            log(f'  [{i}/{len(facility_objs)}] ⚠️ 无效 mesh (跳过)')
            error_count += 1
            continue

        name = obj.name

        try:
            if name in OVERRIDE:
                ft = OVERRIDE[name]
                assign_fire_type(obj, ft)
                log(f'  [{i}/{len(facility_objs)}] {name:30} → {ft:20} (override)')
                override_count += 1
            else:
                ft = match_fire_type(name)
                if ft:
                    assign_fire_type(obj, ft)
                    log(f'  [{i}/{len(facility_objs)}] {name:30} → {ft:20} (auto)')
                    auto_count += 1
                else:
                    log(f'  [{i}/{len(facility_objs)}] {name:30} → {"UNKNOWN":20} ⚠️ 需要人工填 fireType')
                    manual_count += 1
        except Exception as e:
            log(f'  [{i}/{len(facility_objs)}] ❌ {name}: {e}')
            error_count += 1
            log(traceback.format_exc())

    # 3. 总结
    log('')
    log('═══════════════════════════════════════════════')
    log('总结')
    log('═══════════════════════════════════════════════')
    log(f'auto:     {auto_count}')
    log(f'override: {override_count}')
    log(f'manual:   {manual_count} (UNKNOWN, 需要人工填)')
    log(f'error:    {error_count} (跳过)')
    log('')
    if manual_count > 0:
        log('⚠️ UNKNOWN 的处理:')
        log('   Blender 里选中 → N 面板 → Custom Properties')
        log('   renderType=FACILITY + fireType=<11 种之一>')
        log('   fireType 见 docs/GLB_METADATA_SPEC.md §0.8')

    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as e:
        log(f'❌ 致命错误: {e}')
        log(traceback.format_exc())
        sys.exit(2)