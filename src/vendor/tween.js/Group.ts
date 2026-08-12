/**
 * Group — tween 容器,用于批量管理多个 tween。
 * 来自 tween.js v21.0.0 上游 Group.js
 * License: MIT (https://github.com/tweenjs/tween.js)
 */

import { Tween } from './Tween'
import { now } from './Now'

export class Group {
  private _tweens: Record<number, Tween<any>> = {}
  private _tweensAddedDuringUpdate: Record<number, Tween<any>> = {}

  getAll(): Tween<any>[] {
    return Object.keys(this._tweens).map((id) => this._tweens[Number(id)])
  }

  removeAll(): void {
    this._tweens = {}
  }

  add(tween: Tween<any>): void {
    this._tweens[tween.getId()] = tween
    this._tweensAddedDuringUpdate[tween.getId()] = tween
  }

  remove(tween: Tween<any>): void {
    delete this._tweens[tween.getId()]
    delete this._tweensAddedDuringUpdate[tween.getId()]
  }

  /**
   * 推进所有 tween。preserve=true 时不自动移除已完成的 tween。
   */
  update(time: number = now(), preserve = false): boolean {
    if (Object.keys(this._tweens).length === 0) return false

    let tweenIds = Object.keys(this._tweens)
    while (tweenIds.length > 0) {
      this._tweensAddedDuringUpdate = {}
      for (let i = 0; i < tweenIds.length; i++) {
        const tween = this._tweens[Number(tweenIds[i])]
        const autoStart = !preserve
        if (tween && tween.update(time, autoStart) === false && !preserve) {
          delete this._tweens[Number(tweenIds[i])]
        }
      }
      tweenIds = Object.keys(this._tweensAddedDuringUpdate)
    }
    return true
  }
}
