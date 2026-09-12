/**
 * llmClient —— 浏览器侧 LLM client
 *
 * 浏览器只向当前 Vite BASE_URL 下的同源 API 发请求；模型供应商 URL 与 API Key 只存在于代理服务器。
 * 因此不能在这里读取 VITE_LLM_API_KEY，也不能把 key 写入 localStorage。
 */

const LLM_TIMEOUT_MS = 28_000
const MAX_ERROR_DETAIL_BYTES = 512
const MAX_ERROR_DETAIL_CHARS = 500
const PRODUCTION_MODEL = 'MiniMax-M3'
const SETTINGS_KEY = 'ai_settings_v1'
const LLM_RUNTIME_ENABLED = import.meta.env.DEV || import.meta.env.VITE_LLM_ENABLED === 'true'
const LLM_API_PATH = resolveLlmApiPath(import.meta.env.BASE_URL)

interface AiSettings {
  model?: string
  useMock?: boolean
}

interface ChatCompletionResponse {
  choices?: Array<{
    finish_reason?: string | null
    message?: { content?: string | null }
  }>
}

interface StreamChunk {
  choices?: Array<{
    delta?: { content?: string | null }
    finish_reason?: string | null
  }>
}

function loadSettings(): AiSettings {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SETTINGS_KEY) : null
    if (raw) return JSON.parse(raw)
  } catch { /* ignore malformed legacy settings */ }
  return {}
}

function getEffectiveModel(): string {
  if (import.meta.env.PROD) return PRODUCTION_MODEL
  return loadSettings().model || import.meta.env.VITE_LLM_MODEL || 'MiniMax-M3'
}

function isMockEnabled(): boolean {
  return !!loadSettings().useMock
}

function makePayload(systemPrompt: string, userPrompt: string, opts: { model?: string; temperature?: number; stream?: boolean }) {
  return {
    model: import.meta.env.PROD ? PRODUCTION_MODEL : (opts.model ?? getEffectiveModel()),
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: opts.temperature ?? 0,
    response_format: { type: 'json_object' },
    ...(opts.stream ? { stream: true } : {}),
  }
}

export function resolveLlmApiPath(baseUrl: string): string {
  if (!baseUrl.startsWith('/')
    || baseUrl.startsWith('//')
    || /[?#%\\]/.test(baseUrl)
    || !/^\/[A-Za-z0-9._~/-]*$/.test(baseUrl)) {
    throw new Error('Vite BASE_URL 必须是同源绝对路径')
  }
  const normalized = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  const segments = normalized.split('/').filter(Boolean)
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error('Vite BASE_URL 不得包含路径穿越')
  }
  return `${normalized}api/llm/chat/completions`
}

async function readErrorDetail(response: Response): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (size < MAX_ERROR_DETAIL_BYTES) {
    const { done, value } = await reader.read()
    if (done) break
    const remaining = MAX_ERROR_DETAIL_BYTES - size
    const accepted = value.byteLength > remaining ? value.subarray(0, remaining) : value
    chunks.push(accepted)
    size += accepted.byteLength
    if (accepted.byteLength < value.byteLength || size >= MAX_ERROR_DETAIL_BYTES) {
      await reader.cancel().catch(() => {})
      break
    }
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes).slice(0, MAX_ERROR_DETAIL_CHARS)
}

async function requestCompletion(
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Response> {
  if (!LLM_RUNTIME_ENABLED) {
    throw new Error('在线 AI 尚未在安全入口启用')
  }
  const response = await fetch(LLM_API_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok) {
    const detail = await readErrorDetail(response)
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
  const choice = data.choices?.[0]
  if (choice?.finish_reason === 'length') throw new Error('LLM 输出达到长度上限，结果不完整')
  const content = choice?.message?.content
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

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let completed = false
  try {
    const timeout = AbortSignal.timeout(LLM_TIMEOUT_MS)
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout
    const response = await requestCompletion(makePayload(systemPrompt, userPrompt, { ...opts, stream: true }), signal)
    if (!response.body) throw new Error('LLM streaming 响应没有 body')

    reader = response.body.getReader()
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
          completed = true
          yield { type: 'done', content: '' }
          return
        }
        const chunk = JSON.parse(data) as StreamChunk
        const choice = chunk.choices?.[0]
        if (choice?.finish_reason === 'length') {
          throw new Error('LLM 输出达到长度上限，结果不完整')
        }
        const content = choice?.delta?.content
        if (content) yield { type: 'delta', content }
      }
      if (done) throw new Error('LLM streaming 响应未正常结束')
    }
  } catch (err) {
    yield { type: 'error', content: err instanceof Error ? err.message : String(err) }
  } finally {
    if (reader && !completed) await reader.cancel().catch(() => {})
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
