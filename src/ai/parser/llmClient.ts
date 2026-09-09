/**
 * llmClient —— 浏览器侧 LLM client
 *
 * 浏览器只向同源 /api/llm 发请求；模型供应商 URL 与 API Key 只存在于代理服务器。
 * 因此不能在这里读取 VITE_LLM_API_KEY，也不能把 key 写入 localStorage。
 */

const LLM_TIMEOUT_MS = 15_000
const SETTINGS_KEY = 'ai_settings_v1'
const LLM_RUNTIME_ENABLED = import.meta.env.DEV || import.meta.env.VITE_LLM_ENABLED === 'true'

interface AiSettings {
  model?: string
  useMock?: boolean
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>
}

interface StreamChunk {
  choices?: Array<{ delta?: { content?: string | null } }>
}

function loadSettings(): AiSettings {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SETTINGS_KEY) : null
    if (raw) return JSON.parse(raw)
  } catch { /* ignore malformed legacy settings */ }
  return {}
}

function getEffectiveModel(): string {
  return loadSettings().model || import.meta.env.VITE_LLM_MODEL || 'MiniMax-M3'
}

function isMockEnabled(): boolean {
  return !!loadSettings().useMock
}

function makePayload(systemPrompt: string, userPrompt: string, opts: { model?: string; temperature?: number; stream?: boolean }) {
  return {
    model: opts.model ?? getEffectiveModel(),
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: opts.temperature ?? 0,
    response_format: { type: 'json_object' },
    ...(opts.stream ? { stream: true } : {}),
  }
}

async function requestCompletion(
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Response> {
  if (!LLM_RUNTIME_ENABLED) {
    throw new Error('在线 AI 尚未在安全入口启用')
  }
  const response = await fetch('/api/llm/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500)
    throw new Error(`LLM 请求失败 (${response.status}): ${detail || response.statusText}`)
  }
  return response
}

/** 兼容旧调用点；client 不再缓存敏感配置，因此无需重建。 */
export function reloadLLMClient(): void {}

/** 调 LLM 返回完整内容（非 streaming）。 */
export async function callLLM(
  systemPrompt: string,
  userPrompt: string,
  opts: { model?: string; temperature?: number; signal?: AbortSignal } = {},
): Promise<string> {
  if (isMockEnabled()) throw new Error('Mock 模式已开启, 跳过 LLM 调用')

  const timeout = AbortSignal.timeout(LLM_TIMEOUT_MS)
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout
  const response = await requestCompletion(makePayload(systemPrompt, userPrompt, opts), signal)
  const data = await response.json() as ChatCompletionResponse
  const content = data.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content) throw new Error('LLM 返回内容为空')
  return content
}

/** Streaming 版本：解析 OpenAI-compatible SSE。 */
export async function* streamLLM(
  systemPrompt: string,
  userPrompt: string,
  opts: { model?: string; temperature?: number; signal?: AbortSignal } = {},
): AsyncGenerator<{ type: 'delta' | 'done' | 'error'; content: string }> {
  if (isMockEnabled()) {
    yield { type: 'error', content: 'Mock 模式已开启' }
    return
  }

  try {
    const timeout = AbortSignal.timeout(LLM_TIMEOUT_MS)
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout
    const response = await requestCompletion(makePayload(systemPrompt, userPrompt, { ...opts, stream: true }), signal)
    if (!response.body) throw new Error('LLM streaming 响应没有 body')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      const events = buffer.split(/\r?\n\r?\n/)
      buffer = events.pop() ?? ''
      for (const event of events) {
        const data = event.split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('\n')
        if (!data) continue
        if (data === '[DONE]') {
          yield { type: 'done', content: '' }
          return
        }
        const chunk = JSON.parse(data) as StreamChunk
        const content = chunk.choices?.[0]?.delta?.content
        if (content) yield { type: 'delta', content }
      }
      if (done) break
    }
    yield { type: 'done', content: '' }
  } catch (err) {
    yield { type: 'error', content: err instanceof Error ? err.message : String(err) }
  }
}

/** 测试用：检查同源代理是否可达。 */
export async function pingLLM(): Promise<{ ok: boolean; error?: string }> {
  if (!LLM_RUNTIME_ENABLED) return { ok: false, error: '在线 AI 尚未在安全入口启用' }
  if (isMockEnabled()) return { ok: false, error: 'Mock 模式已开启' }
  try {
    await callLLM('You are a helpful assistant.', 'Reply with only the JSON {"ok": true}', { temperature: 0 })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export const llmConfig = {
  get model() { return getEffectiveModel() },
  get isMock() { return isMockEnabled() },
  // 浏览器无法安全探测服务端密钥；实际可用性由 pingLLM/requestCompletion 返回。
  get isConfigured() { return LLM_RUNTIME_ENABLED },
  reload: reloadLLMClient,
}
