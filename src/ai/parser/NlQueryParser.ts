/**
 * NlQueryParser —— LLM 调用的主入口
 *
 * 流程:
 *   1. 组装 3 层 prompt
 *   2. 调 LLM
 *   3. 删 <think>...</think> 块 (MiniMax-M3 的思维链)
 *   4. 3 级 JSON fallback (借鉴你的 llm-adapter.js 实现)
 *   5. Zod 验证
 *   6. 返回 Intent + 原始 thinking
 */

import { callLLM } from './llmClient'
import { buildSystemPrompt, buildVolatilePrompt, type VolatileContext } from './prompts'
import { parseIntent, type Intent } from '../types/Intent'

export interface ParseResult {
  intent: Intent
  rawContent: string       // LLM 原始返回 (含 thinking)
  thinking: string         // 提取的 thinking (可能为空)
  jsonText: string         // 提取的 JSON 文本
  /** 重试次数 (0=一次成功, 1=第二次成功) */
  retries: number
}

/** 删 <think>...</think> 块 (MiniMax-M3 风格) */
function stripThinking(content: string): { thinking: string; cleaned: string } {
  const thinkingMatch = content.match(/<think\b[^>]*>([\s\S]*?)<\/think>/gi)
  if (!thinkingMatch) {
    return { thinking: '', cleaned: content }
  }
  const thinking = thinkingMatch.map(m => m.replace(/<\/?think[^>]*>/gi, '')).join('\n')
  const cleaned = content.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '').trim()
  return { thinking, cleaned }
}

/** 3 级 JSON 提取 (借鉴 llm-adapter.js) */
function extractJson(text: string): unknown | null {
  // 1) 整体解析
  try {
    return JSON.parse(text)
  } catch { /* continue */ }

  // 2) ```json ... ``` 块
  const codeBlock = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/)
  if (codeBlock) {
    try {
      return JSON.parse(codeBlock[1])
    } catch { /* continue */ }
  }

  // 3) 首个 JSON 对象 (宽松)
  const firstJson = text.match(/\{[\s\S]*\}/)
  if (firstJson) {
    try {
      return JSON.parse(firstJson[0])
    } catch { /* continue */ }
  }

  return null
}

/** 调 LLM 解析 query, 含 1 次重试 */
export async function parseQuery(
  volatileCtx: VolatileContext,
  activeFloors: string[] = [],
  opts: {
    signal?: AbortSignal
    /** 最大重试次数 (默认 1) */
    maxRetries?: number
  } = {}
): Promise<ParseResult> {
  const maxRetries = opts.maxRetries ?? 1
  const systemPrompt = buildSystemPrompt(activeFloors)
  const userPrompt = buildVolatilePrompt(volatileCtx)

  let lastError: Error | null = null
  let lastContent = ''

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const content = await callLLM(systemPrompt, userPrompt, {
        signal: opts.signal,
      })
      lastContent = content

      // 删 thinking
      const { thinking, cleaned } = stripThinking(content)

      // 提取 JSON
      const raw = extractJson(cleaned)
      if (!raw) {
        throw new Error('LLM 未返回 JSON')
      }

      // Zod 验证
      const intent = parseIntent(raw)

      return {
        intent,
        rawContent: content,
        thinking,
        jsonText: cleaned,
        retries: attempt,
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      // 继续重试 (除非是用户取消)
      if (opts.signal?.aborted) throw lastError
    }
  }

  throw new Error(
    `LLM 解析失败 (重试 ${maxRetries} 次): ${lastError?.message || '未知错误'}\n` +
    `原始内容: ${lastContent.slice(0, 300)}`
  )
}

/** 直接验证 + 解析 (用户手动改 Intent JSON 时用) */
export function parseRawIntent(text: string): Intent {
  const { cleaned } = stripThinking(text)
  const raw = extractJson(cleaned)
  if (!raw) throw new Error('无法从文本提取 JSON')
  return parseIntent(raw)
}