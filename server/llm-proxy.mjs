import { timingSafeEqual } from 'node:crypto'
import { once } from 'node:events'
import http from 'node:http'
import { isIP } from 'node:net'
import { pathToFileURL } from 'node:url'
import {
  createDailyQuota,
  DailyQuotaError,
  loadDailyQuotaConfig,
} from './llm-quota.mjs'

export const MINIMAX_BASE_URL = 'https://api.minimax.cn/v1'
export const MINIMAX_MODEL = 'MiniMax-M3'
export const MINIMAX_SERVICE_TIER = 'standard'

const MAX_RATE_CLIENTS = 4_096
const SERVICE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,256}$/
const JSON_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
}

function strictBoundedInteger(value, fallback, min, max) {
  if (value === undefined || value === null || value === '') {
    return { value: fallback, valid: true }
  }
  const text = String(value)
  if (!/^\d+$/.test(text)) return { value: fallback, valid: false }
  const parsed = Number(text)
  return {
    value: parsed,
    valid: Number.isSafeInteger(parsed) && parsed >= min && parsed <= max,
  }
}

function exactHttpsOrigin(value) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    return false
  }
  return parsed.protocol === 'https:'
    && parsed.origin === value
    && parsed.pathname === '/'
    && !parsed.search
    && !parsed.hash
    && !parsed.username
    && !parsed.password
}

export function loadConfig(env = process.env) {
  const baseUrl = String(env.LLM_BASE_URL ?? MINIMAX_BASE_URL).trim().replace(/\/+$/, '')
  const model = String(env.LLM_MODEL ?? MINIMAX_MODEL).trim()
  const proxyToken = String(env.LLM_PROXY_TOKEN ?? '')
  const edgeToken = String(env.LLM_EDGE_TOKEN ?? '')
  const allowedOrigin = String(env.LLM_ALLOWED_ORIGIN ?? '').trim()
  const port = strictBoundedInteger(env.LLM_PORT, 8_787, 1, 65_535)
  const maxBodyBytes = strictBoundedInteger(env.LLM_MAX_BODY_BYTES, 65_536, 1_024, 262_144)
  const requestReadTimeoutMs = strictBoundedInteger(env.LLM_REQUEST_READ_TIMEOUT_MS, 10_000, 100, 30_000)
  const timeoutMs = strictBoundedInteger(env.LLM_TIMEOUT_MS, 20_000, 1_000, 120_000)
  const maxUpstreamBodyBytes = strictBoundedInteger(env.LLM_MAX_UPSTREAM_BODY_BYTES, 4 * 1024 * 1024, 1_024, 8 * 1024 * 1024)
  const maxStreamBytes = strictBoundedInteger(env.LLM_MAX_STREAM_BYTES, 1024 * 1024, 1_024, 4 * 1024 * 1024)
  const maxCompletionTokens = strictBoundedInteger(env.LLM_MAX_COMPLETION_TOKENS, 2_048, 1, 2_048)
  const rateLimitPerMinute = strictBoundedInteger(env.LLM_RATE_LIMIT_PER_MINUTE, 20, 1, 60)
  const globalRateLimitPerMinute = strictBoundedInteger(env.LLM_GLOBAL_RATE_LIMIT_PER_MINUTE, 60, 1, 100)
  const maxConcurrent = strictBoundedInteger(env.LLM_MAX_CONCURRENT, 2, 1, 16)
  const maxConcurrentPerClient = strictBoundedInteger(env.LLM_MAX_CONCURRENT_PER_CLIENT, 1, 1, 4)
  const dailyQuota = loadDailyQuotaConfig(env)
  const limitsValid = [
    port,
    maxBodyBytes,
    requestReadTimeoutMs,
    timeoutMs,
    maxUpstreamBodyBytes,
    maxStreamBytes,
    maxCompletionTokens,
    rateLimitPerMinute,
    globalRateLimitPerMinute,
    maxConcurrent,
    maxConcurrentPerClient,
  ].every(({ valid }) => valid)

  return {
    apiKey: String(env.LLM_API_KEY ?? '').trim(),
    baseUrl,
    baseUrlValid: baseUrl === MINIMAX_BASE_URL,
    model,
    modelValid: model === MINIMAX_MODEL,
    proxyToken,
    proxyTokenValid: SERVICE_TOKEN_PATTERN.test(proxyToken),
    edgeToken,
    edgeTokenValid: SERVICE_TOKEN_PATTERN.test(edgeToken),
    serviceTokensDistinct: proxyToken !== edgeToken,
    allowedOrigin,
    allowedOriginValid: exactHttpsOrigin(allowedOrigin),
    port: port.value,
    maxBodyBytes: maxBodyBytes.value,
    requestReadTimeoutMs: requestReadTimeoutMs.value,
    timeoutMs: timeoutMs.value,
    maxUpstreamBodyBytes: maxUpstreamBodyBytes.value,
    maxStreamBytes: maxStreamBytes.value,
    maxCompletionTokens: maxCompletionTokens.value,
    rateLimitPerMinute: rateLimitPerMinute.value,
    globalRateLimitPerMinute: globalRateLimitPerMinute.value,
    maxConcurrent: maxConcurrent.value,
    maxConcurrentPerClient: maxConcurrentPerClient.value,
    dailyQuota,
    limitsValid,
  }
}

function staticConfigReady(config) {
  return Boolean(
    config.apiKey
      && config.baseUrl === MINIMAX_BASE_URL
      && config.baseUrlValid
      && config.model === MINIMAX_MODEL
      && (config.modelValid ?? true)
      && SERVICE_TOKEN_PATTERN.test(config.proxyToken)
      && SERVICE_TOKEN_PATTERN.test(config.edgeToken)
      && !secureTokenMatches(config.proxyToken, config.edgeToken)
      && config.allowedOrigin
      && config.allowedOriginValid
      && (config.limitsValid ?? true)
      && config.dailyQuota?.valid,
  )
}

function configReady(config, quota) {
  return staticConfigReady(config)
    && typeof quota?.inspect === 'function'
    && typeof quota?.reserve === 'function'
}

function sendJson(response, status, body, extraHeaders = {}) {
  if (response.headersSent || response.destroyed) return false
  response.writeHead(status, { ...JSON_HEADERS, ...extraHeaders })
  response.end(`${JSON.stringify(body)}\n`)
  return true
}

function failResponse(response, status, body, extraHeaders = {}) {
  if (!sendJson(response, status, body, extraHeaders) && !response.destroyed) response.destroy()
}

function secureTokenMatches(actual, expected) {
  if (typeof actual !== 'string' || !actual || !expected) return false
  const actualBytes = Buffer.from(actual)
  const expectedBytes = Buffer.from(expected)
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes)
}

function uniqueRequestHeader(request, name) {
  const rawHeaders = request.rawHeaders
  if (Array.isArray(rawHeaders) && rawHeaders.length > 0) {
    let value = null
    let count = 0
    for (let index = 0; index < rawHeaders.length; index += 2) {
      if (String(rawHeaders[index]).toLowerCase() !== name) continue
      count += 1
      value = rawHeaders[index + 1]
    }
    return count === 1 && typeof value === 'string' ? value : null
  }

  const value = request.headers[name]
  return typeof value === 'string' ? value : null
}

function trustedClientId(request) {
  const value = request.headers['x-space-client-ip']
  if (Array.isArray(value) || typeof value !== 'string') return null
  const address = value.trim()
  if (!address || address.includes(',') || address.length > 64 || isIP(address) === 0) return null
  return address
}

export function parseRequestPath(target) {
  try {
    return new URL(target ?? '/', 'http://proxy.invalid').pathname
  } catch {
    return null
  }
}

function codedError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

function readNodeBody(request, limit, timeoutMs) {
  const declared = Number.parseInt(String(request.headers['content-length'] ?? ''), 10)
  if (Number.isFinite(declared) && declared > limit) {
    request.resume()
    return Promise.reject(codedError('BODY_TOO_LARGE'))
  }

  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let settled = false
    let timer

    const cleanup = (keepErrorListener = false) => {
      clearTimeout(timer)
      request.removeListener('data', onData)
      request.removeListener('end', onEnd)
      request.removeListener('aborted', onAborted)
      if (!keepErrorListener) request.removeListener('error', onError)
    }
    const rejectOnce = (error, drain = false) => {
      if (settled) return
      settled = true
      cleanup(drain)
      if (drain) request.resume()
      reject(error)
    }
    const onData = (chunk) => {
      size += chunk.length
      if (size > limit) {
        rejectOnce(codedError('BODY_TOO_LARGE'), true)
        return
      }
      chunks.push(chunk)
    }
    const onEnd = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve(Buffer.concat(chunks, size))
    }
    const onAborted = () => rejectOnce(codedError('CLIENT_ABORTED'))
    const onError = () => rejectOnce(codedError('CLIENT_ABORTED'))

    request.on('data', onData)
    request.once('end', onEnd)
    request.once('aborted', onAborted)
    request.once('error', onError)
    timer = setTimeout(() => rejectOnce(codedError('REQUEST_BODY_TIMEOUT'), true), timeoutMs)
  })
}

async function readWebBody(body, limit) {
  if (!body) throw codedError('UPSTREAM_EMPTY_BODY')
  const chunks = []
  let size = 0
  for await (const chunk of body) {
    size += chunk.length
    if (size > limit) throw codedError('UPSTREAM_BODY_TOO_LARGE')
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks, size)
}

function validateNonStreamResponse(body) {
  let parsed
  try {
    parsed = JSON.parse(body.toString('utf8'))
  } catch {
    throw codedError('UPSTREAM_INVALID_RESPONSE')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw codedError('UPSTREAM_INVALID_RESPONSE')
  }
  if (parsed.base_resp !== undefined) {
    if (!parsed.base_resp
      || typeof parsed.base_resp !== 'object'
      || Array.isArray(parsed.base_resp)
      || parsed.base_resp.status_code !== 0) {
      throw codedError('UPSTREAM_APPLICATION_ERROR')
    }
  }
  const choice = parsed.choices?.[0]
  if (choice?.finish_reason === 'length') throw codedError('UPSTREAM_TRUNCATED_RESPONSE')
  const content = choice?.message?.content
  if (typeof content !== 'string') throw codedError('UPSTREAM_INVALID_RESPONSE')
}

function sanitizeStreamData(data) {
  if (data === '[DONE]') return { done: true, payload: '[DONE]' }

  let parsed
  try {
    parsed = JSON.parse(data)
  } catch {
    throw codedError('UPSTREAM_INVALID_RESPONSE')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw codedError('UPSTREAM_INVALID_RESPONSE')
  }
  if (parsed.error !== undefined) throw codedError('UPSTREAM_APPLICATION_ERROR')
  if (parsed.base_resp !== undefined) {
    if (!parsed.base_resp
      || typeof parsed.base_resp !== 'object'
      || Array.isArray(parsed.base_resp)
      || parsed.base_resp.status_code !== 0) {
      throw codedError('UPSTREAM_APPLICATION_ERROR')
    }
  }
  if (!Array.isArray(parsed.choices)) throw codedError('UPSTREAM_INVALID_RESPONSE')
  if (parsed.choices.length === 0) return { done: false, payload: null }

  const choice = parsed.choices[0]
  if (!choice || typeof choice !== 'object' || Array.isArray(choice)) {
    throw codedError('UPSTREAM_INVALID_RESPONSE')
  }
  if (choice.finish_reason === 'length') throw codedError('UPSTREAM_TRUNCATED_RESPONSE')
  if (choice.finish_reason !== undefined
    && choice.finish_reason !== null
    && typeof choice.finish_reason !== 'string') {
    throw codedError('UPSTREAM_INVALID_RESPONSE')
  }
  if (choice.delta !== undefined
    && (!choice.delta || typeof choice.delta !== 'object' || Array.isArray(choice.delta))) {
    throw codedError('UPSTREAM_INVALID_RESPONSE')
  }
  const content = choice.delta?.content
  if (content !== undefined && content !== null && typeof content !== 'string') {
    throw codedError('UPSTREAM_INVALID_RESPONSE')
  }

  const safeChoice = { delta: typeof content === 'string' ? { content } : {} }
  if (choice.finish_reason !== undefined) safeChoice.finish_reason = choice.finish_reason
  return {
    done: false,
    payload: JSON.stringify({ choices: [safeChoice] }),
  }
}

async function writeSseData(response, payload, signal) {
  if (!response.headersSent) {
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': 'text/event-stream; charset=utf-8',
      'x-accel-buffering': 'no',
      'x-content-type-options': 'nosniff',
    })
  }
  if (!response.write(`data: ${payload}\n\n`)) await once(response, 'drain', { signal })
}

async function streamWebBody(body, response, limit, signal) {
  if (!body) throw codedError('UPSTREAM_EMPTY_BODY')
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let size = 0
  let buffer = ''
  let complete = false
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        buffer += decoder.decode()
        break
      }
      size += value.byteLength
      if (size > limit) throw codedError('UPSTREAM_STREAM_TOO_LARGE')
      buffer += decoder.decode(value, { stream: true })

      while (true) {
        const boundary = buffer.match(/\r?\n\r?\n/)
        if (!boundary || boundary.index === undefined) break
        const event = buffer.slice(0, boundary.index)
        buffer = buffer.slice(boundary.index + boundary[0].length)
        const data = event.split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('\n')
        if (!data) continue
        const sanitized = sanitizeStreamData(data)
        if (sanitized.payload !== null) await writeSseData(response, sanitized.payload, signal)
        if (sanitized.done) {
          complete = true
          response.end()
          await reader.cancel().catch(() => {})
          return
        }
      }
    }

    if (buffer.trim()) throw codedError('UPSTREAM_INVALID_RESPONSE')
    throw codedError('UPSTREAM_TRUNCATED_RESPONSE')
  } finally {
    if (!complete) await reader.cancel().catch(() => {})
  }
}

function normalizePayload(input, maxCompletionTokens) {
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
    model: MINIMAX_MODEL,
    messages,
    temperature: typeof input.temperature === 'number'
      ? Math.min(2, Math.max(0, input.temperature))
      : 0,
    stream: input.stream === true,
    max_completion_tokens: maxCompletionTokens,
    service_tier: MINIMAX_SERVICE_TIER,
    thinking: { type: 'disabled' },
  }
  if (input.response_format?.type === 'json_object') {
    payload.response_format = { type: 'json_object' }
  }
  return payload
}

function takeRateSlot(rateWindows, id, now, limit) {
  let state = rateWindows.get(id)
  if (state && now - state.startedAt >= 60_000) {
    rateWindows.delete(id)
    state = null
  }
  if (!state) {
    if (rateWindows.size >= MAX_RATE_CLIENTS) {
      for (const [key, candidate] of rateWindows) {
        if (now - candidate.startedAt >= 60_000) rateWindows.delete(key)
      }
    }
    if (rateWindows.size >= MAX_RATE_CLIENTS) return false
    state = { startedAt: now, count: 0 }
    rateWindows.set(id, state)
  }
  state.count += 1
  return state.count <= limit
}

function takeGlobalRateSlot(state, now, limit) {
  if (now - state.startedAt >= 60_000) {
    state.startedAt = now
    state.count = 0
  }
  state.count += 1
  return state.count <= limit
}

export function createLlmProxyServer(config = loadConfig(), dependencies = {}) {
  const rateWindows = new Map()
  const clientActive = new Map()
  const fetchImpl = dependencies.fetch ?? globalThis.fetch
  const log = dependencies.log ?? console.log
  const globalRateWindow = { startedAt: Date.now(), count: 0 }
  let quota = dependencies.quota ?? null
  if (!quota && config.dailyQuota?.valid) {
    try {
      quota = createDailyQuota(config.dailyQuota)
    } catch {
      quota = null
    }
  }
  let active = 0

  return http.createServer(async (request, response) => {
    const startedAt = Date.now()
    const pathname = parseRequestPath(request.url)
    if (pathname === null) {
      sendJson(response, 400, { error: { code: 'INVALID_REQUEST_TARGET', message: 'Invalid request target' } })
      return
    }

    if (request.method === 'GET' && pathname === '/health') {
      if (!configReady(config, quota)) {
        sendJson(response, 503, { status: 'not_configured', service: 'space-ai-platform-llm-proxy' })
        return
      }
      try {
        await quota.inspect()
        sendJson(response, 200, { status: 'ok', service: 'space-ai-platform-llm-proxy' })
      } catch {
        sendJson(response, 503, { status: 'quota_unavailable', service: 'space-ai-platform-llm-proxy' })
      }
      return
    }

    if (request.method !== 'POST' || pathname !== '/chat/completions') {
      sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'Route not found' } })
      return
    }
    if (!configReady(config, quota)) {
      sendJson(response, 503, { error: { code: 'LLM_NOT_CONFIGURED', message: 'LLM service unavailable' } })
      return
    }

    const edgeToken = uniqueRequestHeader(request, 'x-space-edge-token')
    const proxyToken = uniqueRequestHeader(request, 'x-space-proxy-token')
    const edgeAuthorized = secureTokenMatches(edgeToken, config.edgeToken)
    const proxyAuthorized = secureTokenMatches(proxyToken, config.proxyToken)
    if (!edgeAuthorized || !proxyAuthorized) {
      sendJson(response, 401, { error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } })
      return
    }
    if (String(request.headers.origin ?? '') !== config.allowedOrigin) {
      sendJson(response, 403, { error: { code: 'ORIGIN_DENIED', message: 'Origin denied' } })
      return
    }
    if (request.headers['x-forwarded-proto'] !== 'https') {
      sendJson(response, 403, { error: { code: 'HTTPS_REQUIRED', message: 'HTTPS required' } })
      return
    }
    if (!String(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
      sendJson(response, 415, { error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Expected application/json' } })
      return
    }

    const id = trustedClientId(request)
    if (!id) {
      sendJson(response, 400, { error: { code: 'UNTRUSTED_CLIENT_ADDRESS', message: 'Client address unavailable' } })
      return
    }
    const rateNow = Date.now()
    if (!takeGlobalRateSlot(globalRateWindow, rateNow, config.globalRateLimitPerMinute)) {
      sendJson(response, 429, { error: { code: 'GLOBAL_RATE_LIMITED', message: 'Too many requests' } }, { 'retry-after': '60' })
      return
    }
    if (!takeRateSlot(rateWindows, id, rateNow, config.rateLimitPerMinute)) {
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
    let outcome = 'proxy_error'
    let controller
    let timeout
    let abortReason
    let closeListener
    try {
      const rawBody = await readNodeBody(request, config.maxBodyBytes, config.requestReadTimeoutMs)
      let input
      try {
        input = JSON.parse(rawBody.toString('utf8'))
      } catch {
        outcome = 'invalid_json'
        sendJson(response, 400, { error: { code: 'INVALID_JSON', message: 'Invalid JSON body' } })
        return
      }
      const payload = normalizePayload(input, config.maxCompletionTokens)
      if (!payload) {
        outcome = 'invalid_request'
        sendJson(response, 400, { error: { code: 'INVALID_REQUEST', message: 'Invalid chat completion request' } })
        return
      }

      controller = new AbortController()
      closeListener = () => {
        if (!response.writableEnded && !controller.signal.aborted) {
          abortReason = 'client_disconnect'
          controller.abort()
        }
      }
      response.once('close', closeListener)

      try {
        await quota.reserve()
      } catch (error) {
        if (error instanceof DailyQuotaError && error.code === 'DAILY_QUOTA_EXCEEDED') {
          outcome = 'daily_quota_exceeded'
          sendJson(response, 429, { error: { code: 'DAILY_QUOTA_EXCEEDED', message: 'Daily AI request quota exceeded' } })
        } else {
          outcome = 'daily_quota_unavailable'
          sendJson(response, 503, { error: { code: 'DAILY_QUOTA_UNAVAILABLE', message: 'Daily AI request quota unavailable' } })
        }
        return
      }

      if (controller.signal.aborted || response.destroyed) {
        outcome = 'client_disconnect'
        return
      }

      timeout = setTimeout(() => {
        if (!controller.signal.aborted) {
          abortReason = 'timeout'
          controller.abort()
        }
      }, config.timeoutMs)

      const upstream = await fetchImpl(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
        redirect: 'error',
        signal: controller.signal,
      })
      upstreamStatus = upstream.status

      if (!upstream.ok) {
        await upstream.body?.cancel().catch(() => {})
        outcome = 'upstream_error'
        sendJson(response, 502, {
          error: { code: 'UPSTREAM_ERROR', message: 'LLM provider request failed', upstreamStatus },
        })
        return
      }

      if (payload.stream) {
        const contentType = String(upstream.headers.get('content-type') ?? '').toLowerCase()
        if (!/^text\/event-stream(?:\s*;|$)/.test(contentType)) {
          await upstream.body?.cancel().catch(() => {})
          throw codedError('UPSTREAM_INVALID_RESPONSE')
        }
        await streamWebBody(upstream.body, response, config.maxStreamBytes, controller.signal)
      } else {
        const declared = Number.parseInt(String(upstream.headers.get('content-length') ?? ''), 10)
        if (Number.isFinite(declared) && declared > config.maxUpstreamBodyBytes) {
          throw codedError('UPSTREAM_BODY_TOO_LARGE')
        }
        const body = await readWebBody(upstream.body, config.maxUpstreamBodyBytes)
        validateNonStreamResponse(body)
        response.writeHead(200, JSON_HEADERS)
        response.end(body)
      }
      outcome = 'success'
    } catch (error) {
      if (error?.code === 'BODY_TOO_LARGE') {
        outcome = 'request_too_large'
        failResponse(response, 413, { error: { code: 'BODY_TOO_LARGE', message: 'Request body too large' } }, { connection: 'close' })
      } else if (error?.code === 'REQUEST_BODY_TIMEOUT') {
        outcome = 'request_body_timeout'
        failResponse(response, 408, { error: { code: 'REQUEST_BODY_TIMEOUT', message: 'Request body timed out' } }, { connection: 'close' })
      } else if (error?.code === 'CLIENT_ABORTED' || abortReason === 'client_disconnect') {
        outcome = 'client_disconnect'
        if (!response.destroyed) response.destroy()
      } else if (abortReason === 'timeout' || (controller?.signal.aborted && error?.name === 'AbortError')) {
        outcome = 'upstream_timeout'
        failResponse(response, 504, { error: { code: 'UPSTREAM_TIMEOUT', message: 'LLM provider timed out' } })
      } else if (error?.code === 'UPSTREAM_BODY_TOO_LARGE') {
        outcome = 'upstream_response_too_large'
        if (controller && !controller.signal.aborted) controller.abort()
        failResponse(response, 502, { error: { code: 'UPSTREAM_RESPONSE_TOO_LARGE', message: 'LLM provider response too large' } })
      } else if (error?.code === 'UPSTREAM_STREAM_TOO_LARGE') {
        outcome = 'upstream_stream_too_large'
        if (controller && !controller.signal.aborted) controller.abort()
        failResponse(response, 502, { error: { code: 'UPSTREAM_STREAM_TOO_LARGE', message: 'LLM provider stream too large' } })
      } else if (error?.code === 'UPSTREAM_EMPTY_BODY') {
        outcome = 'upstream_empty_body'
        failResponse(response, 502, { error: { code: 'UPSTREAM_ERROR', message: 'LLM provider response missing' } })
      } else if (error?.code === 'UPSTREAM_APPLICATION_ERROR'
        || error?.code === 'UPSTREAM_INVALID_RESPONSE'
        || error?.code === 'UPSTREAM_TRUNCATED_RESPONSE') {
        outcome = 'upstream_invalid_response'
        failResponse(response, 502, { error: { code: 'UPSTREAM_ERROR', message: 'LLM provider request failed' } })
      } else {
        outcome = 'proxy_error'
        if (controller && !controller.signal.aborted) controller.abort()
        failResponse(response, 502, { error: { code: 'PROXY_ERROR', message: 'LLM proxy request failed' } })
      }
    } finally {
      clearTimeout(timeout)
      if (closeListener) response.removeListener('close', closeListener)
      active -= 1
      const remaining = (clientActive.get(id) ?? 1) - 1
      if (remaining > 0) clientActive.set(id, remaining)
      else clientActive.delete(id)
      log(JSON.stringify({
        event: 'llm_proxy_request',
        method: request.method,
        path: pathname,
        status: response.statusCode,
        upstreamStatus,
        outcome,
        durationMs: Date.now() - startedAt,
      }))
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
    console.log(JSON.stringify({
      event: 'llm_proxy_started',
      port: config.port,
      configurationPresent: staticConfigReady(config),
    }))
  })
}
