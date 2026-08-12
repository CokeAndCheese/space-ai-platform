/**
 * now — 时间源,统一封装 performance.now()。
 * 来自 tween.js v21.0.0 上游 Now.js
 * License: MIT (https://github.com/tweenjs/tween.js)
 */

export function now(): number {
  return performance.now()
}
