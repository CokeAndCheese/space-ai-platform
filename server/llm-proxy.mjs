import http from 'node:http'
import { pathToFileURL } from 'node:url'

const JSON_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

export function loadConfig(env = process.env) {
  const baseUrl = String(env.LLM_BASE_URL ?? '').trim().replace(/\/+$/, '')
  const allowedOrigin = String(env.LLM_ALLOWED_ORIGIN ?? '').trim()
  let parsedBase
  let parsedOrigin
  try {
    parsedBase = new URL(baseUrl)
  } catch {
    parsedBase = null
  }
  try {
    parsedOrigin = new URL(allowedOrigin)
  } catch {
    parsedOrigin = null
  }

  return {
    apiKey: String(env.LLM_API_KEY ?? '').trim(),
    baseUrl,
    baseUrlValid: parsedBase?.protocol === 'https:',
    model: String(env.LLM_MODEL ?? '').trim(),
    proxyToken: String(env.LLM_PROXY_TOKEN ?? '').trim(),
    allowedOrigin,
    allowedOriginValid: parsedOrigin?.protocol === 'https:' && parsedOrigin.origin === allowedOrigin,
    port: boundedInteger(env.LLM_PORT, 8787, 1, 65535),
    maxBodyBytes: boundedInteger(env.LLM_MAX_BODY_BYTES, 65_536, 1_024, 262_144),
    timeoutMs: boundedInteger(env.LLM_TIMEOUT_MS, 20_000, 1_000, 120_000),
    maxUpstreamBodyBytes: boundedInteger(env.LLM_MAX_UPSTREAM_BODY_BYTES, 4 * 1024 * 1024, 1_024, 8 * 1024 * 1024),
    rateLimitPerMinute: boundedInteger(env.LLM_RATE_LIMIT_PER_MINUTE, 20, 1, 600),
    maxConcurrent: boundedInteger(env.LLM_MAX_CONCURRENT, 2, 1, 32),
    maxConcurrentPerClient: boundedInteger(env.LLM_MAX_CONCURRENT_PER_CLIENT, 1, 1, 8),
  }
}

function sendJson(response, status, body, extraHeaders = {}) {
  if (response.headersSent) return
  response.writeHead(status, { ...JSON_HEADERS, ...extraHeaders })
  response.end(`${JSON.stringify(body)}\n`)
}

function clientId(request) {
  const forwarded = request.headers['x-forwarded-for']
  const first = Array.isArray(forwarded) ? forwarded[0] : String(forwarded ?? '').split(',')[0]
  return (first.trim() || request.socket.remoteAddress || 'unknown').slice(0, 80)
}

async function readNodeBody(request, limit) {
  const declared = Number.parseInt(String(request.headers['content-length'] ?? ''), 10)
  if (Number.isFinite(declared) && declared > limit) {
    request.resume()
    const error = new Error('BODY_TOO_LARGE')
    error.code = 'BODY_TOO_LARGE'
    throw error
  }

  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > limit) {
      request.resume()
      const error = new Error('BODY_TOO_LARGE')
      error.code = 'BODY_TOO_LARGE'
      throw error
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, size)
}

async function readWebBody(body, limit) {
  if (!body) return Buffer.alloc(0)
  const chunks = []
  let size = 0
  for await (const chunk of body) {
    size += chunk.length
    if (size > limit) throw new Error('UPSTREAM_BODY_TOO_LARGE')
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks, size)
}

function normalizePayload(input, model) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  if (!Array.isArray(input.messages) || input.messages.length < 1 || input.messages.length > 32) return null

  let totalContent = 0
  const messages = []
  for (const item of input.messages) {
    if (!item || typeof item !== 'object' || !['system', 'user', 'assistant'].includes(item.role)) return null
    if (typeof item.content !== 'string' || item.content.length > 24_000) return null
    totalContent += item.content.length
    if (totalContent > 48_000) return null
    messages.push({ role: item.role, content: item.content })
  }

  const payload = {
    model,
    messages,
    temperature: typeof input.temperature === 'number'
      ? Math.min(2, Math.max(0, input.temperature))
      : 0,
    stream: input.stream === true,
  }
  if (input.response_format?.type === 'json_object') {
    payload.response_format = { type: 'json_object' }
  }
  return payload
}

export function createLlmProxyServer(config = loadConfig()) {
  const rateWindows = new Map()
  const clientActive = new Map()
  let active = 0

  const configured = () => Boolean(
    config.apiKey
      && config.baseUrlValid
      && config.model
      && config.proxyToken
      && config.allowedOrigin
      && (config.allowedOriginValid ?? true),
  )

  return http.createServer(async (request, response) => {
    const startedAt = Date.now()
    const pathname = new URL(request.url ?? '/', 'http://proxy.invalid').pathname

    if (request.method === 'GET' && pathname === '/health') {
      sendJson(response, configured() ? 200 : 503, {
        status: configured() ? 'ok' : 'not_configured',
        service: 'space-ai-platform-llm-proxy',
      })
      return
    }

    if (request.method !== 'POST' || pathname !== '/chat/completions') {
      sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'Route not found' } })
      return
    }

    if (!configured()) {
      sendJson(response, 503, { error: { code: 'LLM_NOT_CONFIGURED', message: 'LLM service unavailable' } })
      return
    }

    if (request.headers['x-space-proxy-token'] !== config.proxyToken) {
      sendJson(response, 401, { error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } })
      return
    }

    const origin = String(request.headers.origin ?? '')
    if (origin && (!config.allowedOrigin || origin !== config.allowedOrigin)) {
      sendJson(response, 403, { error: { code: 'ORIGIN_DENIED', message: 'Origin denied' } })
      return
    }

    if (!String(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
      sendJson(response, 415, { error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Expected application/json' } })
      return
    }

    const id = clientId(request)
    const now = Date.now()
    const currentWindow = rateWindows.get(id)
    const windowState = !currentWindow || now - currentWindow.startedAt >= 60_000
      ? { startedAt: now, count: 0 }
      : currentWindow
    windowState.count += 1
    rateWindows.set(id, windowState)
    if (rateWindows.size > 4_096) {
      for (const [key, value] of rateWindows) {
        if (now - value.startedAt >= 60_000) rateWindows.delete(key)
      }
    }
    if (windowState.count > config.rateLimitPerMinute) {
      sendJson(response, 429, { error: { code: 'RATE_LIMITED', message: 'Too many requests' } }, { 'retry-after': '60' })
      return
    }

    const activeForClient = clientActive.get(id) ?? 0
    if (active >= config.maxConcurrent || activeForClient >= config.maxConcurrentPerClient) {
      sendJson(response, 429, { error: { code: 'CONCURRENCY_LIMITED', message: 'Too many concurrent requests' } }, { 'retry-after': '1' })
      return
    }

    active += 1
    clientActive.set(id, activeForClient + 1)
    let upstreamStatus = 0
    try {
      const rawBody = await readNodeBody(request, config.maxBodyBytes)
      let input
      try {
        input = JSON.parse(rawBody.toString('utf8'))
      } catch {
        sendJson(response, 400, { error: { code: 'INVALID_JSON', message: 'Invalid JSON body' } })
        return
      }
      const payload = normalizePayload(input, config.model)
      if (!payload) {
        sendJson(response, 400, { error: { code: 'INVALID_REQUEST', message: 'Invalid chat completion request' } })
        return
      }

      const controller = new AbortController()
      response.once('close', () => {
        if (!response.writableEnded) controller.abort()
      })

      let upstream
      let timeout
      try {
        timeout = setTimeout(() => controller.abort(), config.timeoutMs)
        upstream = await fetch(`${config.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        })
        upstreamStatus = upstream.status

        if (!upstream.ok) {
          await upstream.body?.cancel().catch(() => {})
          sendJson(response, 502, {
            error: { code: 'UPSTREAM_ERROR', message: 'LLM provider request failed', upstreamStatus },
          })
          return
        }

        if (payload.stream) {
          response.writeHead(200, {
            'cache-control': 'no-store',
            'content-type': 'text/event-stream; charset=utf-8',
            'x-accel-buffering': 'no',
            'x-content-type-options': 'nosniff',
          })
          if (upstream.body) {
            for await (const chunk of upstream.body) response.write(chunk)
          }
          response.end()
        } else {
          const body = await readWebBody(upstream.body, config.maxUpstreamBodyBytes ?? 4 * 1024 * 1024)
          response.writeHead(200, JSON_HEADERS)
          response.end(body)
        }
      } finally {
        clearTimeout(timeout)
      }
    } catch (error) {
      if (error?.code === 'BODY_TOO_LARGE') {
        sendJson(response, 413, { error: { code: 'BODY_TOO_LARGE', message: 'Request body too large' } })
      } else if (error?.name === 'AbortError') {
        sendJson(response, 504, { error: { code: 'UPSTREAM_TIMEOUT', message: 'LLM provider timed out' } })
      } else if (error?.message === 'UPSTREAM_BODY_TOO_LARGE') {
        sendJson(response, 502, { error: { code: 'UPSTREAM_RESPONSE_TOO_LARGE', message: 'LLM provider response too large' } })
      } else {
        sendJson(response, 502, { error: { code: 'PROXY_ERROR', message: 'LLM proxy request failed' } })
      }
    } finally {
      active -= 1
      const remaining = (clientActive.get(id) ?? 1) - 1
      if (remaining > 0) clientActive.set(id, remaining)
      else clientActive.delete(id)
      const durationMs = Date.now() - startedAt
      console.log(JSON.stringify({ event: 'llm_proxy_request', method: request.method, path: pathname, status: response.statusCode, upstreamStatus, durationMs }))
    }
  })
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
}

if (isMainModule()) {
  const config = loadConfig()
  const server = createLlmProxyServer(config)
  server.listen(config.port, '0.0.0.0', () => {
    console.log(JSON.stringify({ event: 'llm_proxy_started', port: config.port, configured: Boolean(config.apiKey && config.baseUrlValid && config.model && config.proxyToken && config.allowedOrigin && (config.allowedOriginValid ?? true)) }))
  })
}
