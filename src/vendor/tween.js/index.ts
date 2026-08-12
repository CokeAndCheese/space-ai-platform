/**
 * tween.js v21.0.0 — 本地化版
 * 原项目: https://github.com/tweenjs/tween.js  (MIT)
 *
 * 用法:
 *   import { Tween, Easing, Group, update, add, remove, removeAll, getAll, VERSION } from '@/vendor/tween.js'
 *   import TWEEN from '@/vendor/tween.js'   // 默认导出 = 整个命名空间
 *
 *   const t = new Tween(obj).to({x: 100}, 1000).easing(Easing.Cubic.InOut).start()
 *   // 主循环里:
 *   update()   // 推进所有 tween
 */

export { Tween, type UnknownProps } from './Tween'
export { mainGroup, TWEEN, VERSION, nextId, getAll, removeAll, add, remove, update } from './Tween'
export { Easing, getEasing, type EasingFunction, type EasingName, type EasingVariant } from './Easing'
export { Interpolation, type InterpolationFunction } from './Interpolation'
export { Group } from './Group'
export { Sequence } from './Sequence'
export { now } from './Now'

import { Easing } from './Easing'
import { Interpolation } from './Interpolation'
import { Group } from './Group'
import { Sequence } from './Sequence'
import { Tween, VERSION } from './Tween'
import { now } from './Now'
import { getAll, removeAll, add, remove, update } from './Tween'

/** 默认导出:整个命名空间 (与上游一致) */
const tweenNamespace = {
  Easing,
  Group,
  Interpolation,
  Sequence,
  Tween,
  VERSION,
  getAll,
  removeAll,
  add,
  remove,
  update,
  now,
  nextId: Sequence.nextId.bind(Sequence),
}

export default tweenNamespace
