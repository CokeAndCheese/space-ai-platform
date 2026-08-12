<script setup lang="ts">
/**
 * ChatPanel —— AI 对话 UI (右侧抽屉)
 *
 * Phase 1 骨架:
 *   - 输入框 + 发送按钮
 *   - 历史消息列表 (user/assistant 交替)
 *   - Intent JSON 显示 (折叠可展开)
 *   - Thinking 块 (折叠可展开)
 *   - 状态指示 (idle / thinking / parsing / executing)
 *   - Quick Actions (6 个常见 query)
 */

import { ref, computed } from 'vue'
import { useChatStore } from '@/stores/chat'
import { intentLogger } from '@/ai/audit/IntentLogger'

const chat = useChatStore()
const input = ref('')
const showThinking = ref(false)
const showAudit = ref(false)
const auditEntries = ref<any[]>([])
const expandedAuditId = ref<string | null>(null)

function refreshAudit() {
  auditEntries.value = intentLogger.readAll().slice().reverse()  // 最新在前
}

function toggleAuditEntry(id: string) {
  expandedAuditId.value = expandedAuditId.value === id ? null : id
}

function iconForSource(source: string): string {
  switch (source) {
    case 'llm': return '🤖'
    case 'fallback': return '🔁'
    case 'mock': return '🎭'
    case 'user-edit': return '✏️'
    default: return '❓'
  }
}

function sourceLabel(source: string): string {
  switch (source) {
    case 'llm': return 'LLM'
    case 'fallback': return 'Regex'
    case 'mock': return 'Mock'
    case 'user-edit': return 'User'
    default: return source
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

function clearAuditLog() {
  if (!confirm('确认清空所有审计日志?')) return
  intentLogger.clear()
  refreshAudit()
}

function exportAuditJson() {
  const data = JSON.stringify(intentLogger.readAll(), null, 2)
  const blob = new Blob([data], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `audit_${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
}

async function replayAuditEntry(entry: any) {
  if (!entry.intent) {
    alert('这条记录没有 Intent, 无法重放')
    return
  }
  showAudit.value = false
  await chat.replayIntent(entry.id)
}

// 监听 store turns, 自动 refresh
import { watch } from 'vue'
watch(() => chat.turns.length, () => {
  refreshAudit()
})
// 初始
refreshAudit()

const statusLabel = computed(() => {
  switch (chat.status) {
    case 'idle': return '🟢 就绪'
    case 'thinking': return '🧠 思考中...'
    case 'parsing': return '📋 解析中...'
    case 'executing': return '⚡ 执行中...'
    default: return ''
  }
})

const QUICK_ACTIONS = [
  { label: '🔥 消防栓', query: '所有消防栓' },
  { label: '🚪 所有门', query: '所有门' },
  { label: '🪟 所有窗', query: '所有窗户' },
  { label: '🏠 主视角', query: '__main_viewpoint__' },  // 走应用层逻辑
  { label: '📌 设为主视角', query: '__capture_main_viewpoint__' },  // 走应用层逻辑
  { label: '🧹 清高亮', query: '__clear_highlight__' },  // 走应用层逻辑
  { label: '👁 重置显示', query: '__reset_visibility__' },  // 走应用层逻辑
  { label: '⚙️ 设置', query: '__settings__' },  // 走应用层逻辑
]

async function send() {
  const q = input.value.trim()
  if (!q) return
  input.value = ''
  await chat.sendQuery(q)
}

/**
 * Quick Action handler
 *
 * 严格遵守 narrow waist 原则:
 *   - 应用层不能直接调 ssp-shim
 *   - 所有场景调用必须经过 templates 层
 *   - UI 控件通过特殊 query 字符串 (如 __clear_highlight__) 生成模板调用
 */
async function quickAction(action: typeof QUICK_ACTIONS[number]) {
  // ⚙️ 设置: 纯 UI 操作,不走 AI
  if (action.query === '__settings__') {
    showSettings.value = !showSettings.value
    return
  }
  // 系统 Quick Actions 强制走本地 fallback 规则，避免 LLM 改写模板名。
  // 仍然经过 AI planner → executor → template，不绕过 narrow waist。
  input.value = ''
  await chat.sendQuery(action.query, { forceFallback: action.query.startsWith('__') })
}

const showSettings = ref(false)

// 设置: 从 localStorage 读, 默认从 .env.local
const SETTINGS_KEY = 'ai_settings_v1'

interface AiSettings {
  model?: string        // 覆盖默认模型
  useMock?: boolean     // 强制 mock (跳过 LLM)
}

const settings = ref<AiSettings>(loadSettings())

function loadSettings(): AiSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return {}
}

function saveSettings(s: AiSettings) {
  settings.value = s
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch { /* ignore */ }
}

// API Key / Base URL 仅由开发代理读取，不进入浏览器或 localStorage。
const effectiveModel = computed(() =>
  settings.value.model || import.meta.env.VITE_LLM_MODEL || 'MiniMax-M3'
)
const useMock = computed(() => !!settings.value.useMock)

const modelName = computed(() => effectiveModel.value)

function applySettings() {
  saveSettings({
    model: settings.value.model,
    useMock: settings.value.useMock,
  })
  // 通知 store 重置 client
  chat.reloadLLMClient()
  closeSettings()
}

function closeSettings() {
  showSettings.value = false
}

function resetSettings() {
  if (!confirm('确认重置所有 AI 设置 (回到默认模型)?')) return
  localStorage.removeItem(SETTINGS_KEY)
  settings.value = {}
  chat.reloadLLMClient()
  closeSettings()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
}
</script>

<template>
  <div class="chat-panel" :class="{ collapsed: false }">
    <div class="chat-header">
      <span class="title">🤖 AI 助手</span>
      <span class="status">{{ statusLabel }}</span>
      <div class="actions">
        <button class="icon-btn" @click="showThinking = !showThinking" :title="showThinking ? '隐藏' : '显示' + 'thinking'">
          💭
        </button>
        <button class="icon-btn" @click="showAudit = !showAudit" title="审计日志">📋</button>
        <button class="icon-btn" @click="chat.clearChat()" title="清空对话">🧹</button>
      </div>
    </div>

    <!-- Quick Actions -->
    <div class="quick-actions">
      <button
        v-for="a in QUICK_ACTIONS"
        :key="a.label"
        class="quick-btn"
        @click="quickAction(a)"
      >{{ a.label }}</button>
    </div>

    <!-- 历史消息 -->
    <div class="messages">
      <div v-if="chat.turns.length === 0" class="empty">
        <p>输入查询开始对话</p>
        <p class="hint">试试: "A 楼 1 层有哪些消防栓?"</p>
      </div>

      <div
        v-for="(turn, i) in chat.turns"
        :key="i"
        class="message"
        :class="turn.role"
      >
        <div class="role">{{ turn.role === 'user' ? '👤 你' : '🤖 AI' }}</div>

        <div v-if="turn.role === 'user'" class="content">
          {{ turn.content }}
        </div>

        <div v-else class="content">
          <details v-if="turn.intent" class="intent-json">
            <summary>Intent JSON</summary>
            <pre>{{ JSON.stringify(turn.intent, null, 2) }}</pre>
          </details>

          <div v-if="turn.resultMessage" class="template-message">
            {{ turn.resultMessage }}
          </div>

          <details v-if="showThinking && chat.currentThinking" class="thinking">
            <summary>Thinking (流式)</summary>
            <pre>{{ chat.currentThinking }}</pre>
          </details>

          <details v-if="turn.resultSids && turn.resultSids.length > 0" class="results" open>
            <summary>结果（共 {{ turn.resultCount ?? turn.resultSids.length }} 个 mesh）</summary>
            <ul>
              <li v-for="sid in turn.resultSids.slice(0, 20)" :key="sid">
                <code>{{ sid }}</code>
              </li>
              <li
                v-if="(turn.resultCount ?? turn.resultSids.length) > Math.min(turn.resultSids.length, 20)"
                class="more"
              >
                +{{ (turn.resultCount ?? turn.resultSids.length) - Math.min(turn.resultSids.length, 20) }} 更多...
              </li>
            </ul>
          </details>

          <!-- 分组结果 (compare action 等) -->
          <details v-if="turn.resultGrouped && Object.keys(turn.resultGrouped).length > 0" class="results grouped" open>
            <summary>分组（{{ Object.keys(turn.resultGrouped).length }} 组，共 {{ turn.resultCount ?? 0 }} 个）</summary>
            <table class="grouped-table">
              <thead>
                <tr>
                  <th>分组</th>
                  <th>数量</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(sids, key) in turn.resultGrouped" :key="key">
                  <td><code>{{ key }}</code></td>
                  <td>{{ sids.length }}</td>
                </tr>
              </tbody>
            </table>
          </details>
        </div>
      </div>

      <div v-if="chat.isStreaming" class="message assistant streaming">
        <div class="role">🤖 AI</div>
        <div class="content">
          <span class="dot"></span>
          <span class="dot"></span>
          <span class="dot"></span>
          <span class="status-text">{{ statusLabel }}</span>
        </div>
      </div>
    </div>

    <!-- 错误提示 -->
    <div v-if="chat.lastError" class="error">
      ⚠️ {{ chat.lastError }}
    </div>

    <!-- 输入框 -->
    <div class="input-area">
      <textarea
        v-model="input"
        @keydown="onKeydown"
        placeholder="输入查询 (Enter 发送, Shift+Enter 换行)"
        rows="2"
      ></textarea>
      <button class="send-btn" @click="send" :disabled="chat.isStreaming">
        发送 ➤
      </button>
    </div>

    <!-- 审计日志弹窗 -->
    <div v-if="showAudit" class="audit-modal" @click.self="showAudit = false">
      <div class="audit-content audit-log-content">
        <h3>📋 审计日志</h3>
        <button class="close-btn" @click="showAudit = false">×</button>

        <div class="audit-toolbar">
          <span class="audit-count">共 {{ auditEntries.length }} 条</span>
          <div class="audit-actions">
            <button class="btn-mini" @click="exportAuditJson" title="导出 JSON">⬇ 导出</button>
            <button class="btn-mini btn-danger-mini" @click="clearAuditLog" title="清空">🗑</button>
          </div>
        </div>

        <div v-if="auditEntries.length === 0" class="audit-empty">
          <p>暂无审计日志</p>
          <p class="hint">每次 AI 调用都会记录在这里</p>
        </div>

        <div v-else class="audit-list">
          <div
            v-for="entry in auditEntries"
            :key="entry.id"
            class="audit-entry"
            :class="{ error: entry.errored, expanded: expandedAuditId === entry.id }"
          >
            <div class="audit-entry-header" @click="toggleAuditEntry(entry.id)">
              <div class="audit-entry-main">
                <span class="audit-icon">{{ iconForSource(entry.source) }}</span>
                <span class="audit-source">{{ sourceLabel(entry.source) }}</span>
                <span class="audit-time">{{ formatTime(entry.timestamp) }}</span>
                <span v-if="entry.errored" class="audit-badge error">ERR</span>
                <span v-else-if="entry.intent" class="audit-badge ok">{{ entry.intent.templateId }}</span>
              </div>
              <button class="btn-replay" @click.stop="replayAuditEntry(entry)" title="重放这条 Intent">
                ▶ 重放
              </button>
            </div>

            <div v-if="expandedAuditId === entry.id" class="audit-entry-body">
              <div class="audit-row">
                <span class="audit-row-key">query:</span>
                <code class="audit-row-val">{{ entry.query }}</code>
              </div>
              <div v-if="entry.intent" class="audit-row">
                <span class="audit-row-key">intent:</span>
                <pre class="audit-json">{{ JSON.stringify(entry.intent, null, 2) }}</pre>
              </div>
              <div v-if="entry.thinking" class="audit-row">
                <span class="audit-row-key">thinking:</span>
                <pre class="audit-thinking">{{ entry.thinking }}</pre>
              </div>
              <div v-if="entry.errorMsg" class="audit-row">
                <span class="audit-row-key">error:</span>
                <code class="audit-row-val error">{{ entry.errorMsg }}</code>
              </div>
              <div v-if="entry.durationMs" class="audit-row">
                <span class="audit-row-key">duration:</span>
                <code class="audit-row-val">{{ entry.durationMs.toFixed(0) }} ms</code>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 设置弹窗 -->
    <div v-if="showSettings" class="audit-modal" @click.self="closeSettings">
      <div class="audit-content settings-content">
        <h3>⚙️ AI 设置</h3>
        <button class="close-btn" @click="closeSettings">×</button>

        <div class="settings-section">
          <label class="settings-label">模型名</label>
          <input
            type="text"
            class="settings-input"
            v-model="settings.model"
            :placeholder="modelName"
          />
        </div>

        <div class="settings-section">
          <label class="settings-checkbox">
            <input type="checkbox" v-model="settings.useMock" />
            <span>强制 Mock 模式 (跳过 LLM, 用 regex)</span>
          </label>
          <p class="settings-hint">
            LLM 不可用时勾选. 走 fallbackRules 兜底.
          </p>
        </div>

        <div class="settings-current">
          <p><strong>当前生效:</strong></p>
          <p>代理: <code>/api/llm（凭据仅由开发代理读取）</code></p>
          <p>Model: <code>{{ modelName }}</code></p>
          <p>Mock: <code>{{ useMock ? '✅ 开启' : '关闭' }}</code></p>
        </div>

        <div class="settings-actions">
          <button class="btn-danger" @click="resetSettings">重置默认</button>
          <button class="btn-secondary" @click="closeSettings">取消</button>
          <button class="btn-primary" @click="applySettings">应用</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-panel {
  width: 400px;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #1a1a1a;
  color: #ddd;
  border-left: 1px solid #333;
  font-size: 13px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

.chat-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid #333;
  background: #222;
}

.title {
  font-weight: 600;
  flex: 1;
}

.status {
  font-size: 11px;
  color: #888;
}

.actions {
  display: flex;
  gap: 4px;
}

.icon-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 14px;
  padding: 4px;
  border-radius: 4px;
  transition: background 0.15s;
}

.icon-btn:hover {
  background: #333;
}

.quick-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 8px 12px;
  border-bottom: 1px solid #333;
  background: #1f1f1f;
}

.quick-btn {
  background: #2a2a2a;
  border: 1px solid #444;
  color: #ddd;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}

.quick-btn:hover {
  background: #333;
  border-color: #555;
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.empty {
  text-align: center;
  color: #666;
  margin-top: 40px;
}

.empty .hint {
  font-size: 11px;
  color: #555;
  margin-top: 8px;
  font-family: monospace;
}

.message {
  border-radius: 6px;
  padding: 8px 10px;
  background: #252525;
}

.message.user {
  background: #1a3a5c;
  border-left: 3px solid #4FC3F7;
}

.message.assistant {
  background: #2a2a3a;
  border-left: 3px solid #9575CD;
}

.message.streaming {
  background: #2a3a2a;
  border-left: 3px solid #4DB6AC;
}

.role {
  font-size: 10px;
  color: #888;
  margin-bottom: 4px;
}

.content {
  font-size: 13px;
  line-height: 1.5;
}

.content pre {
  background: #1a1a1a;
  padding: 6px;
  border-radius: 4px;
  font-size: 11px;
  overflow-x: auto;
  margin: 4px 0;
}

details.intent-json {
  margin-bottom: 4px;
}

details.intent-json summary {
  cursor: pointer;
  font-size: 11px;
  color: #9575CD;
  user-select: none;
}

details.thinking {
  margin-bottom: 4px;
}

details.thinking summary {
  cursor: pointer;
  font-size: 11px;
  color: #888;
  user-select: none;
}

details.results {
  margin-top: 4px;
}

details.results summary {
  cursor: pointer;
  font-size: 11px;
  color: #4DB6AC;
  user-select: none;
}

details.results ul {
  list-style: none;
  padding: 0;
  margin: 4px 0 0 0;
  font-size: 11px;
}

details.results code {
  background: #1a1a1a;
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 10px;
}

details.results .more {
  color: #666;
  font-style: italic;
  margin-top: 2px;
}

.grouped-table {
  width: 100%;
  margin-top: 6px;
  font-size: 10px;
  border-collapse: collapse;
}

.grouped-table th,
.grouped-table td {
  padding: 3px 6px;
  border-bottom: 1px solid #2a2a35;
  text-align: left;
}

.grouped-table th {
  color: #4FC3F7;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.grouped-table td code {
  background: #1a1a1a;
  padding: 1px 4px;
  border-radius: 3px;
  color: #ddd;
}

.dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-right: 4px;
  border-radius: 50%;
  background: #4DB6AC;
  animation: pulse 1.2s ease-in-out infinite;
}

.dot:nth-child(2) { animation-delay: 0.2s; }
.dot:nth-child(3) { animation-delay: 0.4s; }

@keyframes pulse {
  0%, 100% { opacity: 0.3; transform: scale(0.8); }
  50% { opacity: 1; transform: scale(1); }
}

.status-text {
  font-size: 11px;
  color: #888;
  margin-left: 4px;
}

.error {
  background: #3a1a1a;
  border-left: 3px solid #FF5252;
  padding: 8px 12px;
  margin: 0 12px 8px 12px;
  border-radius: 4px;
  font-size: 11px;
  color: #ff8888;
  white-space: pre-wrap;
  max-height: 100px;
  overflow-y: auto;
}

.input-area {
  padding: 12px;
  border-top: 1px solid #333;
  display: flex;
  gap: 8px;
  background: #1f1f1f;
}

.input-area textarea {
  flex: 1;
  background: #2a2a2a;
  border: 1px solid #444;
  color: #ddd;
  padding: 6px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-family: inherit;
  resize: none;
  outline: none;
}

.input-area textarea:focus {
  border-color: #4FC3F7;
}

.send-btn {
  background: #4FC3F7;
  color: #000;
  border: none;
  padding: 6px 14px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
}

.send-btn:hover:not(:disabled) {
  background: #29B6F6;
}

.send-btn:disabled {
  background: #444;
  color: #888;
  cursor: not-allowed;
}

.audit-modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.audit-content {
  background: #1a1a1a;
  border: 1px solid #444;
  border-radius: 8px;
  padding: 20px;
  min-width: 400px;
  position: relative;
}

.settings-content {
  min-width: 480px;
  max-width: 560px;
}

.settings-section {
  margin-bottom: 16px;
}

.settings-label {
  display: block;
  font-size: 11px;
  color: #aaa;
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.settings-input {
  width: 100%;
  background: #0e0e14;
  border: 1px solid #333;
  color: #ddd;
  padding: 6px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  outline: none;
}

.settings-input:focus {
  border-color: #4FC3F7;
}

.settings-hint {
  font-size: 10px;
  color: #666;
  margin: 4px 0 0 0;
}

.settings-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 12px;
  color: #ddd;
}

.settings-checkbox input {
  cursor: pointer;
}

.settings-current {
  background: #0e0e14;
  border: 1px solid #2a2a35;
  border-radius: 4px;
  padding: 10px 12px;
  margin-bottom: 16px;
  font-size: 11px;
}

.settings-current p {
  margin: 4px 0;
  color: #888;
}

.settings-current p strong {
  color: #4FC3F7;
  display: block;
  margin-bottom: 6px;
}

.settings-current code {
  background: #1a1a1a;
  padding: 1px 4px;
  border-radius: 3px;
  color: #ddd;
}

.settings-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.btn-primary,
.btn-secondary,
.btn-danger {
  border: none;
  padding: 6px 14px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  font-weight: 500;
}

.btn-primary {
  background: #4FC3F7;
  color: #000;
}

.btn-primary:hover {
  background: #29B6F6;
}

.btn-secondary {
  background: #333;
  color: #ddd;
}

.btn-secondary:hover {
  background: #444;
}

.btn-danger {
  background: transparent;
  border: 1px solid #FF5252;
  color: #FF5252;
  margin-right: auto;
}

.btn-danger:hover {
  background: rgba(255, 82, 82, 0.1);
}

/* ===== Audit Log ===== */
.audit-log-content {
  width: 600px;
  max-width: 90vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}

.audit-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid #2a2a35;
}

.audit-count {
  font-size: 11px;
  color: #888;
}

.audit-actions {
  display: flex;
  gap: 4px;
}

.btn-mini {
  background: #2a2a35;
  border: 1px solid #444;
  color: #ddd;
  padding: 3px 8px;
  border-radius: 3px;
  font-size: 11px;
  cursor: pointer;
}

.btn-mini:hover {
  background: #3a3a45;
}

.btn-danger-mini {
  border-color: #FF5252;
  color: #FF5252;
}

.btn-danger-mini:hover {
  background: rgba(255, 82, 82, 0.1);
}

.audit-empty {
  text-align: center;
  color: #666;
  padding: 40px 20px;
}

.audit-empty .hint {
  font-size: 11px;
  color: #555;
  margin-top: 6px;
}

.audit-list {
  overflow-y: auto;
  max-height: 60vh;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.audit-entry {
  background: #0e0e14;
  border: 1px solid #2a2a35;
  border-radius: 4px;
  overflow: hidden;
}

.audit-entry.error {
  border-color: #FF5252;
}

.audit-entry.expanded {
  background: #15151c;
}

.audit-entry-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  cursor: pointer;
  font-size: 11px;
}

.audit-entry-header:hover {
  background: #1a1a24;
}

.audit-entry-main {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.audit-icon {
  font-size: 12px;
}

.audit-source {
  color: #4FC3F7;
  font-weight: 600;
  font-size: 11px;
  min-width: 50px;
}

.audit-time {
  color: #666;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 10px;
}

.audit-badge {
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
}

.audit-badge.ok {
  background: #4DB6AC;
  color: #000;
}

.audit-badge.error {
  background: #FF5252;
  color: #fff;
}

.btn-replay {
  background: transparent;
  border: 1px solid #4DB6AC;
  color: #4DB6AC;
  padding: 2px 8px;
  border-radius: 3px;
  font-size: 10px;
  cursor: pointer;
  flex-shrink: 0;
}

.btn-replay:hover {
  background: rgba(77, 182, 172, 0.15);
}

.audit-entry-body {
  padding: 8px 12px;
  border-top: 1px solid #2a2a35;
  font-size: 11px;
}

.audit-row {
  margin-bottom: 6px;
}

.audit-row-key {
  display: inline-block;
  color: #888;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-right: 6px;
  min-width: 60px;
}

.audit-row-val {
  color: #ddd;
  background: #1a1a1a;
  padding: 1px 4px;
  border-radius: 3px;
}

.audit-row-val.error {
  color: #FF5252;
  background: rgba(255, 82, 82, 0.1);
}

.audit-json {
  background: #1a1a1a;
  padding: 6px;
  border-radius: 3px;
  font-size: 10px;
  margin: 4px 0 0 0;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 200px;
  overflow-y: auto;
}

.audit-thinking {
  background: #1a1a1a;
  padding: 6px;
  border-radius: 3px;
  font-size: 10px;
  margin: 4px 0 0 0;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 200px;
  overflow-y: auto;
  color: #888;
  font-style: italic;
}

.audit-content h3 {
  margin-top: 0;
  font-size: 14px;
}

.close-btn {
  position: absolute;
  top: 8px;
  right: 12px;
  background: transparent;
  border: none;
  color: #888;
  font-size: 20px;
  cursor: pointer;
}
</style>
