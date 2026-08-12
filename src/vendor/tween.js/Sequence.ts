/**
 * Sequence — 全局递增 id 生成器,用于给每个 Tween 分配唯一 id。
 * 来自 tween.js v21.0.0 上游 Sequence.js
 * License: MIT (https://github.com/tweenjs/tween.js)
 */

export class Sequence {
  private static _nextId = 0

  static nextId(): number {
    return Sequence._nextId++
  }
}
