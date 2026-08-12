/**
 * Easing 函数集合 — 来自 tween.js v21.0.0 上游 Easing.js
 * License: MIT (https://github.com/tweenjs/tween.js)
 *
 * 与上游 Object.freeze 结构一致,改成 TS readonly 命名导出。
 */

export type EasingFunction = (amount: number) => number

type EasingSet = {
  None: EasingFunction
  In: EasingFunction
  Out: EasingFunction
  InOut: EasingFunction
}

export const Easing = {
  Linear: {
    None: (k: number) => k,
    In: (k: number) => k,
    Out: (k: number) => k,
    InOut: (k: number) => k,
  } as EasingSet,

  Quadratic: {
    In: (k: number) => k * k,
    Out: (k: number) => k * (2 - k),
    InOut: (k: number) => ((k *= 2) < 1 ? 0.5 * k * k : -0.5 * (--k * (k - 2) - 1)),
  } as EasingSet,

  Cubic: {
    In: (k: number) => k * k * k,
    Out: (k: number) => --k * k * k + 1,
    InOut: (k: number) =>
      ((k *= 2) < 1 ? 0.5 * k * k * k : 0.5 * ((k -= 2) * k * k + 2)),
  } as EasingSet,

  Quartic: {
    In: (k: number) => k * k * k * k,
    Out: (k: number) => 1 - --k * k * k * k,
    InOut: (k: number) =>
      ((k *= 2) < 1
        ? 0.5 * k * k * k * k
        : -0.5 * ((k -= 2) * k * k * k - 2)),
  } as EasingSet,

  Quintic: {
    In: (k: number) => k * k * k * k * k,
    Out: (k: number) => --k * k * k * k * k + 1,
    InOut: (k: number) =>
      ((k *= 2) < 1
        ? 0.5 * k * k * k * k * k
        : 0.5 * ((k -= 2) * k * k * k * k + 2)),
  } as EasingSet,

  Sinusoidal: {
    In: (k: number) => 1 - Math.cos(((1.0 - k) * Math.PI) / 2),
    Out: (k: number) => Math.sin((k * Math.PI) / 2),
    InOut: (k: number) => 0.5 * (1 - Math.sin(Math.PI * (0.5 - k))),
  } as EasingSet,

  Exponential: {
    In: (k: number) => (k === 0 ? 0 : Math.pow(1024, k - 1)),
    Out: (k: number) => (k === 1 ? 1 : 1 - Math.pow(2, -10 * k)),
    InOut: (k: number) =>
      k === 0
        ? 0
        : k === 1
          ? 1
          : (k *= 2) < 1
            ? 0.5 * Math.pow(1024, k - 1)
            : 0.5 * (-Math.pow(2, -10 * (k - 1)) + 2),
  } as EasingSet,

  Circular: {
    In: (k: number) => 1 - Math.sqrt(1 - k * k),
    Out: (k: number) => Math.sqrt(1 - --k * k),
    InOut: (k: number) =>
      (k *= 2) < 1
        ? -0.5 * (Math.sqrt(1 - k * k) - 1)
        : 0.5 * (Math.sqrt(1 - (k -= 2) * k) + 1),
  } as EasingSet,

  Elastic: {
    In: (k: number) => {
      if (k === 0) return 0
      if (k === 1) return 1
      return -Math.pow(2, 10 * (k - 1)) * Math.sin((k - 1.1) * 5 * Math.PI)
    },
    Out: (k: number) => {
      if (k === 0) return 0
      if (k === 1) return 1
      return Math.pow(2, -10 * k) * Math.sin((k - 0.1) * 5 * Math.PI) + 1
    },
    InOut: (k: number) => {
      if (k === 0) return 0
      if (k === 1) return 1
      k *= 2
      if (k < 1) {
        return -0.5 * Math.pow(2, 10 * (k - 1)) * Math.sin((k - 1.1) * 5 * Math.PI)
      }
      return 0.5 * Math.pow(2, -10 * (k - 1)) * Math.sin((k - 1.1) * 5 * Math.PI) + 1
    },
  } as EasingSet,

  Back: {
    In: (k: number) => {
      const s = 1.70158
      return k === 1 ? 1 : k * k * ((s + 1) * k - s)
    },
    Out: (k: number) => {
      const s = 1.70158
      return k === 0 ? 0 : --k * k * ((s + 1) * k + s) + 1
    },
    InOut: (k: number) => {
      const s = 1.70158 * 1.525
      return (k *= 2) < 1
        ? 0.5 * (k * k * ((s + 1) * k - s))
        : 0.5 * ((k -= 2) * k * ((s + 1) * k + s) + 2)
    },
  } as EasingSet,

  Bounce: {
    In: (k: number) => 1 - Easing.Bounce.Out(1 - k),
    Out: (k: number) => {
      if (k < 1 / 2.75) return 7.5625 * k * k
      if (k < 2 / 2.75) return 7.5625 * (k -= 1.5 / 2.75) * k + 0.75
      if (k < 2.5 / 2.75) return 7.5625 * (k -= 2.25 / 2.75) * k + 0.9375
      return 7.5625 * (k -= 2.625 / 2.75) * k + 0.984375
    },
    InOut: (k: number) =>
      k < 0.5 ? Easing.Bounce.In(k * 2) * 0.5 : Easing.Bounce.Out(k * 2 - 1) * 0.5 + 0.5,
  } as EasingSet,
} as const

// 用于运行时按字符串名查找 easing 集合
export type EasingName =
  | 'Linear'
  | 'Quadratic'
  | 'Cubic'
  | 'Quartic'
  | 'Quintic'
  | 'Sinusoidal'
  | 'Exponential'
  | 'Circular'
  | 'Elastic'
  | 'Back'
  | 'Bounce'

export type EasingVariant = 'In' | 'Out' | 'InOut'

export function getEasing(name: EasingName, variant: EasingVariant = 'InOut'): EasingFunction {
  const group = Easing[name] as EasingSet | undefined
  if (!group) return Easing.Linear.None
  return group[variant] ?? Easing.Linear.None
}
