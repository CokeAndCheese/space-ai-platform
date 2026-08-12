/**
 * cssTool — 在 3D 场景里贴文字标签 (Sprite + Canvas 实现)
 *
 * 设计原则:
 *   - 用 THREE.Sprite + CanvasTexture 自己画, 不接外部 HTML 元素
 *   - 避开 SVG foreignObject tainted canvas 问题
 *   - 比 Three.js CSS2DRenderer 简单 (不需要额外 renderer 并存)
 *
 * API:
 *   - createCSS2DObject(opts)   创建标签 (返回 handle, 可 destroy)
 *   - removeAll()                清空所有标签, 返回数量
 *   - list()                     列出所有 handle (不销毁)
 *
 * 对应模板:
 *   - src/templates/ssp_templates/css/css2dLabel.json
 */

import * as THREE from 'three'
import { getSspContext } from '../core/context'

/**
 * CSS2D 标签配置项。所有字段可选, 不传走默认值。
 *   text      文字内容
 *   position  3D 世界坐标
 *   color     文字颜色
 *   bgColor   背景色 (rgba / hex)
 *   fontSize  字号 (px)
 *   size      世界单位 (米), canvas 像素 = 米 × 100 × dpr
 */
export interface CSS2DOptions {
  /** 文字内容, 默认 'Label' */
  text?: string
  /** 3D 位置, 默认 (0, 0, 0) */
  position?: { x: number; y: number; z: number }
  /** 文字颜色, 默认 '#ffffff' */
  color?: string
  /** 背景色, 默认 '#000000' 透明 60% */
  bgColor?: string
  /** 字号 px, 默认 14 */
  fontSize?: number
  /** 显示大小 (世界单位, 米), 默认 { width: 2, height: 1 } */
  size?: { width: number; height: number }
}

/**
 * createCSS2DObject 返回的标签句柄。
 *   id       唯一标识 (css_1, css_2, ...)
 *   sprite   Three.js Sprite 对象, 可调 .visible / .position / .scale
 *   destroy() 销毁 (从 scene 移除 + dispose texture/material + 从 labels Map 删)
 */
export interface CSS2DObjectHandle {
  id: string
  sprite: THREE.Sprite
  destroy(): void
}

/** 自增 id 计数器 (css_1, css_2, ...), module 单例 */
let nextCssId = 1

/**
 * CSS 标签工具接口。
 *   createCSS2DObject(opts)   创建标签
 *   removeAll()                清空所有
 *   list()                     列出所有 handle (不销毁)
 */
export interface CSSTool {
  createCSS2DObject(opts?: CSS2DOptions): CSS2DObjectHandle
  removeAll(): number
  list(): CSS2DObjectHandle[]
}

/**
 * cssTool 工厂。
 * 闭包内 labels Map 跟踪所有标签; module 级 nextCssId 自增 id。
 */
export function createCSSTool(): CSSTool {
  /** 所有已创建标签的 Map (id → handle) */
  const labels = new Map<string, CSS2DObjectHandle>()

  /**
   * 把文字 + 背景色画到 canvas, 转成 Three.js CanvasTexture。
   * 圆角矩形背景 + 居中文字, dpr 适配保证 retina 清晰。
   */
  function makeTextTexture(opts: Required<CSS2DOptions>): THREE.CanvasTexture {
    const { text, color, bgColor, fontSize, size } = opts
    const dpr = window.devicePixelRatio || 1
    const padding = fontSize * 0.5
    const w = size.width * dpr * 100  // canvas 像素: world 米 × 100 px/米
    const h = size.height * dpr * 100
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!

    // 背景 (圆角矩形)
    const rad = h * 0.15
    ctx.fillStyle = bgColor
    ctx.beginPath()
    ctx.roundRect(padding, padding, w - padding * 2, h - padding * 2, rad)
    ctx.fill()

    // 文字 (居中)
    ctx.fillStyle = color
    ctx.font = `bold ${fontSize * dpr}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, w / 2, h / 2)

    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.needsUpdate = true
    return tex
  }

  return {
    /**
     * 创建 CSS2D 标签, 加到 scene。
     * 返回 handle: 可调 destroy() 删除, 或直接用 sprite.visible / sprite.position。
     */
    createCSS2DObject(opts: CSS2DOptions = {}): CSS2DObjectHandle {
      const ctx = getSspContext()
      const id = `css_${nextCssId++}`
      const fullOpts: Required<CSS2DOptions> = {
        text: opts.text ?? 'Label',
        position: opts.position ?? { x: 0, y: 0, z: 0 },
        color: opts.color ?? '#ffffff',
        bgColor: opts.bgColor ?? 'rgba(0,0,0,0.6)',
        fontSize: opts.fontSize ?? 14,
        size: opts.size ?? { width: 2, height: 1 },
      }

      const texture = makeTextTexture(fullOpts)
      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
      })
      const sprite = new THREE.Sprite(material)
      sprite.scale.set(fullOpts.size.width, fullOpts.size.height, 1)
      sprite.position.set(fullOpts.position.x, fullOpts.position.y, fullOpts.position.z)
      sprite.renderOrder = 1000
      sprite.name = id

      ctx.scene.add(sprite)

      const handle: CSS2DObjectHandle = {
        id,
        sprite,
        destroy() {
          ctx.scene.remove(sprite)
          texture.dispose()
          material.dispose()
          labels.delete(id)
        },
      }
      labels.set(id, handle)
      return handle
    },
    /** 清空所有标签 (调每个 handle.destroy()), 返回清除的数量 */
    removeAll(): number {
      const ids = Array.from(labels.keys())
      ids.forEach((id) => {
        const h = labels.get(id)
        h?.destroy()
      })
      return ids.length
    },
    /** 列出所有标签的 handle (不销毁) — 给批量操作 / 调试用 */
    list(): CSS2DObjectHandle[] {
      return Array.from(labels.values())
    },
  }
}