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
import {
  createHomeSceneSelectionController,
  STANDARD_MODEL_PACKAGE_INPUT_ACCEPT,
} from '@/composables/useHomeSceneSelection'
import { ssp } from '@/ssp'
import { useChatStore } from '@/stores/chat'
import ChatPanel from '@/views/ChatPanel.vue'

const lib = useModelLibrary()
const chat = useChatStore()
const topologyLifecycle = useTopologySceneLifecycle()
const packageInputRef = ref<HTMLInputElement | null>(null)
const sceneReady = ref(false)

const sceneSelection = createHomeSceneSelectionController({
  lifecycle: topologyLifecycle,
  getManifest: () => lib.models.value,
  getLegacyLabel: (url) => (
    lib.models.value.find((model) => model.url === url)?.displayName ?? '清单模型'
  ),
  invalidateVisibilityUndo: () => chat.invalidateVisibilityUndo(),
  fitScene: () => chat.fitScene('iso'),
  captureMainViewpoint: () => (
    chat.sendQuery('__capture_main_viewpoint__', { internal: true, forceFallback: true })
  ),
})

function unloadManagedModels(): void {
  sceneSelection.invalidateAndCleanup()
}

// 3D 场景 —— modelUrl 用空字符串(不自动加载), 由 modelTool 完全接管
const {
  containerRef,
  loading: rendererLoading,
  errorMsg: rendererError,
} = useThreeScene({
  modelUrl: computed(() => ''),
  onModelUnload: unloadManagedModels,
})

const loading = computed(() => rendererLoading.value || sceneSelection.state.loading)
const errorMsg = computed(() => sceneSelection.state.errorText || rendererError.value)
const loadingText = computed(() => (
  sceneSelection.state.loading ? sceneSelection.statusText() : '正在准备 3D 场景…'
))
const currentSelectionLabel = computed(() => sceneSelection.state.selectionLabel)
const packageSummary = computed(() => sceneSelection.state.packageSummary)

/**
 * 跟 Sandbox 一样: 监听 lib.url 变化, 由 modelTool 接管加载
 */
let viewDisposed = false
let contextRetryTimer: number | null = null
let stopUrlWatch: WatchStopHandle | null = null
let suppressClearedLegacySelection = false

async function handleUrlChange(url: string): Promise<void> {
  await sceneSelection.selectLegacy(url)
}

function openPackagePicker(): void {
  const input = packageInputRef.value
  if (input === null) return
  // Reset before opening as well as after processing so choosing the same ZIP
  // can deliberately supersede an in-flight import.
  input.value = ''
  input.click()
}

async function handlePackageFileChange(event: Event): Promise<void> {
  const input = event.currentTarget as HTMLInputElement
  const file = input.files?.item(0)
  try {
    if (file === null || file === undefined) return

    // A package is intentionally session-only. Clear the persisted legacy
    // selection instead of writing a ZIP or synthetic URI to model storage.
    if (lib.url.value !== '') {
      suppressClearedLegacySelection = true
      lib.selectModel('')
    }
    await sceneSelection.selectPackageFile(file)
  } finally {
    input.value = ''
  }
}

onMounted(() => {
  // 等 ssp context 初始化完成
  const tryTrigger = () => {
    if (viewDisposed) return
    if (ssp.hasContext()) {
      sceneReady.value = true
      void handleUrlChange(lib.url.value)
      stopUrlWatch?.()
      stopUrlWatch = watch(() => lib.url.value, (newUrl) => {
        if (suppressClearedLegacySelection && newUrl === '') {
          suppressClearedLegacySelection = false
          return
        }
        suppressClearedLegacySelection = false
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
  sceneReady.value = false
  sceneSelection.invalidateAndCleanup(true)
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
      <div class="package-import">
        <button
          type="button"
          class="package-import-button"
          :disabled="!sceneReady"
          @click="openPackagePicker"
        >
          导入标准模型包 ZIP
        </button>
        <input
          ref="packageInputRef"
          class="package-file-input"
          type="file"
          :accept="STANDARD_MODEL_PACKAGE_INPUT_ACCEPT"
          hidden
          @change="handlePackageFileChange"
        />

        <section
          v-if="sceneSelection.state.source === 'package'"
          class="package-status"
          aria-live="polite"
        >
          <strong>{{ sceneSelection.statusText() }}</strong>
          <span v-if="currentSelectionLabel" class="package-file-name">
            {{ currentSelectionLabel }}
          </span>
          <template v-if="packageSummary">
            <span>Package：{{ packageSummary.packageId }}</span>
            <span>Revision：{{ packageSummary.revision }}</span>
            <span>{{ packageSummary.floorCount }} 个楼层 · Graph ready</span>
          </template>
        </section>
      </div>

      <div v-if="loading" class="overlay">
        <div class="spinner"></div>
        <p>{{ loadingText }}</p>
        <p v-if="currentSelectionLabel" class="hint">{{ currentSelectionLabel }}</p>
      </div>
      <div v-if="errorMsg" class="overlay error">
        <p>{{ errorMsg }}</p>
      </div>
      <div
        v-if="!loading && !errorMsg && !sceneSelection.state.hasVisibleScene"
        class="overlay empty"
      >
        <p>从顶部选择清单模型，或导入 Studio 标准模型包 ZIP</p>
        <p class="hint">ZIP 仅用于当前会话，不会写入模型清单或本地存储</p>
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

.package-import {
  position: absolute;
  top: 16px;
  left: 16px;
  z-index: 4;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  max-width: min(420px, calc(100% - 32px));
}

.package-import-button {
  border: 1px solid rgba(79, 195, 247, 0.7);
  border-radius: 6px;
  padding: 8px 12px;
  color: #f5fbff;
  background: rgba(20, 42, 58, 0.92);
  font-size: 12px;
  cursor: pointer;
}

.package-import-button:hover:not(:disabled) {
  border-color: #7dd8ff;
  background: rgba(26, 58, 78, 0.96);
}

.package-import-button:disabled {
  opacity: 0.5;
  cursor: wait;
}

.package-status {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  color: #dcecf4;
  background: rgba(13, 18, 24, 0.9);
  font-size: 11px;
  overflow-wrap: anywhere;
}

.package-status strong {
  color: #7dd8ff;
  font-size: 12px;
}

.package-file-name {
  color: #a9b7c0;
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
  z-index: 2;
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
