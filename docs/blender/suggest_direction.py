#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
suggest_direction.py — 算每个 mesh 该放哪个 8 方位 collection

⚠️ 放在 docs/blender/, 不挂项目代码。

用法 (Blender GUI):
  1. Scripting 工作区 → Open → 选文件
  2. Run Script
  3. 看 console (Window → Toggle System Console)

用法 (命令行, debug 用):
  blender --background path/to/A_1F.glb \
    --python docs/blender/suggest_direction.py

# === Blender 闪退防御 ===
  - 每个 mesh 单独 try/except
  - math.atan2 在 None / NaN 时不抛 (返回 0)
  - 进度逐个打印
"""

import bpy
import sys
import math
import traceback
from collections import defaultdict

# ============================================================================
# CONFIG
# ============================================================================

# 哪些 collection 跑方位建议
# None = 自动识别 (DOOR_* / WINDOW_*)
TARGET_COLLECTIONS = None

# 楼层中心 (Blender 世界坐标)
# None = 自动算 (所有目标 mesh 的平均 x/y)
FLOOR_CENTER = None

# 严格 8 方位 vs 4 方位
STRICT_8 = True


def log(msg):
    print(f'[suggest-dir] {msg}', flush=True)


def safe_float(val, default=0.0):
    """安全转 float, NaN/None 用 default"""
    try:
        f = float(val)
        if math.isnan(f) or math.isinf(f):
            return default
        return f
    except (TypeError, ValueError):
        return default


def get_direction(x, y, center):
    """返回 'N' / 'NE' / 'E' / 'SE' / 'S' / 'SW' / 'W' / 'NW'"""
    try:
        dx = safe_float(x) - safe_float(center[0])
        dy = safe_float(y) - safe_float(center[1])
        angle = math.degrees(math.atan2(dx, -dy)) % 360

        if STRICT_8:
            idx = int((angle + 22.5) / 45) % 8
            return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][idx]
        else:
            idx = int((angle + 45) / 90) % 4
            return ['N', 'E', 'S', 'W'][idx]
    except Exception:
        return 'N'  # fallback


def collection_name_for(rt, direction):
    return f'{rt.upper()}_{direction.upper()}'


def is_valid_mesh(obj):
    """检查 obj 是否合法"""
    try:
        return (
            obj is not None
            and hasattr(obj, 'type')
            and obj.type == 'MESH'
            and hasattr(obj, 'name')
        )
    except Exception:
        return False


def main():
    log('═══════════════════════════════════════════════')
    log(f'suggest_direction.py 启动 (Blender {bpy.app.version_string})')
    log('═══════════════════════════════════════════════')

    # 1. 找目标 collections
    try:
        if TARGET_COLLECTIONS is None:
            targets = []
            for c in bpy.data.collections:
                try:
                    name = (c.name or '').upper()
                    if name.startswith('DOOR_') or name.startswith('WINDOW_'):
                        targets.append(c)
                except Exception:
                    continue
        else:
            targets = []
            for n in TARGET_COLLECTIONS:
                if n in bpy.data.collections:
                    targets.append(bpy.data.collections[n])
    except Exception as e:
        log(f'❌ 找 collection 失败: {e}')
        log(traceback.format_exc())
        return 1

    if not targets:
        log('❌ 没找到 DOOR_* / WINDOW_* collection')
        return 1

    log(f'找到 {len(targets)} 个目标 collection:')
    for c in targets:
        log(f'  - {c.name}')

    # 2. 收集所有 mesh + 位置
    all_meshes = []
    for c in targets:
        try:
            for obj in c.all_objects:
                if not is_valid_mesh(obj):
                    continue
                try:
                    pos = obj.matrix_world.translation
                    all_meshes.append({
                        'obj': obj,
                        'collection': c.name,
                        'x': safe_float(pos.x),
                        'y': safe_float(pos.y),
                        'z': safe_float(pos.z),
                        'name': str(obj.name or ''),
                    })
                except Exception as e:
                    log(f'  ⚠️ 读 {obj.name} 位置失败: {e}')
        except Exception as e:
            log(f'⚠️ 遍历 {c.name} 失败: {e}')

    if not all_meshes:
        log('❌ 没找到 mesh')
        return 1

    log(f'找到 {len(all_meshes)} 个 mesh')

    # 3. 算楼层中心
    if FLOOR_CENTER is None:
        try:
            avg_x = sum(m['x'] for m in all_meshes) / len(all_meshes)
            avg_y = sum(m['y'] for m in all_meshes) / len(all_meshes)
            center = (avg_x, avg_y)
            log(f'楼层中心 (自动): ({avg_x:.2f}, {avg_y:.2f})')
        except Exception as e:
            log(f'⚠️ 算中心失败: {e}, 用 (0, 0)')
            center = (0.0, 0.0)
    else:
        center = FLOOR_CENTER
        log(f'楼层中心 (指定): {center}')

    # 4. 逐个算方位
    by_direction = defaultdict(list)
    for m in all_meshes:
        try:
            direction = get_direction(m['x'], m['y'], center)
            m['suggested_direction'] = direction
            rt = m['collection'].split('_')[0]
            m['suggested_collection'] = collection_name_for(rt, direction)
            by_direction[direction].append(m)
        except Exception as e:
            log(f'⚠️ 算 {m["name"]} 方位失败: {e}')

    # 5. 报告
    log('')
    log('═══════════════════════════════════════════════')
    log(f'8 方位分配建议 ({"严格 8 方位" if STRICT_8 else "4 方位"})')
    log('═══════════════════════════════════════════════')

    for direction in ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']:
        if direction not in by_direction:
            continue
        meshes = by_direction[direction]
        log('')
        log(f'【{direction}】 ({len(meshes)} mesh, 建议 collection: DOOR_{direction} / WINDOW_{direction})')

        by_src = defaultdict(list)
        for m in meshes:
            by_src[m['collection']].append(m)

        for src, items in by_src.items():
            log(f'  从 {src} 搬 {len(items)} 个:')
            for m in items:
                log(f'    {m["name"]:30}  pos=({m["x"]:7.2f}, {m["y"]:7.2f})')

    # 6. 不一致警告
    log('')
    log('═══════════════════════════════════════════════')
    log('不一致警告 (mesh 在某个 collection, 但建议去另一个)')
    log('═══════════════════════════════════════════════')

    dir_map = {
        'NORTH': 'N', 'EAST': 'E', 'SOUTH': 'S', 'WEST': 'W',
        'NE': 'NE', 'SE': 'SE', 'SW': 'SW', 'NW': 'NW',
    }

    inconsistency_count = 0
    for m in all_meshes:
        try:
            original = m['collection'].split('_', 1)[-1]
            original_dir = dir_map.get(original, original)
            suggested = m['suggested_direction']
            if STRICT_8 and original_dir in ['N', 'E', 'S', 'W']:
                if original_dir != suggested:
                    log(f'  ⚠️ {m["name"]:30} 原 {original}, 建议 {suggested}')
                    inconsistency_count += 1
        except Exception:
            pass

    log('')
    log(f'共 {inconsistency_count} 个 mesh 需要从原 collection 搬到新 collection')

    log('')
    log('✅ 跑完了. 按上面分组把 mesh 从原 collection 拖到新 collection 即可.')

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