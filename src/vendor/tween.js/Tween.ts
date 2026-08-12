/**
 * Tween.js v21.0.0 — 本地化移植版
 * 原项目: https://github.com/tweenjs/tween.js
 * License: MIT
 *
 * 与上游 ESM 单文件 (dist/tween.esm.js) 逻辑一致,改造:
 *  1. var → export const / let,顶层结构改写成 ESM 命名导出
 *  2. 加完整 TS 类型注解,所有 prototype 方法 → class 方法
 *  3. 把 Tween.prototype.foo = function() {} 全部合并到 class 内
 *  4. 主循环 group 仍保留 mainGroup 全局,API 表面与上游 100% 兼容
 */

import { Easing, type EasingFunction } from './Easing'
import { Interpolation, type InterpolationFunction } from './Interpolation'
import { Group } from './Group'
import { Sequence } from './Sequence'
import { now } from './Now'

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type UnknownProps = Record<string, any>

export type TweenLike<T extends UnknownProps = UnknownProps> = Tween<T>

export class Tween<T extends UnknownProps = UnknownProps> {
  private _object: T
  private _group: Group
  private _isPaused = false
  private _pauseStart = 0
  private _valuesStart: UnknownProps = {}
  private _valuesEnd: Record<string, number | string | number[]> = {}
  private _valuesStartRepeat: UnknownProps = {}
  private _duration = 1000
  private _isDynamic = false
  private _initialRepeat = 0
  private _repeat = 0
  private _repeatDelayTime?: number
  private _yoyo = false
  private _isPlaying = false
  private _reversed = false
  private _delayTime = 0
  private _startTime = 0
  private _easingFunction: EasingFunction = Easing.Linear.None
  private _interpolationFunction: InterpolationFunction = Interpolation.Linear
  private _chainedTweens: Tween<any>[] = []
  private _onStartCallback?: (object: T) => void
  private _onEveryStartCallback?: (object: T) => void
  private _onUpdateCallback?: (object: T, elapsed: number) => void
  private _onRepeatCallback?: (object: T) => void
  private _onCompleteCallback?: (object: T) => void
  private _onStopCallback?: (object: T) => void
  private _onStartCallbackFired = false
  private _onEveryStartCallbackFired = false
  private _id = Sequence.nextId()
  private _isChainStopped = false
  private _propertiesAreSetUp = false
  private _goToEnd = false

  constructor(object: T, group: Group = mainGroup) {
    this._object = object
    this._group = group
    group.add(this as unknown as Tween<UnknownProps>)
  }

  // -------------------------------------------------------------------------
  // 状态查询
  // -------------------------------------------------------------------------

  getId(): number { return this._id }
  isPlaying(): boolean { return this._isPlaying }
  isPaused(): boolean { return this._isPaused }

  // -------------------------------------------------------------------------
  // 配置
  // -------------------------------------------------------------------------

  to(target: UnknownProps, duration = 1000): this {
    if (this._isPlaying) {
      throw new Error('Can not call Tween.to() while Tween is already started or paused. Stop the Tween first.')
    }
    this._valuesEnd = target as Record<string, number | string | number[]>
    this._propertiesAreSetUp = false
    this._duration = duration
    return this
  }

  duration(duration = 1000): this {
    this._duration = duration
    return this
  }

  dynamic(dynamic = false): this {
    this._isDynamic = dynamic
    return this
  }

  easing(easingFunction: EasingFunction = Easing.Linear.None): this {
    this._easingFunction = easingFunction
    return this
  }

  interpolation(interpolationFunction: InterpolationFunction = Interpolation.Linear): this {
    this._interpolationFunction = interpolationFunction
    return this
  }

  delay(amount = 0): this {
    this._delayTime = amount
    return this
  }

  repeat(times = 0): this {
    this._initialRepeat = times
    this._repeat = times
    return this
  }

  repeatDelay(amount?: number): this {
    this._repeatDelayTime = amount
    return this
  }

  yoyo(yoyo = false): this {
    this._yoyo = yoyo
    return this
  }

  group(group: Group): this {
    this._group.remove(this as unknown as Tween<UnknownProps>)
    group.add(this as unknown as Tween<UnknownProps>)
    this._group = group
    return this
  }

  remove(): this {
    this._group.remove(this as unknown as Tween<UnknownProps>)
    return this
  }

  chain(...tweens: Tween<any>[]): this {
    this._chainedTweens = tweens
    return this
  }

  // -------------------------------------------------------------------------
  // 生命周期
  // -------------------------------------------------------------------------

  start(time: number = now(), overrideStartingValues = false): this {
    if (this._isPlaying) return this

    this._repeat = this._initialRepeat
    if (this._reversed) {
      this._reversed = false
      for (const property in this._valuesStartRepeat) {
        this._swapEndStartRepeatValues(property)
        this._valuesStart[property] = this._valuesStartRepeat[property]
      }
    }
    this._isPlaying = true
    this._isPaused = false
    this._onStartCallbackFired = false
    this._onEveryStartCallbackFired = false
    this._isChainStopped = false
    this._startTime = time + this._delayTime

    if (!this._propertiesAreSetUp || overrideStartingValues) {
      this._propertiesAreSetUp = true
      if (!this._isDynamic) {
        const tmp: Record<string, number | string | number[]> = {}
        for (const prop in this._valuesEnd) tmp[prop] = this._valuesEnd[prop]
        this._valuesEnd = tmp
      }
      this._setupProperties(
        this._object,
        this._valuesStart,
        this._valuesEnd,
        this._valuesStartRepeat,
        overrideStartingValues,
      )
    }
    return this
  }

  startFromCurrentValues(time?: number): this {
    return this.start(time, true)
  }

  stop(): this {
    if (!this._isChainStopped) {
      this._isChainStopped = true
      this.stopChainedTweens()
    }
    if (!this._isPlaying) return this
    this._group.remove(this as unknown as Tween<UnknownProps>)
    this._isPlaying = false
    this._isPaused = false
    if (this._onStopCallback) this._onStopCallback(this._object)
    return this
  }

  end(): this {
    this._goToEnd = true
    this.update(Infinity)
    return this
  }

  pause(time: number = now()): this {
    if (this._isPaused || !this._isPlaying) return this
    this._isPaused = true
    this._pauseStart = time
    this._group.remove(this as unknown as Tween<UnknownProps>)
    return this
  }

  resume(time: number = now()): this {
    if (!this._isPaused || !this._isPlaying) return this
    this._isPaused = false
    this._startTime += time - this._pauseStart
    this._pauseStart = 0
    this._group.add(this as unknown as Tween<UnknownProps>)
    return this
  }

  stopChainedTweens(): this {
    for (const tween of this._chainedTweens) tween.stop()
    return this
  }

  /**
   * 推进 tween 到 time 时刻,返回是否仍在播放
   */
  update(time: number = now(), autoStart = true): boolean {
    if (this._isPaused) return true

    const endTime = this._startTime + this._duration
    if (!this._goToEnd && !this._isPlaying) {
      if (time > endTime) return false
      if (autoStart) this.start(time, true)
    }
    this._goToEnd = false

    if (time < this._startTime) return true

    if (this._onStartCallbackFired === false) {
      if (this._onStartCallback) this._onStartCallback(this._object)
      this._onStartCallbackFired = true
    }
    if (this._onEveryStartCallbackFired === false) {
      if (this._onEveryStartCallback) this._onEveryStartCallback(this._object)
      this._onEveryStartCallbackFired = true
    }

    let elapsed = (time - this._startTime) / this._duration
    elapsed = this._duration === 0 || elapsed > 1 ? 1 : elapsed
    const value = this._easingFunction(elapsed)

    this._updateProperties(this._object, this._valuesStart, this._valuesEnd, value)
    if (this._onUpdateCallback) this._onUpdateCallback(this._object, elapsed)

    if (elapsed === 1) {
      if (this._repeat > 0) {
        if (isFinite(this._repeat)) this._repeat--
        for (const property in this._valuesStartRepeat) {
          if (!this._yoyo && typeof this._valuesEnd[property] === 'string') {
            this._valuesStartRepeat[property] =
              this._valuesStartRepeat[property] + parseFloat(this._valuesEnd[property] as string)
          }
          if (this._yoyo) this._swapEndStartRepeatValues(property)
          this._valuesStart[property] = this._valuesStartRepeat[property]
        }
        if (this._yoyo) this._reversed = !this._reversed
        this._startTime = time + (this._repeatDelayTime ?? this._delayTime)
        if (this._onRepeatCallback) this._onRepeatCallback(this._object)
        this._onEveryStartCallbackFired = false
        return true
      } else {
        if (this._onCompleteCallback) this._onCompleteCallback(this._object)
        for (const chained of this._chainedTweens) {
          chained.start(this._startTime + this._duration, false)
        }
        this._isPlaying = false
        return false
      }
    }
    return true
  }

  // -------------------------------------------------------------------------
  // 回调
  // -------------------------------------------------------------------------

  onStart(callback?: (object: T) => void): this { this._onStartCallback = callback; return this }
  onEveryStart(callback?: (object: T) => void): this { this._onEveryStartCallback = callback; return this }
  onUpdate(callback?: (object: T, elapsed: number) => void): this { this._onUpdateCallback = callback; return this }
  onRepeat(callback?: (object: T) => void): this { this._onRepeatCallback = callback; return this }
  onComplete(callback?: (object: T) => void): this { this._onCompleteCallback = callback; return this }
  onStop(callback?: (object: T) => void): this { this._onStopCallback = callback; return this }

  // -------------------------------------------------------------------------
  // 内部
  // -------------------------------------------------------------------------

  private _setupProperties(
    _object: UnknownProps,
    _valuesStart: UnknownProps,
    _valuesEnd: Record<string, number | string | number[]>,
    _valuesStartRepeat: UnknownProps,
    overrideStartingValues: boolean,
  ): void {
    for (const property in _valuesEnd) {
      const startValue = _object[property]
      const startValueIsArray = Array.isArray(startValue)
      const propType = startValueIsArray ? 'array' : typeof startValue
      let isInterpolationList = !startValueIsArray && Array.isArray(_valuesEnd[property])

      if (propType === 'undefined' || propType === 'function') continue

      if (isInterpolationList) {
        const endValues = _valuesEnd[property] as number[]
        if (endValues.length === 0) continue
        const temp: number[] = [startValue as number]
        for (let i = 0; i < endValues.length; i++) {
          const value = this._handleRelativeValue(startValue as number, endValues[i])
          if (isNaN(value)) {
            isInterpolationList = false
            console.warn('Found invalid interpolation list. Skipping.')
            break
          }
          temp.push(value)
        }
        if (isInterpolationList) {
          _valuesEnd[property] = temp
        }
      }

      if ((propType === 'object' || startValueIsArray) && startValue && !isInterpolationList) {
        _valuesStart[property] = startValueIsArray ? [] : {}
        const nestedObject = startValue as Record<string, unknown>
        for (const prop in nestedObject) {
          _valuesStart[property][prop] = nestedObject[prop]
        }
        _valuesStartRepeat[property] = startValueIsArray ? [] : {}
        let endValues = _valuesEnd[property]
        if (!this._isDynamic) {
          const tmp: Record<string, unknown> = {}
          for (const prop in endValues as object) tmp[prop] = (endValues as any)[prop]
          _valuesEnd[property] = endValues = tmp as any
        }
        this._setupProperties(
          nestedObject as UnknownProps,
          _valuesStart[property],
          endValues as any,
          _valuesStartRepeat[property],
          overrideStartingValues,
        )
      } else {
        if (typeof _valuesStart[property] === 'undefined' || overrideStartingValues) {
          _valuesStart[property] = startValue
        }
        if (!startValueIsArray) {
          _valuesStart[property] = (_valuesStart[property] as number) * 1.0
        }
        if (isInterpolationList) {
          _valuesStartRepeat[property] = (_valuesEnd[property] as number[]).slice().reverse()
        } else {
          _valuesStartRepeat[property] = _valuesStart[property] || 0
        }
      }
    }
  }

  private _updateProperties(
    _object: UnknownProps,
    _valuesStart: UnknownProps,
    _valuesEnd: Record<string, number | string | number[]>,
    value: number,
  ): void {
    for (const property in _valuesEnd) {
      if (_valuesStart[property] === undefined) continue
      const start = _valuesStart[property] || 0
      let end: any = _valuesEnd[property]
      const startIsArray = Array.isArray(_object[property])
      const endIsArray = Array.isArray(end)
      const isInterpolationList = !startIsArray && endIsArray

      if (isInterpolationList) {
        _object[property] = this._interpolationFunction(end, value)
      } else if (typeof end === 'object' && end) {
        this._updateProperties(_object[property], start, end, value)
      } else {
        end = this._handleRelativeValue(start as number, end)
        if (typeof end === 'number') {
          _object[property] = start + (end - start) * value
        }
      }
    }
  }

  private _handleRelativeValue(start: number, end: number | string): number {
    if (typeof end !== 'string') return end
    if (end.charAt(0) === '+' || end.charAt(0) === '-') {
      return start + parseFloat(end)
    }
    return parseFloat(end)
  }

  private _swapEndStartRepeatValues(property: string): void {
    const tmp = this._valuesStartRepeat[property]
    const endValue = this._valuesEnd[property]
    if (typeof endValue === 'string') {
      this._valuesStartRepeat[property] = this._valuesStartRepeat[property] + parseFloat(endValue)
    } else {
      this._valuesStartRepeat[property] = this._valuesEnd[property]
    }
    this._valuesEnd[property] = tmp
  }
}

// ---------------------------------------------------------------------------
// 主 group (兼容上游 mainGroup 全局)
// ---------------------------------------------------------------------------

export const mainGroup = new Group()
export const VERSION = '21.0.0'
export const nextId = Sequence.nextId.bind(Sequence)

// ---------------------------------------------------------------------------
// TWEEN 单例 group API (与上游导出表面一致)
// ---------------------------------------------------------------------------

export const TWEEN = mainGroup
export const getAll = TWEEN.getAll.bind(TWEEN)
export const removeAll = TWEEN.removeAll.bind(TWEEN)
export const add = TWEEN.add.bind(TWEEN)
export const remove = TWEEN.remove.bind(TWEEN)
export const update = TWEEN.update.bind(TWEEN)

// ---------------------------------------------------------------------------
// 默认导出 (与上游一致:整个命名空间)
// ---------------------------------------------------------------------------

export default {
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
  nextId,
}
