/**
 * useModelLibrary — 模型清单 + 当前选择
 *
 * 职责:
 *   - 从 src/model-manifest.json 读取所有可用模型
 *   - 维护"当前选中"的 model url (响应式,跨路由共享)
 *   - 持久化到 localStorage,刷新后保持选择
 *
 * 设计:
 *   - module 单例 (Pinia 暂时不需要)
 *   - url 是核心字段,UI 直接用 url 传给 useThreeScene
 */

import { ref, computed } from 'vue'
import manifest from '@/model-manifest.json'

export interface ModelRecord {
  kind: 'file' | 'scene'
  subcategory: string
  filename: string
  url: string
  displayName: string
  sizeBytes: number
  sizeMB: number
  mtime: number
}

export interface ModelManifest {
  generatedAt: string
  modelsDir: string
  count: number
  models: ModelRecord[]
}

const STORAGE_KEY = 'space-ai:selected-model-url'

// 校验 manifest 形状 (兜底,build 时出错不至于运行时崩)
const safeManifest = manifest as ModelManifest
const allModels: ModelRecord[] = Array.isArray(safeManifest?.models) ? safeManifest.models : []

// 挂到 window,供 modelTool 读取模型清单
if (typeof window !== 'undefined') {
  ;(window as any).__modelManifest = allModels
}

// 当前选中的 url
const currentUrl = ref<string>(loadInitialUrl())

function loadInitialUrl(): string {
  // 默认空场景: 不自动选任何模型, 用户主动从下拉框选
  // (但如果 localStorage 之前有选过, 恢复)
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved && allModels.some((m) => m.url === saved)) {
    return saved
  }
  return ''
}

export function useModelLibrary() {
  const models = computed<ModelRecord[]>(() => allModels)
  const current = computed<ModelRecord | undefined>(() =>
    allModels.find((m) => m.url === currentUrl.value),
  )
  const url = computed<string>(() => currentUrl.value)

  function selectModel(modelUrl: string): void {
    // 接受空 url (空场景), 走特殊路径
    if (modelUrl === '') {
      currentUrl.value = ''
      try {
        localStorage.setItem(STORAGE_KEY, '')
      } catch {
        // localStorage 写不进也不致命
      }
      return
    }
    if (!allModels.some((m) => m.url === modelUrl)) {
      console.warn(`[useModelLibrary] 未找到模型: ${modelUrl}`)
      return
    }
    currentUrl.value = modelUrl
    try {
      localStorage.setItem(STORAGE_KEY, modelUrl)
    } catch {
      // localStorage 写不进也不致命
    }
  }

  return {
    models,
    current,
    url,
    selectModel,
    /** 当 manifest 里某个 url 不存在时,默认选第一个 */
    ensureValid(): string {
      if (!current.value && allModels.length > 0) {
        selectModel(allModels[0].url)
      }
      return currentUrl.value
    },
  }
}
