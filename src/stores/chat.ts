/**
 * chatStore —— Pinia 状态管理
 *
 * 职责:
 *   - 维护 ChatContext (多轮)
 *   - 暴露 sendQuery() 给 ChatPanel UI
 *   - 暴露 isStreaming, currentThinking, lastError 等状态
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { chatContext, type ChatTurn } from '@/ai/context/chatContext'
import { parseQuery, parseRawIntent } from '@/ai/parser/NlQueryParser'
import { planIntent, type Plan } from '@/ai/planner/IntentPlanner'
import { executePlan, type ExecutionResult } from '@/ai/executor/PlanExecutor'
import {
  fallbackParse,
  isFloorCollapseQuery,
  isFloorVisibilityQuery,
  isVisibilityUndoQuery,
} from '@/ai/rules/fallbackRules'
import { intentLogger } from '@/ai/audit/IntentLogger'
import { reloadLLMClient as reloadLLMClientFn } from '@/ai/parser/llmClient'
import { intentCache } from '@/ai/parser/intentCache'
import {
  createTemplateIntent,
  parseIntent,
  type Intent,
  type QueryOperation,
  type QuerySceneParams,
} from '@/ai/types/Intent'
import {
  executeHostTemplateAction,
  getVisibilityUndoState,
  invalidateVisibilityUndo as invalidateVisibilityUndoTransaction,
} from '@/templates/hostActions'
import type {
  VisibilityUndoOperation,
  VisibilityUndoReceipt,
  VisibilityUndoState,
} from '@/adapters/visibilityUndo'

export type StreamStatus = 'idle' | 'thinking' | 'parsing' | 'executing'

export const useChatStore = defineStore('chat', () => {
  // 暴露 turns (computed)
  const turns = computed<ChatTurn[]>(() => chatContext.turns)

  // 状态
  const isStreaming = ref(false)
  const status = ref<StreamStatus>('idle')
  const currentThinking = ref('')
  const currentRawContent = ref('')
  const lastIntent = ref<Intent | null>(null)
  const lastResult = ref<ExecutionResult | null>(null)
  const lastError = ref<string | null>(null)
  const visibilityUndoState = ref<VisibilityUndoState>(getVisibilityUndoState())
  const visibilityNotice = ref<string | null>(null)
  const canUndoVisibility = computed(() => visibilityUndoState.value.canUndo)
  /**
   * 主视角 (用户主动设置或场景加载完自动设置).
   * 应用层控制,不走 ssp-shim 内部 mainViewpoint.
   * null = 还没设置过 → "主视角" 应走 fitScene.
   */
  const mainViewpoint = ref<{
    position: { x: number; y: number; z: number }
    target: { x: number; y: number; z: number }
    fov?: number
  } | null>(null)

  /** 解析用户 query + 执行 */
  async function sendQuery(rawQuery: string, opts: {
    /** mock 模式 (LLM 不可用时强制用 regex) */
    forceFallback?: boolean
    /** 直接传入 Intent (用户手动改的 JSON) */
    overrideIntent?: Intent
    /** 内部调用,跳过 push user turn (UI 不显示, audit 不记 user 消息) */
    internal?: boolean
  } = {}): Promise<void> {
    if (!rawQuery.trim()) return

    const isHostVisibilityUndo = !opts.overrideIntent && !opts.internal && isVisibilityUndoQuery(rawQuery)
    lastError.value = null
    if (!visibilityUndoState.value.canUndo) visibilityNotice.value = null
    isStreaming.value = true
    status.value = 'thinking'

    // 1. 记录 user turn (内部调用不记)
    if (!opts.internal) {
      const userTurn: ChatTurn = {
        role: 'user',
        content: rawQuery,
        ...(isHostVisibilityUndo ? { llmVisible: false } : {}),
        timestamp: Date.now(),
      }
      chatContext.push(userTurn)
    }

    const t0 = performance.now()

    try {
      // Visibility undo is a host-only command. It must not be represented as
      // an Intent or sent through the LLM/Planner/AI catalog. The same helper
      // is used by the top undo button below, preserving failure semantics.
      if (isHostVisibilityUndo) {
        status.value = 'executing'
        const command = await executeVisibilityUndoCommand()
        if (!opts.internal) {
          chatContext.push({
            role: 'assistant',
            content: command.message,
            llmVisible: false,
            resultMessage: command.message,
            resultData: command.receipt,
            timestamp: Date.now(),
          })
        }
        intentLogger.log({
          query: rawQuery,
          intent: undefined,
          rawContent: '',
          thinking: '(确定性宿主撤回，跳过 LLM/Intent/Planner)',
          source: 'fallback',
          errored: command.errored,
          ...(command.errored ? { errorMsg: command.message } : {}),
          durationMs: performance.now() - t0,
        })
        return
      }

      let intent: Intent
      let source: 'llm' | 'fallback' | 'mock' | 'user-edit'
      let thinking = ''
      let rawContent = ''

      // 应用内部命令和结构明确的楼层导航必须确定性路由，避免 LLM
      // 把“飞到 A 楼 6 层”误判为 flyToMainViewpoint。路由结果仍是模板调用。
      const isInternalCommand = /^__[a-z0-9_]+__$/i.test(rawQuery)
      const isFloorNavigation = /飞(?:到|去)\s*[ABC]\s*[栋楼#]?\s*\d+\s*(?:F|层|楼)/i.test(rawQuery)
      const isFloorVisibility = isFloorVisibilityQuery(rawQuery)
      const isFloorCollapse = isFloorCollapseQuery(rawQuery)
      const isFloorCount = /(?:每栋|每楼|所有|总共|一共|有|共).*多少\s*(?:层|楼层)/i.test(rawQuery)
      const groupFloorsByBuilding = /每栋|每楼|所有/i.test(rawQuery)
      const deterministicIntent = opts.overrideIntent
        ? null
        : isFloorCount
          ? createTemplateIntent('query-scene', {
              entity: 'floor',
              operation: 'count',
              ...(groupFloorsByBuilding
                ? { groupBy: 'building', output: { format: 'table' } }
                : {}),
            })
          : (isInternalCommand || isFloorNavigation || isFloorVisibility || isFloorCollapse)
            ? fallbackParse(rawQuery)
            : null

      if (opts.overrideIntent) {
        // Internal/manual/replay calls must pass the same registry validation as LLM output.
        intent = parseIntent(opts.overrideIntent)
        source = 'user-edit'
      } else if (deterministicIntent) {
        intent = deterministicIntent
        source = 'fallback'
        thinking = rawQuery.startsWith('__')
          ? '(系统指令，跳过 LLM)'
          : '(确定性模板路由，跳过 LLM)'
      } else if (opts.forceFallback) {
        // 强制 mock 模式
        const fb = fallbackParse(rawQuery)
        if (!fb) throw new Error('mock 模式无法识别 query')
        intent = fb
        source = 'mock'
      } else {
        // 先查缓存
        const cached = intentCache.get(rawQuery)
        if (cached) {
          intent = cached
          source = 'fallback'  // 标记 (实际来源可能是 LLM, 但走缓存)
          thinking = '(命中缓存, 跳过 LLM)'
        } else {
          // 调 LLM
          status.value = 'thinking'
          try {
            const result = await parseQuery({
              history: chatContext.getHistoryForLLM().slice(0, -1),  // 排除刚加的 user
              currentQuery: rawQuery,
              now: new Date().toISOString().slice(0, 16).replace('T', ' '),
            })
            intent = result.intent
            // 缓存成功的 Intent
            intentCache.set(rawQuery, intent, 'llm')
            thinking = result.thinking
            rawContent = result.rawContent
            currentThinking.value = thinking
            currentRawContent.value = rawContent
            source = 'llm'
          } catch (err) {
            // LLM 失败 → fallback
            const fb = fallbackParse(rawQuery)
            if (!fb) throw err  // fallback 也失败, 抛错
            intent = fb
            intentCache.set(rawQuery, intent, 'fallback')
            source = 'fallback'
          }
        }

      }

      // 所有自然语言来源都按当前会话重新补全上下文。
      // 缓存中保留的是补全前 Intent，因此同一句“恢复1F”不会从 A 楼串到 B 楼。
      // 手工 override / replay / internal 是明确调用，必须保持原样。
      if (!opts.overrideIntent && !opts.internal && !isInternalCommand) {
        intent = chatContext.applyInheritance(intent, rawQuery)
      }

      status.value = 'parsing'
      lastIntent.value = intent

      const operation = querySceneOperation(intent)

      // 2. 记录 Intent (assistant turn)
      const assistantTurn: ChatTurn = {
        role: 'assistant',
        content: formatIntentSummary(intent),
        intent,
        timestamp: Date.now(),
      }
      if (!opts.internal) chatContext.push(assistantTurn)

      // 3. 规划 + 执行
      status.value = 'executing'
      const plan: Plan = planIntent(intent)
      const result = await executePlan(plan)
      lastResult.value = result
      assistantTurn.resultSids = result.sids
      assistantTurn.resultCount = result.count
      assistantTurn.resultGrouped = result.grouped
      assistantTurn.resultMessage = result.message
      assistantTurn.resultData = result.data

      if (intent.templateId === 'resetVisibility') {
        invalidateVisibilityUndoTransaction()
        refreshVisibilityUndoState()
        visibilityNotice.value = '已全部显示；该全局恢复操作不会生成撤回记录'
      } else if (isVisibilityUndoOperation(operation)) {
        refreshVisibilityUndoState()
        visibilityNotice.value = visibilityUndoState.value.canUndo
          ? `可撤回：上一步${visibilityOperationLabel(visibilityUndoState.value.operation)}（改变 ${visibilityUndoState.value.changedCount} 个对象）`
          : null
      }

      // 4. audit
      intentLogger.log({
        query: rawQuery,
        intent,
        rawContent,
        thinking,
        source,
        errored: false,
        durationMs: performance.now() - t0,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      lastError.value = msg
      intentLogger.log({
        query: rawQuery,
        intent: undefined,
        source: 'llm',
        errored: true,
        errorMsg: msg,
        durationMs: performance.now() - t0,
      })
      if (opts.internal) throw err
    } finally {
      status.value = 'idle'
      isStreaming.value = false
      currentThinking.value = ''
    }
  }

  /** 用户从 audit UI 重放 Intent */
  async function replayIntent(intentId: string): Promise<void> {
    const entry = intentLogger.findById(intentId)
    if (!entry || !entry.intent) {
      lastError.value = '未找到该 Intent'
      return
    }
    await sendQuery(`[replay] ${entry.query}`, { overrideIntent: entry.intent })
  }

  /** 用户手动改 Intent JSON */
  async function executeRawIntent(rawText: string, query: string): Promise<void> {
    try {
      const intent = parseRawIntent(rawText)
      await sendQuery(query, { overrideIntent: intent })
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err)
    }
  }

  /** 重新加载 LLM client (设置改了之后) */
  function reloadLLMClient(): void {
    reloadLLMClientFn()
  }

  async function undoLastVisibility(): Promise<void> {
    if (isStreaming.value) return
    lastError.value = null
    isStreaming.value = true
    status.value = 'executing'
    try {
      await executeVisibilityUndoCommand()
    } finally {
      status.value = 'idle'
      isStreaming.value = false
    }
  }

  /** Scene/model lifecycle hook; clearing chat intentionally does not call it. */
  function invalidateVisibilityUndo(): void {
    invalidateVisibilityUndoTransaction()
    refreshVisibilityUndoState()
    visibilityNotice.value = null
  }

  function refreshVisibilityUndoState(): void {
    visibilityUndoState.value = getVisibilityUndoState()
  }

  async function executeVisibilityUndoCommand(): Promise<{
    receipt: VisibilityUndoReceipt | null
    message: string
    errored: boolean
  }> {
    try {
      const receipt = await executeHostTemplateAction('undoVisibility') as VisibilityUndoReceipt
      refreshVisibilityUndoState()
      if (!receipt.undone) {
        visibilityNotice.value = null
        const message = visibilityUndoFailureMessage(receipt.reason)
        lastError.value = message
        return { receipt, message, errored: true }
      }
      const message = `已撤回${visibilityOperationLabel(receipt.operation)}，精确恢复 ${receipt.changedCount} 个对象`
      lastError.value = null
      visibilityNotice.value = message
      return { receipt, message, errored: false }
    } catch (error) {
      refreshVisibilityUndoState()
      const message = error instanceof Error ? error.message : String(error)
      lastError.value = message
      visibilityNotice.value = null
      return { receipt: null, message, errored: true }
    }
  }

  /** 应用层调用 — fit scene 到当前加载的 meshes.
   *
   * narrow waist: 应用层不直接调 ssp.
   * AI 层暴露这个 API,内部走 executor → template → ssp-shim.
   *
   * 用法: 应用层 (HomeView / SandboxView) 模型加载完调一下.
   */
  async function fitScene(view: 'iso' | 'front' | 'top' | 'side' = 'iso'): Promise<void> {
    // 走 AI 层 — 通过 sendQuery('__fit_scene__') 触发
    // AI/application only creates a template call; TemplateRuntime owns SSP access.
    await sendQuery('__fit_scene__', {
      internal: true,  // 不显示在 chat UI 里
      overrideIntent: {
        action: 'template',
        templateId: 'fitScene',
        // 场景加载完成后直接就位，避免路由切换时动画 Promise 悬挂。
        params: { view, animate: false },
      },
    })
  }

  /** 清空对话 */
  function clearChat(): void {
    chatContext.clear()
    lastIntent.value = null
    lastResult.value = null
    lastError.value = null
    intentCache.clear()
  }

  // ⚠️ narrow waist: 把 store 暴露给 window, 方便 executor 间接调用
  // (避免 executor → chat store → sendQuery 的循环依赖)
  if (typeof window !== 'undefined') {
    ;(window as any).__chatStore = {
      get mainViewpoint() { return mainViewpoint.value },
      set mainViewpoint(v) { mainViewpoint.value = v },
    }
  }

  return {
    // state
    turns,
    isStreaming,
    status,
    currentThinking,
    currentRawContent,
    lastIntent,
    lastResult,
    lastError,
    visibilityUndoState,
    visibilityNotice,
    canUndoVisibility,
    mainViewpoint,
    // actions
    sendQuery,
    replayIntent,
    executeRawIntent,
    reloadLLMClient,
    undoLastVisibility,
    invalidateVisibilityUndo,
    fitScene,
    clearChat,
  }
})

function formatIntentSummary(intent: Intent): string {
  return JSON.stringify(intent, null, 2)
}

function querySceneOperation(intent: Intent): QueryOperation | null {
  if (intent.templateId !== 'query-scene') return null
  const operation = (intent.params as QuerySceneParams).operation
  return typeof operation === 'string' ? operation : null
}

function isVisibilityUndoOperation(
  operation: QueryOperation | null,
): operation is VisibilityUndoOperation {
  return operation === 'hide' || operation === 'show' || operation === 'isolate'
}

function visibilityOperationLabel(operation: VisibilityUndoOperation | null): string {
  switch (operation) {
    case 'hide': return '隐藏'
    case 'show': return '显示'
    case 'isolate': return '隔离'
    default: return '显示操作'
  }
}

function visibilityUndoFailureMessage(reason: VisibilityUndoReceipt['reason']): string {
  switch (reason) {
    case 'no-transaction': return '当前没有可撤回的显示操作'
    case 'no-scene':
    case 'scene-mismatch':
    case 'generation-mismatch': return '场景已经切换或重载，本次撤回已失效'
    case 'detached': return '部分对象已离开当前场景，本次撤回已安全拒绝'
    case 'after-conflict': return '对象可见性已被后续操作修改，本次撤回已安全拒绝'
    case 'undo-failed': return '撤回执行失败，场景已恢复到撤回前状态'
    case 'rollback-failed': return '撤回失败且补偿不完整，请使用“全部显示”恢复场景'
    default: return '撤回未执行'
  }
}
