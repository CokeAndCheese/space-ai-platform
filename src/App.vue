<script setup lang="ts">
/**
 * App.vue —— 全局 shell
 *
 * - 顶部: brand + 全局模型下拉框 + nav (Home / Sandbox)
 * - main: <RouterView /> 渲染当前路由
 *
 * 全局模型下拉框:
 *   - 放在这里让 Home 和 Sandbox 都能切换模型
 *   - 切换时通过 lib.selectModel() 触发 lib.url 变化
 *   - 各页面的 modelTool.loadSubcategory / loadFloor watch 这个 url
 */

import { RouterView, RouterLink } from 'vue-router'
import { useModelLibrary } from '@/composables/useModelLibrary'

const lib = useModelLibrary()
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <RouterLink to="/" class="brand">Space AI Platform</RouterLink>

      <!-- 全局模型下拉框 -->
      <div class="model-select">
        <select
          :value="lib.url.value"
          @change="lib.selectModel(($event.target as HTMLSelectElement).value)"
        >
          <option value="">— 选择模型 —</option>
          <optgroup label="整个场景">
            <option
              v-for="m in lib.models.value.filter(m => m.kind === 'scene')"
              :key="m.url"
              :value="m.url"
            >
              {{ m.displayName }} ({{ m.sizeMB.toFixed(1) }} MB)
            </option>
          </optgroup>
          <optgroup label="单层 GLB">
            <option
              v-for="m in lib.models.value.filter(m => m.kind === 'file')"
              :key="m.url"
              :value="m.url"
            >
              {{ m.displayName }}
            </option>
          </optgroup>
        </select>
      </div>

      <nav class="app-nav">
        <RouterLink to="/" exact-active-class="active">Home</RouterLink>
        <RouterLink to="/sandbox" active-class="active">Sandbox</RouterLink>
      </nav>
    </header>
    <main class="app-main">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.app-shell {
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #0a0a0e;
  color: #e6e6e6;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
}

.app-header {
  height: 48px;
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 0 20px;
  background: #13131a;
  border-bottom: 1px solid #2a2a35;
  flex-shrink: 0;
}

.brand {
  font-weight: 600;
  font-size: 14px;
  letter-spacing: 0.5px;
  color: #ffffff;
  text-decoration: none;
}

.model-select {
  display: flex;
  align-items: center;
}

.model-select select {
  background: #1a1a1a;
  border: 1px solid #333;
  color: #ddd;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  min-width: 240px;
  cursor: pointer;
  outline: none;
}

.model-select select:hover {
  border-color: #555;
}

.model-select select:focus {
  border-color: #4FC3F7;
}

.app-nav {
  display: flex;
  gap: 16px;
  margin-left: auto;
}

.app-nav a {
  font-size: 13px;
  color: #aaa;
  text-decoration: none;
  padding: 6px 12px;
  border-radius: 4px;
  transition: background 0.15s;
}

.app-nav a:hover {
  background: #1f1f28;
  color: #fff;
}

.app-nav a.active {
  background: #2a3550;
  color: #fff;
}

.app-main {
  flex: 1;
  min-height: 0;
  position: relative;
}
</style>