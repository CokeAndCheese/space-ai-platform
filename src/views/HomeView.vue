<script setup lang="ts">
/**
 * HomeView —— 主用户视图
 *
 * 跟 Sandbox 一样: 空场景, 由 modelTool 完全接管
 * 模型清单从 useModelLibrary 来 (manifest.json + localStorage 选择持久化)
 * 用户从顶部下拉框选 → 触发 handleUrlChange → 走带拓扑证明的逐资产加载生命周期
 *
 * 顶部 nav + 模型下拉框归 App.vue 管 (避免重复)
 * ChatPanel 在右侧 (AI 助手)
 */

import { computed, ref, watch, onMounted, onBeforeUnmount, type WatchStopHandle } from 'vue'
import { useThreeScene } from '@/composables/useThreeScene'
import { useModelLibrary } from '@/composables/useModelLibrary'
import { useTopologySceneLifecycle } from '@/composables/useTopologySceneLifecycle'
import { ssp } from '@/ssp'
import { useChatStore } from '@/stores/chat'
import ChatPanel from '@/views/ChatPanel.vue'

const lib = useModelLibrary()
const chat = useChatStore()
const topologyLifecycle = useTopologySceneLifecycle()

function unloadManagedModels(): void {
  topologyLifecycle.invalidateAndCleanup()
}

// 3D 场景 —— modelUrl 用空字符串(不自动加载), 由 modelTool 完全接管
const {
  containerRef,
  loading: rendererLoading,
  errorMsg: rendererError,
  currentModelUrl: rendererModelUrl,
} = useThreeScene({
  modelUrl: computed(() => ''),
  onModelUnload: unloadManagedModels,
})

const modelLoading = ref(false)
const modelError = ref('')
const requestedModelUrl = ref('')
const loading = computed(() => rendererLoading.value || modelLoading.value)
const errorMsg = computed(() => modelError.value || rendererError.value)
const currentModelUrl = computed(() => requestedModelUrl.value || rendererModelUrl.value)

/**
 * 跟 Sandbox 一样: 监听 lib.url 变化, 由 modelTool 接管加载
 */
let modelLoadRequest = 0
let viewDisposed = false
let contextRetryTimer: number | null = null
let stopUrlWatch: WatchStopHandle | null = null

async function handleUrlChange(url: string): Promise<void> {
  const request = ++modelLoadRequest
  requestedModelUrl.value = url
  modelError.value = ''
  modelLoading.value = url.length > 0
  try {
    const result = await topologyLifecycle.select(url, lib.models.value)
    const isCurrent = () => (
      !viewDisposed &&
      request === modelLoadRequest &&
      topologyLifecycle.isGenerationCurrent(result.generation)
    )
    if (!isCurrent() || result.kind === 'stale') return
    if (result.kind === 'empty') {
      console.log('[Home] cleared scene (no GLB loaded)')
      return
    }
    if (result.kind === 'model-error') {
      modelError.value = result.message
      console.warn('[Home] model load failed:', result.message)
      return
    }

    console.log(`[Home] loaded ${result.assetCount} GLB asset(s)`)
    if (!isCurrent()) return
    await chat.fitScene('iso')
    if (!isCurrent()) return
    await chat.sendQuery('__capture_main_viewpoint__', { internal: true, forceFallback: true })
    if (!isCurrent()) return
  } catch (err) {
    if (request === modelLoadRequest && !viewDisposed) {
      modelError.value = err instanceof Error ? err.message : String(err)
      console.warn('[Home] model load failed:', err)
    }
  } finally {
    if (request === modelLoadRequest) modelLoading.value = false
  }
}

onMounted(() => {
  // 等 ssp context 初始化完成
  const tryTrigger = () => {
    if (viewDisposed) return
    if (ssp.hasContext()) {
      void handleUrlChange(lib.url.value)
      stopUrlWatch?.()
      stopUrlWatch = watch(() => lib.url.value, (newUrl) => {
        void handleUrlChange(newUrl)
      })
    } else {
      contextRetryTimer = window.setTimeout(tryTrigger, 50)
    }
  }
  tryTrigger()
})

onBeforeUnmount(() => {
  viewDisposed = true
  modelLoadRequest++
  topologyLifecycle.invalidate()
  modelLoading.value = false
  stopUrlWatch?.()
  stopUrlWatch = null
  if (contextRetryTimer !== null) {
    window.clearTimeout(contextRetryTimer)
    contextRetryTimer = null
  }
})
</script>

<template>
  <div class="home">
    <div ref="containerRef" class="three-container">
      <div v-if="loading" class="overlay">
        <div class="spinner"></div>
        <p>模型加载中…</p>
        <p class="hint">{{ currentModelUrl }}</p>
      </div>
      <div v-if="errorMsg" class="overlay error">
        <p>{{ errorMsg }}</p>
      </div>
      <div v-if="!loading && !errorMsg && !lib.url.value" class="overlay empty">
        <p>👆 从顶部下拉框选择模型</p>
        <p class="hint">选整个场景 (195 MB) 或单层 GLB (~3 MB)</p>
      </div>
    </div>

    <!-- AI 对话面板 (右侧抽屉) -->
    <ChatPanel />
  </div>
</template>

<style scoped>
.home {
  width: 100%;
  height: 100%;
  display: flex;
}

.three-container {
  position: relative;
  flex: 1;
  height: 100%;
}

.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: #fff;
  background: rgba(0, 0, 0, 0.5);
  font-size: 14px;
}

.overlay.error {
  color: #ff6b6b;
  white-space: pre-line;
  text-align: center;
  padding: 20px;
}

.overlay.empty {
  color: #aaa;
  background: rgba(0, 0, 0, 0.3);
}

.overlay .hint {
  font-size: 11px;
  color: #888;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
}

.spinner {
  width: 36px;
  height: 36px;
  border: 3px solid rgba(255, 255, 255, 0.2);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
