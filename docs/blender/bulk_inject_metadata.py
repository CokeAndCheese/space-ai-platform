#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
bulk_inject_metadata.py — Blender 端批量注入 GLB metadata

用途:
  在 Blender 里给当前场景的所有 mesh 批量加 Custom Properties:
    - sid           (按 renderType + 楼层内 sequence 生成)
    - renderType    (按 mesh.name 关键词猜: DOOR / WINDOW / STAIR / ELEVATOR / CEILING / WALL / SPACE) [v3: 删 ROOF, 加 WALL]
    - spaceType     (按 collection 名字猜: TOILET / MEETING_ROOM / ...)
    - renderTypeConfidence (low / high)
  其他字段 (findId / 冗余 floorName/building/level) 走 scripts/auto-fill.mjs 处理,
  本脚本不动。

⚠️ 本脚本放在 docs/ 下, 项目代码不会 import 它, 不会被 vue-tsc / vite 扫到。
   纯文档/工具参考, Blender 操作员独立运行。

前置条件 (按重要性):
  1. mesh 在 Blender 里有合理名字 (Door_A_6F_001 / Window_NW_42)
     ❌ MERGED_0_LIBENT... 这种会被归 CEILING + low confidence
  2. mesh 放进命名 collection (TOILET_MALE_A_6F / MEETING_ROOM_BIG)
     ❌ 顶层 "Collection" 无法识别 spaceType
  3. scene.extras 已有 floorName / building / level / floorType
     ❌ 没 scene.extras 脚本会报错退出
  4. Blender >= 3.0 (用了 bpy.props / collections 模块 API)

两种用法:

  ### A. 在 Blender GUI 里跑
    1. Blender → Scripting 工作区
    2. Open → 选这个脚本
    3. 改下面 CONFIG 区里的 INPUT_PATH / OUTPUT_PATH
    4. Run Script

  ### B. 命令行批量处理
    blender --background \
      --python docs/blender/bulk_inject_metadata.py \
      -- --input glb_cleaned/A_6F.glb \
         --output glb_cleaned/A_6F_injected.glb \
         --dry-run

    退出码:
      0 - 成功
      1 - 参数错
      2 - scene.extras 缺失
      3 - 写 GLB 失败
"""

import bpy
import bmesh
import sys
import os
import re
import json
import argparse
from pathlib import Path
from collections import Counter

# ============================================================================
# CONFIG (GUI 模式直接改这里)
# ============================================================================

# GUI 模式的默认路径 (命令行会被覆盖)
GUI_INPUT_PATH = ""           # 例: "/path/to/A_6F.glb" 或 "" 用当前 scene
GUI_OUTPUT_PATH = ""          # 例: "/path/to/A_6F_injected.glb" 或 "" 用 INPUT_PATH

# GUI 模式: True = 只打印, 不真写
GUI_DRY_RUN = False

# ============================================================================
# 匹配规则 (case insensitive)
# ============================================================================

# renderType 关键词 (v3.1: 删 ROOF, 加 WALL + FACILITY)
# key = renderType, value = 关键词列表 (any match)
RENDER_TYPE_RULES = {
    'DOOR':     ['door', '门', 'door_'],
    'WINDOW':   ['window', 'win_', '窗', 'wd_', 'wn_'],
    'STAIR':    ['stair', 'step', '楼梯'],
    'ELEVATOR': ['elev', 'lift', '电梯'],
    'WALL':     ['wall', '柱', '梁', 'beam', 'column', 'pillar', '墙'],
    'FACILITY': ['hydrant', 'smoke_detector', 'smoke', 'sprinkler', 'extinguisher',
                 'emergency_light', 'exit_sign', 'break_glass', 'alarm_bell',
                 'fire_hose', 'fire_door', 'fire_', 'facility',
                 '消火栓', '烟感', '喷淋', '灭火器', '应急', '报警器'],
    'SPACE':    None,  # SPACE 由 collection 名字判断, 不靠 mesh.name
    # CEILING 是默认值, 不需要关键词, 找不到匹配的归 CEILING
    # ROOF 在 v3 删除 (屋顶 mesh 一律 CEILING)
}

# fireType 关键词 (v3.1, 仅 FACILITY 用)
FIRE_TYPE_RULES = {
    'HYDRANT':         ['hydrant', '消火栓'],
    'SMOKE_DETECTOR':  ['smoke', 'smoke_detector', '烟感', '烟雾'],
    'SPRINKLER':       ['sprinkler', '喷淋', '喷头'],
    'EXTINGUISHER':    ['extinguisher', '灭火器'],
    'EMERGENCY_LIGHT': ['emergency', 'emergency_light', '应急', '应急灯'],
    'EXIT_SIGN':       ['exit_sign', '出口', '疏散指示'],
    'BREAK_GLASS':     ['break_glass', '破玻', '手动报警'],
    'ALARM_BELL':      ['alarm', 'alarm_bell', '警铃', '火警铃'],
    'FIRE_HOSE':       ['fire_hose', '水带'],
    'FIRE_DOOR':       ['fire_door', '防火门', '防火卷帘'],
    'OTHER':           [],  # 兜底
}

# spaceType 关键词 (按 collection 名字匹配, key = spaceType, value = 关键词列表)
SPACE_TYPE_RULES = {
    'TOILET':          ['toilet', 'wc', '厕所', '卫生间', 'restroom', 'bathroom'],
    'MEETING_ROOM':    ['meeting', 'conference', '会议室', 'boardroom'],
    'OFFICE':          ['office', '办公', 'workstation'],
    'CORRIDOR':        ['corridor', 'hallway', '走廊', '过道', 'passage'],
    'STAIRWELL':       ['stairwell', '楼梯间'],
    'ELEVATOR_HALL':   ['elev_hall', 'lift_lobby', 'elevator_lobby', '电梯厅'],
    'MECHANICAL_ROOM': ['mech_room', 'mechanical', '机房', '电井', 'electrical_room'],
    'KITCHEN':         ['kitchen', '厨房'],
    'STORAGE':         ['storage', '储藏', '杂物间'],
    'LOBBY':           ['lobby', '大堂', '前厅', 'reception'],
    'BALCONY':         ['balcony', '阳台', 'terrace'],
    'BEDROOM':         ['bedroom', '卧室', '宿舍', 'dorm'],
    'LAUNDRY':         ['laundry', '洗衣房'],
}

# 关键词优先级: 多个规则都匹配时, 谁优先 (顺序敏感)
RENDER_TYPE_PRIORITY = ['DOOR', 'WINDOW', 'STAIR', 'ELEVATOR', 'WALL', 'FACILITY', 'SPACE']
SPACE_TYPE_PRIORITY = list(SPACE_TYPE_RULES.keys())
FIRE_TYPE_PRIORITY = list(FIRE_TYPE_RULES.keys())


# ============================================================================
# 工具函数
# ============================================================================

def log(msg):
    """统一 log, 加 [bulk-inject] 前缀"""
    print(f'[bulk-inject] {msg}', flush=True)


def match_render_type(mesh_name):
    """按 mesh.name 匹配 renderType
    返回 (renderType, confidence) 元组, 没匹配返回 ('CEILING', 'low')
    """
    name_lower = mesh_name.lower()
    for rt in RENDER_TYPE_PRIORITY:
        if rt == 'SPACE':
            continue
        keywords = RENDER_TYPE_RULES.get(rt) or []
        for kw in keywords:
            if kw.lower() in name_lower:
                return rt, 'high'
    return 'CEILING', 'low'


def match_space_type(collection_name):
    """按 collection 名字匹配 spaceType
    返回 spaceType 或 None
    """
    name_lower = collection_name.lower()
    for st in SPACE_TYPE_PRIORITY:
        keywords = SPACE_TYPE_RULES.get(st) or []
        for kw in keywords:
            if kw.lower() in name_lower:
                return st
    return None


def match_fire_type(mesh_name):
    """按 mesh.name 匹配 fireType (v3.1 新增, FACILITY 用)
    返回 fireType 或 None
    """
    name_lower = mesh_name.lower()
    for ft in FIRE_TYPE_PRIORITY:
        if ft == 'OTHER':
            continue
        keywords = FIRE_TYPE_RULES.get(ft) or []
        for kw in keywords:
            if kw.lower() in name_lower:
                return ft
    return None


def get_collection_chain(obj):
    """拿 obj 的所有父级 collection 名字 (从根到叶)"""
    chain = []
    for c in bpy.data.collections:
        if obj.name in c.objects or any(child == obj for child in c.objects):
            chain.append(c.name)
    return chain


def get_topmost_collection_name(obj):
    """拿 obj 所在的最高层 collection 名字"""
    collections = [c for c in bpy.data.collections if obj.name in c.objects]
    if not collections:
        return ''
    # 找根 collection (没有父 collection 的)
    for c in collections:
        parent_collections = [other for other in bpy.data.collections if c.name in other.children]
        if not parent_collections:
            return c.name
    # 退化: 返回第一个
    return collections[0].name


def ensure_custom_property(obj, name, value, prop_type='String'):
    """给 obj 加 Custom Property (如果不存在或值变了)"""
    if name in obj:
        if obj[name] == value:
            return False  # 没变化
    obj[name] = value
    return True


def get_scene_extras():
    """从当前 scene 拿 extras (Blender 的 Custom Properties 映射到 scene)"""
    scene = bpy.context.scene
    required = ['floorName', 'building', 'level', 'floorType']
    missing = [k for k in required if k not in scene]
    if missing:
        return None, missing
    return {
        'floorName': scene['floorName'],
        'building': scene['building'],
        'level': scene['level'],
        'floorType': scene['floorType'],
        'name': scene.get('name', ''),
    }, []


def collect_mesh_objects():
    """收所有 mesh object (排除空 group / non-mesh)"""
    return [o for o in bpy.context.scene.objects if o.type == 'MESH']


# ============================================================================
# 核心: 扫描 + 注入
# ============================================================================

def inject_to_scene(stats):
    """核心逻辑: 扫所有 mesh, 加 sid / renderType / spaceType"""
    scene_extras, missing = get_scene_extras()
    if scene_extras is None:
        log(f'❌ scene 缺 Custom Properties: {missing}')
        log(f'   先在场景级填: {missing}')
        return False, scene_extras

    log(f'📋 scene.extras: floorName={scene_extras["floorName"]} '
        f'building={scene_extras["building"]} '
        f'level={scene_extras["level"]} '
        f'floorType={scene_extras["floorType"]}')

    meshes = collect_mesh_objects()
    log(f'🔍 找到 {len(meshes)} 个 mesh object')

    # 按 renderType 计数 sid (用于生成 SEQ)
    sid_counters = Counter()

    # 详细报告
    render_type_counter = Counter()
    space_type_counter = Counter()
    fire_type_counter = Counter()
    unknown_meshes = []  # 无法识别的 mesh (名字 + collection 信息)
    low_confidence_meshes = []

    for obj in meshes:
        mesh_name = obj.name
        coll_name = get_topmost_collection_name(obj)

        # 1. renderType
        rt, confidence = match_render_type(mesh_name)
        render_type_counter[rt] += 1

        # 2. spaceType (仅 SPACE 才有)
        space_type = None
        if rt == 'SPACE':
            space_type = match_space_type(coll_name) or 'UNKNOWN'
            space_type_counter[space_type] += 1

        # 2.5. fireType (仅 FACILITY 才有, v3.1)
        fire_type = None
        if rt == 'FACILITY':
            fire_type = match_fire_type(mesh_name) or 'OTHER'
            fire_type_counter[fire_type] += 1

        # 3. sid: <RENDERTYPE>_<FLOORNAME>_<SEQ>
        sid_counters[rt] += 1
        seq = sid_counters[rt]
        if rt == 'SPACE' and space_type and space_type != 'UNKNOWN':
            # SPACE 可以加描述: SPACE_<FLOORNAME>_<SPACE_TYPE>_<SEQ>
            # 例: SPACE_A_6F_TOILET_01
            sid = f'SPACE_{scene_extras["floorName"]}_{space_type}_{seq:02d}'
        elif rt == 'FACILITY' and fire_type and fire_type != 'OTHER':
            # FACILITY 可以加描述: FACILITY_<FLOORNAME>_<FIRE_TYPE>_<SEQ>
            # 例: FACILITY_A_6F_HYDRANT_01
            sid = f'FACILITY_{scene_extras["floorName"]}_{fire_type}_{seq:02d}'
        else:
            sid = f'{rt}_{scene_extras["floorName"]}_{seq}'

        # 4. 写入 Custom Properties
        ensure_custom_property(obj, 'sid', sid)
        ensure_custom_property(obj, 'renderType', rt)
        ensure_custom_property(obj, 'renderTypeConfidence', confidence)
        if space_type and rt == 'SPACE':
            ensure_custom_property(obj, 'spaceType', space_type)
        if fire_type and rt == 'FACILITY':
            ensure_custom_property(obj, 'fireType', fire_type)

        # 5. 收 review 名单
        if rt == 'CEILING' and confidence == 'low':
            # 默认归 CEILING 但 confidence 低 → 需要 review
            low_confidence_meshes.append({
                'name': mesh_name,
                'collection': coll_name,
                'sid': sid,
            })

    # 打印报告
    log(f'')
    log(f'📊 renderType 分布:')
    for rt, n in render_type_counter.most_common():
        log(f'   {rt:<10} {n}')

    if space_type_counter:
        log(f'')
        log(f'📊 spaceType 分布:')
        for st, n in space_type_counter.most_common():
            log(f'   {st:<20} {n}')

    if fire_type_counter:
        log(f'')
        log(f'📊 fireType 分布:')
        for ft, n in fire_type_counter.most_common():
            log(f'   {ft:<20} {n}')

    if low_confidence_meshes:
        log(f'')
        log(f'⚠️  {len(low_confidence_meshes)} 个 mesh 归 CEILING + low confidence, 需要人工 review:')
        for m in low_confidence_meshes[:20]:
            log(f'   - {m["name"]}  (coll: {m["collection"]})')
        if len(low_confidence_meshes) > 20:
            log(f'   ... 还有 {len(low_confidence_meshes) - 20} 个')

    stats['renderType'] = dict(render_type_counter)
    stats['spaceType'] = dict(space_type_counter)
    stats['fireType'] = dict(fire_type_counter)
    stats['lowConfidence'] = len(low_confidence_meshes)
    stats['totalMeshes'] = len(meshes)
    stats['lowConfidenceMeshes'] = low_confidence_meshes

    return True, scene_extras


def export_glb(output_path):
    """导出当前场景到 GLB"""
    log(f'💾 导出 GLB → {output_path}')
    try:
        # 确保输出目录存在
        out_dir = os.path.dirname(output_path)
        if out_dir and not os.path.exists(out_dir):
            os.makedirs(out_dir)

        bpy.ops.export_scene.gltf(
            filepath=output_path,
            export_format='GLB',
            use_custom_props=True,         # 关键: 写 Custom Properties
            export_extras=True,            # 关键: 写 GLTF Extras
            export_materials='EXPORT',
            export_animations=False,
            export_morph=False,
            export_skins=False,
        )
        log(f'✅ 导出成功: {output_path}')
        return True
    except Exception as e:
        log(f'❌ 导出失败: {e}')
        return False


def import_glb(input_path):
    """导入 GLB 到当前场景"""
    log(f'📥 导入 GLB ← {input_path}')
    if not os.path.exists(input_path):
        log(f'❌ 文件不存在: {input_path}')
        return False
    try:
        bpy.ops.wm.read_factory_settings(use_empty=True)  # 清空场景
        bpy.ops.import_scene.gltf(filepath=input_path)
        log(f'✅ 导入成功')
        return True
    except Exception as e:
        log(f'❌ 导入失败: {e}')
        return False


# ============================================================================
# 命令行入口
# ============================================================================

def parse_args():
    """解析 -- 之后的参数"""
    argv = sys.argv
    if '--' in argv:
        argv = argv[argv.index('--') + 1:]
    else:
        argv = []

    parser = argparse.ArgumentParser(
        description='Blender 批量注入 GLB metadata (renderType / sid / spaceType)',
    )
    parser.add_argument('--input', '-i', help='输入 GLB 路径 (留空 = 用当前 scene)')
    parser.add_argument('--output', '-o', help='输出 GLB 路径 (默认覆盖输入)')
    parser.add_argument('--dry-run', action='store_true', help='只打印, 不真写 GLB')
    parser.add_argument('--json-report', help='把统计写到 JSON 文件')
    return parser.parse_args(argv)


def main():
    args = parse_args()

    # 命令行参数优先, GUI 配置兜底
    input_path = args.input or GUI_INPUT_PATH
    output_path = args.output or GUI_OUTPUT_PATH
    dry_run = args.dry_run or GUI_DRY_RUN

    log('=' * 60)
    log('Blender 批量注入 GLB metadata')
    log('=' * 60)

    # 如果有输入路径, 先导入
    if input_path:
        if not import_glb(input_path):
            return 1

    # 默认输出 = 输入 (覆盖) 或 GUI_OUTPUT_PATH
    if not output_path:
        if input_path:
            output_path = input_path
        else:
            log('❌ 没指定输出路径 (--output 或 GUI_OUTPUT_PATH)')
            return 1

    # 跑注入
    stats = {}
    ok, scene_extras = inject_to_scene(stats)
    if not ok:
        return 2

    # 写 JSON 报告
    if args.json_report:
        stats['scene'] = scene_extras
        try:
            with open(args.json_report, 'w', encoding='utf-8') as f:
                json.dump(stats, f, ensure_ascii=False, indent=2)
            log(f'📝 报告: {args.json_report}')
        except Exception as e:
            log(f'⚠️  写报告失败: {e}')

    # dry-run 不导出
    if dry_run:
        log('')
        log('🔍 dry-run 模式, 不导出 GLB')
        log('   上面打印的 Custom Properties 都已写到 Blender scene 里,')
        log('   可以在 N 面板检查。确定后去掉 --dry-run 真正导出。')
        return 0

    # 导出
    if not export_glb(output_path):
        return 3

    log('')
    log('🎉 完成')
    log(f'   输出: {output_path}')
    log(f'   下一步: 跑 node scripts/validate-metadata.mjs 验收')

    return 0


# 让 Blender 在 GUI 模式直接 Run Script 也能跑
if __name__ == '__main__':
    sys.exit(main())