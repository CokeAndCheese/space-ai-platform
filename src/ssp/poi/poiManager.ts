/**
 * poiManager — 兴趣点 (POI) 管理
 *
 * 用途: 数字孪生场景里的标签 / 图标 (POI = Point of Interest)。
 * 给某个世界位置贴一个气泡标签, 可选支持 click/hover 交互。
 *
 * 设计:
 *   - 简单 POI: 图标 + 文字 (HTML, 用 CSS2DObject 实现 — 需 cssTool 已加载)
 *     实际上, 我们用纯 THREE.Sprite + CanvasTexture 实现, 不依赖 CSS2D,
 *     这样不需要装额外的 CSS2DRenderer, 性能更好
 *   - 节点 (addNode): 交互更强 (可点击 / 可拖拽 / hover 效果), 仍用 Sprite + CSS2D 组合
 *
 * 数据结构: 闭包 Map<id, handle> + 自增 nextPoiId, 状态全在闭包内。
 *
 * API:
 *   - 创建 (2):   add / addNode
 *   - 显隐 (2):   show / hide
 *   - 移除 (2):   remove / removeAll
 *   - 查询 (2):   getById / list
 *
 * 对应模板:
 *   - src/templates/core-api/poi/createPoi.json
 *   - src/templates/core-api/poi/showHidePoi.json
 *   - src/templates/core-api/poi/createPoiNode.json
 */

import * as THREE from 'three'
import { getSspContext } from '../core/context'
import { getObjectsByUserDataProperty } from '../core/sceneUtils'

export interface PoiOptions {
  /** POI 显示文字 (默认 'POI') */
  text?: string
  /** 世界坐标 (默认 {x:0, y:0, z:0}) */
  position?: { x: number; y: number; z: number }
  /** 关联的对象 (自动跟随), 传 Object3D 或 sid 字符串 */
  attachTo?: THREE.Object3D | string
  /** 背景色 hex (默认 '#29ccff') */
  color?: string
  /** 文字颜色 hex (默认 '#ffffff') */
  textColor?: string
  /** 字号 px (默认 14) */
  fontSize?: number
  /** 图标大小 px (默认 64) */
  iconSize?: number
  /** 默认是否可见 (默认 true) */
  visible?: boolean
}

export interface PoiNodeOptions extends PoiOptions {
  /** hover 颜色变化 */
  hoverColor?: string
  /** 是否可点击 (默认 true) */
  clickable?: boolean
  /** 点击回调 */
  onClick?: (e: unknown) => void
  /** hover 回调 */
  onHover?: (e: unknown) => void
}

/**
 * POI 句柄 — 创建后返回, 用于后续 show/hide/remove。
 *   id      唯一 ID (格式 'poi_N')
 *   sprite  THREE.Sprite (气泡贴图, 用于 raycast 命中检测)
 *   root    根 Group (用来 attach 到其他对象或调 visible)
 *   destroy 销毁: 从 scene 移除 + dispose texture/material
 */
export interface PoiHandle {
  id: string
  sprite: THREE.Sprite
  root: THREE.Object3D
  /** 销毁 */
  destroy(): void
}

/** 自增 POI id 计数器 (module 级, 单调递增, 不复用) */
let nextPoiId = 1

/**
 * PoiManager 公开接口。
 *   创建 (2):   add / addNode
 *   显隐 (2):   show / hide
 *   移除 (2):   remove / removeAll
 *   查询 (2):   getById / list
 */
export interface PoiManager {
  add(opts?: PoiOptions): PoiHandle
  addNode(opts?: PoiNodeOptions): PoiHandle
  show(id: string): boolean
  hide(id: string): boolean
  remove(id: string): boolean
  removeAll(): number
  getById(id: string): PoiHandle | null
  list(): PoiHandle[]
}

/**
 * poiManager 工厂。闭包内维护 pois Map / raycaster / mouse, 状态全在闭包内。
 */
export function createPoiManager(): PoiManager {
  /** POI handle 缓存: id → handle。闭包内单例, 整个 page 共享。 */
  const pois = new Map<string, PoiHandle>()
  /** 全局 raycaster (用于 click/hover 命中 POI) */
  const raycaster = new THREE.Raycaster()
  /** 全局 NDC 鼠标坐标 (setMouseFromEvent 时更新) */
  const mouse = new THREE.Vector2()

  // ===== 内部 helper =====

  // ===== makeIconTexture =====

  /**
   * 画一张 icon + text 的 sprite canvas
   * 返回 THREE.CanvasTexture, 用于 Sprite
   */
  function makeIconTexture(opts: Required<PoiOptions>): THREE.CanvasTexture {
    const { text, color, textColor, fontSize, iconSize } = opts
    const canvas = document.createElement('canvas')
    canvas.width = iconSize * 2
    canvas.height = iconSize
    const ctx = canvas.getContext('2d')!

    // 气泡背景 (圆角矩形)
    const padding = 8
    const textWidth = ctx.measureText(text).width
    const bubbleWidth = Math.min(textWidth + padding * 4, iconSize * 2 - padding * 2)
    const bubbleHeight = iconSize * 0.6
    const x = (canvas.width - bubbleWidth) / 2
    const y = (canvas.height - bubbleHeight) / 2 - 6

    // 阴影
    ctx.shadowColor = 'rgba(0,0,0,0.5)'
    ctx.shadowBlur = 8
    ctx.shadowOffsetY = 2

    // 圆角矩形
    const r = bubbleHeight / 2
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.lineTo(x + bubbleWidth - r, y)
    ctx.arcTo(x + bubbleWidth, y, x + bubbleWidth, y + r, r)
    ctx.lineTo(x + bubbleWidth, y + bubbleHeight - r)
    ctx.arcTo(x + bubbleWidth, y + bubbleHeight, x + bubbleWidth - r, y + bubbleHeight, r)
    ctx.lineTo(x + r, y + bubbleHeight)
    ctx.arcTo(x, y + bubbleHeight, x, y + bubbleHeight - r, r)
    ctx.lineTo(x, y + r)
    ctx.arcTo(x, y, x + r, y, r)
    ctx.closePath()
    ctx.fillStyle = color
    ctx.fill()

    // 小三角 (指向下方)
    ctx.beginPath()
    ctx.moveTo(canvas.width / 2 - 6, y + bubbleHeight)
    ctx.lineTo(canvas.width / 2 + 6, y + bubbleHeight)
    ctx.lineTo(canvas.width / 2, y + bubbleHeight + 10)
    ctx.closePath()
    ctx.fillStyle = color
    ctx.fill()

    // 文字
    ctx.shadowColor = 'transparent'
    ctx.fillStyle = textColor
    ctx.font = `bold ${fontSize}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, canvas.width / 2, y + bubbleHeight / 2)

    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.needsUpdate = true
    return tex
  }

  // ===== makePoiHandle =====

  /**
   * 内部统一创建 POI handle — add (简单) / addNode (可交互) 都走这里。
   * @param isNode  true=节点版 (走 sprite userData 记录 click/hover 回调 + 触发 ensureInteractionListeners)
   */
  function makePoiHandle(opts: PoiOptions & Partial<PoiNodeOptions>, isNode = false): PoiHandle {
    const ctx = getSspContext()
    const id = `poi_${nextPoiId++}`

    const fullOpts: Required<PoiOptions> = {
      text: opts.text ?? (isNode ? 'Node' : 'POI'),
      position: opts.position ?? { x: 0, y: 0, z: 0 },
      attachTo: opts.attachTo ?? ('' as any),
      color: opts.color ?? '#29ccff',
      textColor: opts.textColor ?? '#ffffff',
      fontSize: opts.fontSize ?? 14,
      iconSize: opts.iconSize ?? 64,
      visible: opts.visible ?? true,
    }

    const texture = makeIconTexture(fullOpts)
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    })
    const sprite = new THREE.Sprite(material)
    sprite.scale.set(fullOpts.iconSize / 12, fullOpts.iconSize / 24, 1)
    sprite.position.set(fullOpts.position.x, fullOpts.position.y, fullOpts.position.z)
    sprite.renderOrder = 999
    sprite.visible = fullOpts.visible

    // 节点 (isNode) 时记录交互回调到 sprite userData
    if (isNode) {
      sprite.userData['__poiId'] = id
      sprite.userData['__isInteractive'] = true
      if (opts.onClick) sprite.userData['__onClick'] = opts.onClick
      if (opts.onHover) sprite.userData['__onHover'] = opts.onHover
      if (opts.hoverColor) sprite.userData['__hoverColor'] = opts.hoverColor
    }

    // 根 group (方便 attach)
    const root = new THREE.Group()
    root.name = id
    root.add(sprite)

    // attachTo: 跟随对象移动
    let attached = false
    if (fullOpts.attachTo) {
      const target = typeof fullOpts.attachTo === 'string'
        ? getBySid(fullOpts.attachTo)
        : fullOpts.attachTo
      if (target) {
        target.add(root)
        root.position.set(0, 0, 0)
        attached = true
      }
    }

    // 已 attach 的 root 属于目标子树; 再 add 到 scene 会被 Three.js 自动 re-parent,
    // 从而丢失跟随关系。
    if (!attached) ctx.scene.add(root)

    const handle: PoiHandle = {
      id,
      sprite,
      root,
      destroy() {
        // 由 remove 调
      },
    }
    handle.destroy = () => {
      ctx.scene.remove(root)
      texture.dispose()
      material.dispose()
      pois.delete(id)
    }

    pois.set(id, handle)
    return handle
  }

  // ===== getBySid =====

  /**
   * 按 sid 找场景里的 obj (用于 attachTo 字符串场景, 给 POI 挂到门上用)。
   * thin wrapper — 调 core/sceneUtils.ts 的 getObjectsByUserDataProperty (narrow waist)。
   * 只查 userData.sid, 不查 findId — 跟 objectsTool.getById 行为略有不同, 业务上 POI 通常用业务 sid。
   */
  function getBySid(sid: string): THREE.Object3D | null {
    return getObjectsByUserDataProperty('sid', sid)[0] ?? null
  }

  // ===== setMouseFromEvent =====

  /**
   * 内部 helper: 把屏幕坐标 (event.clientX/Y, 像素) 转成 WebGL NDC (-1 ~ 1) 写入闭包 mouse。
   *   - 屏幕 Y 向下为正, NDC Y 向上为正 — 这里取反
   *   - 闭包 mouse 是 THREE.Vector2 单例, 由 pickPoiSprite 读
   *   - 给 click/mousemove 监听用
   *
   * @param event  鼠标事件 (click / mousemove)
   * @param dom    canvas DOM 元素 (用 getBoundingClientRect 算相对位置)
   */
  function setMouseFromEvent(event: MouseEvent, dom: HTMLElement): void {
    const rect = dom.getBoundingClientRect()
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  }

  // ===== pickPoiSprite =====

  /**
   * 内部 helper: 在 POI 中 raycast 找鼠标命中的 handle。
   *   - 用闭包 mouse (NDC) + ctx.camera 算 ray
   *   - 只挑 interactive 的 POI (addNode 创建的, 有 __isInteractive 标记)
   *   - 取第一个命中, 从 sprite.userData.__poiId 找 handle
   *
   * 4 个返回路径 (任一返回 null):
   *   1. 没可交互 POI
   *   2. raycast 没命中
   *   3. 命中但 userData 没 __poiId (异常)
   *   4. pois.get(id) 找不到 (异常)
   *
   * 依赖闭包: pois Map / raycaster / mouse / ctx.camera
   */
  function pickPoiSprite(): PoiHandle | null {
    const ctx = getSspContext()
    // 只在 interactive POI 中挑
    const sprites: THREE.Sprite[] = []
    pois.forEach((h) => {
      if (h.sprite.userData['__isInteractive']) sprites.push(h.sprite)
    })
    if (sprites.length === 0) return null
    raycaster.setFromCamera(mouse, ctx.camera)
    const hits = raycaster.intersectObjects(sprites, false)
    if (hits.length === 0) return null
    const id = hits[0].object.userData['__poiId'] as string | undefined
    if (!id) return null
    return pois.get(id) ?? null
  }

  // ===== ensureInteractionListeners =====

  /**
   * 安装 DOM click + mousemove 监听, 用于 POI 交互 (click/hover)。
   * 单例: 通过 dom.dataset['poiListenersInstalled'] 标记, 多次调只装一次。
   * 触发时机: 首次 addNode 时由 makePoiHandle 调, 不需要 ssp ctx 提前就绪。
   */
  function ensureInteractionListeners(): void {
    const ctx = getSspContext()
    const dom = ctx.renderer?.domElement
    if (!dom || dom.dataset['poiListenersInstalled'] === '1') return
    dom.dataset['poiListenersInstalled'] = '1'

    let lastHoveredId: string | null = null
    const origColor = new THREE.Color()

    dom.addEventListener('click', (e) => {
      setMouseFromEvent(e as MouseEvent, dom)
      const h = pickPoiSprite()
      if (!h) return
      const cb = h.sprite.userData['__onClick'] as ((e: unknown) => void) | undefined
      cb?.({ poiId: h.id, originalEvent: e, poi: h })
    })

    dom.addEventListener('mousemove', (e) => {
      setMouseFromEvent(e as MouseEvent, dom)
      const h = pickPoiSprite()
      const newId = h?.id ?? null
      if (newId === lastHoveredId) return
      // 还原上一个
      if (lastHoveredId) {
        const prev = pois.get(lastHoveredId)
        if (prev && prev.sprite.material instanceof THREE.SpriteMaterial) {
          // 还原 base color
          const base = prev.sprite.userData['__baseColor'] as THREE.Color | undefined
          if (base) prev.sprite.material.color.copy(base)
        }
        const prevCb = prev?.sprite.userData['__onHover'] as ((e: unknown) => void) | undefined
        if (prev) prevCb?.({ poiId: prev.id, type: 'leave', poi: prev })
      }
      // 应用新的
      if (newId && h) {
        const hoverColor = h.sprite.userData['__hoverColor'] as string | undefined
        if (hoverColor && h.sprite.material instanceof THREE.SpriteMaterial) {
          if (!h.sprite.userData['__baseColor']) {
            origColor.copy(h.sprite.material.color)
            h.sprite.userData['__baseColor'] = origColor.clone()
          }
          h.sprite.material.color.set(hoverColor)
        }
        const cb = h.sprite.userData['__onHover'] as ((e: unknown) => void) | undefined
        cb?.({ poiId: h.id, type: 'enter', poi: h })
      }
      lastHoveredId = newId
    })
  }

  // ===== 公开 API =====

  return {
    /** 创建简单 POI (图标 + 文字) — 见 add */
    add(opts: PoiOptions = {}): PoiHandle {
      return makePoiHandle(opts, false)
    },
    /** 创建可交互 POI 节点 (支持 click / hover) — 见 addNode */
    addNode(opts: PoiNodeOptions = {}): PoiHandle {
      // 节点版: 支持 onClick / onHover / hoverColor
      const handle = makePoiHandle(opts, true)
      // 首次 addNode 时挂全局 click/move 监听
      ensureInteractionListeners()
      return handle
    },
    /** 显示 POI — 见 show */
    show(id: string): boolean {
      const p = pois.get(id)
      if (!p) return false
      p.root.visible = true
      return true
    },
    /** 隐藏 POI — 见 hide */
    hide(id: string): boolean {
      const p = pois.get(id)
      if (!p) return false
      p.root.visible = false
      return true
    },
    /** 移除单个 POI (调 handle.destroy) — 见 remove */
    remove(id: string): boolean {
      const p = pois.get(id)
      if (!p) return false
      p.destroy()
      return true
    },
    /** 移除全部 POI — 返回移除数 */
    removeAll(): number {
      const ids = Array.from(pois.keys())
      ids.forEach((id) => this.remove(id))
      return ids.length
    },
    /** 按 id 查 handle — 找不到返回 null */
    getById(id: string): PoiHandle | null {
      return pois.get(id) ?? null
    },
    /** 列出全部 POI handle */
    list(): PoiHandle[] {
      return Array.from(pois.values())
    },
  }
}
