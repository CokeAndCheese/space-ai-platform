import assert from 'node:assert/strict'
import { once } from 'node:events'
import http from 'node:http'
import {
  createLlmProxyServer,
  loadConfig,
  MINIMAX_BASE_URL,
  MINIMAX_MODEL,
  parseRequestPath,
} from '../server/llm-proxy.mjs'
import { DailyQuotaError } from '../server/llm-quota.mjs'

const ORIGIN = 'https://space.example'
const PROXY_TOKEN = 'test-proxy-token-0123456789-abcdef'
const EDGE_TOKEN = 'test-edge-token-0123456789-abcdefg'

async function listen(server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return server.address().port
}

async function close(server) {
  if (!server?.listening) return
  server.close()
  server.closeAllConnections?.()
  await once(server, 'close')
}

async function waitFor(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for test condition')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

function chatOptions(content, overrides = {}) {
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: ORIGIN,
      'x-forwarded-proto': 'https',
      'x-space-client-ip': '203.0.113.10',
      'x-space-edge-token': EDGE_TOKEN,
      'x-space-proxy-token': PROXY_TOKEN,
      ...overrides.headers,
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content }],
      ...overrides.body,
    }),
  }
}

function makeQuota({ inspectError, reserveError } = {}) {
  return {
    inspectCount: 0,
    reserveCount: 0,
    async inspect() {
      this.inspectCount += 1
      if (inspectError) throw inspectError
      return { date: '2026-09-10', count: 0, limit: 100, remaining: 100 }
    },
    async reserve() {
      this.reserveCount += 1
      if (reserveError) throw reserveError
      return { date: '2026-09-10', count: this.reserveCount, limit: 100, remaining: 100 - this.reserveCount }
    },
  }
}

async function slowRequest(url) {
  return new Promise((resolve, reject) => {
    let receivedResponse = false
    const request = http.request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: ORIGIN,
        'x-forwarded-proto': 'https',
        'x-space-client-ip': '203.0.113.20',
        'x-space-edge-token': EDGE_TOKEN,
        'x-space-proxy-token': PROXY_TOKEN,
      },
    }, (response) => {
      receivedResponse = true
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.once('end', () => {
        request.destroy()
        resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') })
      })
    })
    request.once('error', (error) => {
      if (!receivedResponse) reject(error)
    })
    request.write('{"messages":[')
  })
}

async function rawChatRequest(url, { edgeToken = EDGE_TOKEN, proxyToken = PROXY_TOKEN } = {}) {
  const body = '{"messages":[{"role":"user","content":"raw-auth-check"}]}'
  return new Promise((resolve, reject) => {
    const headers = {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
      origin: 'https://wrong.example',
      'x-forwarded-proto': 'http',
      'x-space-client-ip': 'not-an-ip',
    }
    if (edgeToken !== undefined) headers['x-space-edge-token'] = edgeToken
    if (proxyToken !== undefined) headers['x-space-proxy-token'] = proxyToken
    const request = http.request(url, { method: 'POST', headers }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.once('end', () => resolve({
        status: response.statusCode,
        body: Buffer.concat(chunks).toString('utf8'),
      }))
    })
    request.once('error', reject)
    request.end(body)
  })
}

const upstreamRequests = []
const upstream = http.createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  const content = body.messages[0].content
  upstreamRequests.push({
    authorization: request.headers.authorization,
    edgeToken: request.headers['x-space-edge-token'],
    proxyToken: request.headers['x-space-proxy-token'],
    body,
  })

  if (content === 'hang-after-headers') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.flushHeaders()
    return
  }
  if (content === 'oversized-upstream') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ content: 'x'.repeat(1_024) }))
    return
  }
  if (content === 'oversized-stream') {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write('data: {"choices":[{"delta":{"content":"first"}}]}\n\n')
    setTimeout(() => response.end(`data: {"choices":[{"delta":{"content":"${'y'.repeat(512)}"}}]}\n\n`), 20)
    return
  }
  if (content === 'disconnect-stream') {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write('data: {"choices":[{"delta":{"content":"first"}}]}\n\n')
    const interval = setInterval(() => {
      response.write('data: {"choices":[{"delta":{"content":"waiting"}}]}\n\n')
    }, 25)
    response.once('close', () => clearInterval(interval))
    return
  }
  if (content === 'stream-wrong-content-type') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end('{"error":{"message":"private streamed provider diagnostic"}}')
    return
  }
  if (content === 'stream-app-error') {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end('data: {"base_resp":{"status_code":1004,"status_msg":"private streamed provider diagnostic"},"choices":[]}\n\n')
    return
  }
  if (content === 'stream-missing-done') {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n')
    return
  }
  if (content === 'provider-error') {
    response.writeHead(500, { 'content-type': 'application/json' })
    response.end('{"error":"not forwarded"}')
    return
  }
  if (content === 'provider-app-error') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end('{"base_resp":{"status_code":1004,"status_msg":"private provider diagnostic"},"choices":[]}')
    return
  }
  if (content === 'provider-length') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end('{"choices":[{"finish_reason":"length","message":{"content":"{\\"version\\":1}"}}]}')
    return
  }
  if (content === 'redirect') {
    response.writeHead(302, { location: '/redirected' })
    response.end()
    return
  }

  if (body.stream) {
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' })
    response.end('data: {"base_resp":{"status_code":0},"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n')
  } else {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end('{"choices":[{"message":{"content":"ok"}}]}')
  }
})

const upstreamPort = await listen(upstream)
const nativeFetch = globalThis.fetch
let fetchAbortCount = 0
const upstreamUrls = []
const transportFetch = (url, options) => {
  upstreamUrls.push(String(url))
  options?.signal?.addEventListener('abort', () => { fetchAbortCount += 1 }, { once: true })
  return nativeFetch(`http://127.0.0.1:${upstreamPort}/chat/completions`, options)
}

const baseConfig = {
  apiKey: 'test-provider-key',
  baseUrl: MINIMAX_BASE_URL,
  baseUrlValid: true,
  model: MINIMAX_MODEL,
  modelValid: true,
  proxyToken: PROXY_TOKEN,
  proxyTokenValid: true,
  edgeToken: EDGE_TOKEN,
  edgeTokenValid: true,
  serviceTokensDistinct: true,
  allowedOrigin: ORIGIN,
  allowedOriginValid: true,
  port: 0,
  maxBodyBytes: 512,
  requestReadTimeoutMs: 100,
  maxUpstreamBodyBytes: 256,
  maxStreamBytes: 256,
  maxCompletionTokens: 2_048,
  timeoutMs: 200,
  rateLimitPerMinute: 60,
  globalRateLimitPerMinute: 100,
  maxConcurrent: 1,
  maxConcurrentPerClient: 1,
  dailyQuota: { valid: true },
  limitsValid: true,
}

const quota = makeQuota()
const proxyLogs = []
const proxy = createLlmProxyServer(baseConfig, {
  fetch: transportFetch,
  quota,
  log: (line) => proxyLogs.push(JSON.parse(line)),
})
const proxyPort = await listen(proxy)
const proxyUrl = `http://127.0.0.1:${proxyPort}`
const extraServers = []
let passed = 0

async function check(name, action) {
  await action()
  passed += 1
  process.stdout.write(`ok ${passed} - ${name}\n`)
}

try {
  await check('health checks quota state without reserving or calling upstream', async () => {
    const health = await nativeFetch(`${proxyUrl}/health`)
    assert.equal(health.status, 200)
    assert.equal(quota.inspectCount, 1)
    assert.equal(quota.reserveCount, 0)
    assert.equal(upstreamRequests.length, 0)
  })

  await check('service token is required before quota or upstream work', async () => {
    const unauthorized = await nativeFetch(`${proxyUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"messages":[{"role":"user","content":"x"}]}',
    })
    assert.equal(unauthorized.status, 401)
    assert.equal(quota.reserveCount, 0)
  })

  await check('invalid request targets are rejected without throwing from the handler', async () => {
    assert.equal(parseRequestPath('http://%zz'), null)
    assert.equal(parseRequestPath('/chat/completions?x=1'), '/chat/completions')
  })

  await check('origin, HTTPS edge, and one validated edge client IP are mandatory', async () => {
    const cases = [
      [{ origin: undefined }, 403],
      [{ origin: 'https://wrong.example' }, 403],
      [{ 'x-forwarded-proto': 'http' }, 403],
      [{ 'x-space-client-ip': undefined }, 400],
      [{ 'x-space-client-ip': '203.0.113.1, 198.51.100.2' }, 400],
      [{ 'x-space-client-ip': 'not-an-ip' }, 400],
    ]
    for (const [headers, expectedStatus] of cases) {
      const options = chatOptions('boundary', { headers })
      for (const [key, value] of Object.entries(headers)) {
        if (value === undefined) delete options.headers[key]
      }
      const response = await nativeFetch(`${proxyUrl}/chat/completions`, options)
      assert.equal(response.status, expectedStatus)
    }
    assert.equal(quota.reserveCount, 0)
  })

  await check('server fixes MiniMax-M3, standard tier, disabled thinking, and output cap', async () => {
    const response = await nativeFetch(`${proxyUrl}/chat/completions`, chatOptions('hello', {
      body: {
        model: 'client-controlled-model',
        max_completion_tokens: 999_999,
        service_tier: 'priority',
        thinking: { type: 'adaptive' },
        response_format: { type: 'json_object' },
      },
    }))
    assert.equal(response.status, 200)
    assert.equal((await response.json()).choices[0].message.content, 'ok')
    const sent = upstreamRequests.at(-1)
    assert.equal(sent.authorization, 'Bearer test-provider-key')
    assert.equal(sent.body.model, 'MiniMax-M3')
    assert.equal(sent.body.max_completion_tokens, 2_048)
    assert.equal(sent.body.service_tier, 'standard')
    assert.deepEqual(sent.body.thinking, { type: 'disabled' })
    assert.equal(sent.body.max_tokens, undefined)
    assert.equal(upstreamUrls.at(-1), 'https://api.minimax.cn/v1/chat/completions')
    assert.equal(quota.reserveCount, 1)
  })

  await check('oversized request body is rejected before quota reservation', async () => {
    const before = quota.reserveCount
    const response = await nativeFetch(`${proxyUrl}/chat/completions`, chatOptions('x'.repeat(600)))
    assert.equal(response.status, 413)
    assert.equal(quota.reserveCount, before)
  })

  await check('slow request body times out and releases concurrency without quota use', async () => {
    const before = quota.reserveCount
    const response = await slowRequest(`${proxyUrl}/chat/completions`)
    assert.equal(response.status, 408)
    assert.equal(JSON.parse(response.body).error.code, 'REQUEST_BODY_TIMEOUT')
    assert.equal(quota.reserveCount, before)
  })

  await check('response-header stall times out, holds then releases concurrency', async () => {
    const abortsBefore = fetchAbortCount
    const hanging = nativeFetch(`${proxyUrl}/chat/completions`, chatOptions('hang-after-headers'))
    await waitFor(() => upstreamRequests.some(({ body }) => body.messages[0].content === 'hang-after-headers'))
    const limited = await nativeFetch(`${proxyUrl}/chat/completions`, chatOptions('concurrent'))
    assert.equal(limited.status, 429)
    assert.equal((await hanging).status, 504)
    assert.ok(fetchAbortCount > abortsBefore)
    const recovered = await nativeFetch(`${proxyUrl}/chat/completions`, chatOptions('recovered'))
    assert.equal(recovered.status, 200)
  })

  await check('oversized non-stream response fails before any successful body is returned', async () => {
    const response = await nativeFetch(`${proxyUrl}/chat/completions`, chatOptions('oversized-upstream'))
    assert.equal(response.status, 502)
    assert.equal((await response.json()).error.code, 'UPSTREAM_RESPONSE_TOO_LARGE')
  })

  await check('oversized stream is terminated and never reported as a complete success', async () => {
    const response = await nativeFetch(`${proxyUrl}/chat/completions`, chatOptions('oversized-stream', {
      body: { stream: true },
    }))
    if (response.status === 502) {
      assert.equal((await response.json()).error.code, 'UPSTREAM_STREAM_TOO_LARGE')
    } else {
      assert.equal(response.status, 200)
      await assert.rejects(response.text())
    }
  })

  await check('valid SSE is sanitized and completes only on the provider DONE sentinel', async () => {
    const response = await nativeFetch(`${proxyUrl}/chat/completions`, chatOptions('valid-stream', {
      body: { stream: true },
    }))
    assert.equal(response.status, 200)
    const text = await response.text()
    assert.equal(text, 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n')
    assert.doesNotMatch(text, /base_resp/)
  })

  await check('streaming HTTP 200 JSON errors are rejected without exposing provider diagnostics', async () => {
    const response = await nativeFetch(`${proxyUrl}/chat/completions`, chatOptions('stream-wrong-content-type', {
      body: { stream: true },
    }))
    assert.equal(response.status, 502)
    const text = await response.text()
    assert.match(text, /UPSTREAM_ERROR/)
    assert.doesNotMatch(text, /private streamed provider diagnostic/)
  })

  await check('SSE application errors are rejected before provider diagnostics reach the browser', async () => {
    const response = await nativeFetch(`${proxyUrl}/chat/completions`, chatOptions('stream-app-error', {
      body: { stream: true },
    }))
    assert.equal(response.status, 502)
    const text = await response.text()
    assert.match(text, /UPSTREAM_ERROR/)
    assert.doesNotMatch(text, /private streamed provider diagnostic|1004/)
  })

  await check('SSE ending without DONE fails and is never logged as success', async () => {
    const response = await nativeFetch(`${proxyUrl}/chat/completions`, chatOptions('stream-missing-done', {
      body: { stream: true },
    }))
    assert.equal(response.status, 200)
    await assert.rejects(response.text())
    await waitFor(() => proxyLogs.some(({ outcome }) => outcome === 'upstream_invalid_response'))
    assert.notEqual(proxyLogs.at(-1)?.outcome, 'success')
  })

  await check('browser disconnect aborts upstream consumption and releases the slot', async () => {
    const abortsBefore = fetchAbortCount
    await new Promise((resolve, reject) => {
      let received = false
      const request = http.request(`${proxyUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: ORIGIN,
          'x-forwarded-proto': 'https',
          'x-space-client-ip': '203.0.113.30',
          'x-space-edge-token': EDGE_TOKEN,
          'x-space-proxy-token': PROXY_TOKEN,
        },
      }, (response) => {
        response.once('data', () => {
          received = true
          response.destroy()
          resolve()
        })
      })
      request.once('error', (error) => {
        if (!received) reject(error)
      })
      request.end(JSON.stringify({
        messages: [{ role: 'user', content: 'disconnect-stream' }],
        stream: true,
      }))
    })
    await waitFor(() => fetchAbortCount > abortsBefore)
    const recovered = await nativeFetch(`${proxyUrl}/chat/completions`, chatOptions('after-disconnect', {
      headers: { 'x-space-client-ip': '203.0.113.30' },
    }))
    assert.equal(recovered.status, 200)
  })

  await check('per-client rate limit rejects before quota and upstream', async () => {
    const rateQuota = makeQuota()
    const rateProxy = createLlmProxyServer({ ...baseConfig, rateLimitPerMinute: 1 }, {
      fetch: transportFetch,
      quota: rateQuota,
    })
    extraServers.push(rateProxy)
    const port = await listen(rateProxy)
    const url = `http://127.0.0.1:${port}/chat/completions`
    assert.equal((await nativeFetch(url, chatOptions('rate-first'))).status, 200)
    assert.equal((await nativeFetch(url, chatOptions('rate-second'))).status, 429)
    assert.equal(rateQuota.reserveCount, 1)
  })

  await check('global minute rate limit applies across different client IPs', async () => {
    const globalQuota = makeQuota()
    const globalProxy = createLlmProxyServer({
      ...baseConfig,
      globalRateLimitPerMinute: 1,
    }, {
      fetch: transportFetch,
      quota: globalQuota,
    })
    extraServers.push(globalProxy)
    const port = await listen(globalProxy)
    const url = `http://127.0.0.1:${port}/chat/completions`
    assert.equal((await nativeFetch(url, chatOptions('global-first', {
      headers: { 'x-space-client-ip': '203.0.113.40' },
    }))).status, 200)
    assert.equal((await nativeFetch(url, chatOptions('global-second', {
      headers: { 'x-space-client-ip': '203.0.113.41' },
    }))).status, 429)
    assert.equal(globalQuota.reserveCount, 1)
  })

  await check('daily quota rejection prevents every upstream fetch', async () => {
    const dailyQuota = makeQuota({
      reserveError: new DailyQuotaError('DAILY_QUOTA_EXCEEDED', 'Daily AI request quota exceeded'),
    })
    let fetchCount = 0
    const dailyProxy = createLlmProxyServer(baseConfig, {
      fetch: async () => { fetchCount += 1; throw new Error('must not fetch') },
      quota: dailyQuota,
    })
    extraServers.push(dailyProxy)
    const port = await listen(dailyProxy)
    const response = await nativeFetch(`http://127.0.0.1:${port}/chat/completions`, chatOptions('quota'))
    assert.equal(response.status, 429)
    assert.equal((await response.json()).error.code, 'DAILY_QUOTA_EXCEEDED')
    assert.equal(fetchCount, 0)
  })

  await check('bad quota health or reservation fails closed without upstream access', async () => {
    const unavailable = new DailyQuotaError('DAILY_QUOTA_UNAVAILABLE', 'Daily quota storage unavailable')
    const badQuota = makeQuota({ inspectError: unavailable, reserveError: unavailable })
    let fetchCount = 0
    const badProxy = createLlmProxyServer(baseConfig, {
      fetch: async () => { fetchCount += 1; throw new Error('must not fetch') },
      quota: badQuota,
    })
    extraServers.push(badProxy)
    const port = await listen(badProxy)
    assert.equal((await nativeFetch(`http://127.0.0.1:${port}/health`)).status, 503)
    const response = await nativeFetch(`http://127.0.0.1:${port}/chat/completions`, chatOptions('quota-storage'))
    assert.equal(response.status, 503)
    assert.equal((await response.json()).error.code, 'DAILY_QUOTA_UNAVAILABLE')
    assert.equal(fetchCount, 0)
  })

  await check('provider failures consume the pre-reserved quota and do not expose provider body', async () => {
    const before = quota.reserveCount
    const response = await nativeFetch(`${proxyUrl}/chat/completions`, chatOptions('provider-error'))
    assert.equal(response.status, 502)
    const text = await response.text()
    assert.match(text, /UPSTREAM_ERROR/)
    assert.doesNotMatch(text, /not forwarded/)
    assert.equal(quota.reserveCount, before + 1)
  })

  await check('HTTP 200 provider application errors are converted to a generic failure', async () => {
    const before = quota.reserveCount
    const response = await nativeFetch(`${proxyUrl}/chat/completions`, chatOptions('provider-app-error'))
    assert.equal(response.status, 502)
    const text = await response.text()
    assert.match(text, /UPSTREAM_ERROR/)
    assert.doesNotMatch(text, /private provider diagnostic|1004/)
    assert.equal(quota.reserveCount, before + 1)
  })

  await check('non-stream length truncation is rejected even when content parses as JSON', async () => {
    const response = await nativeFetch(`${proxyUrl}/chat/completions`, chatOptions('provider-length'))
    assert.equal(response.status, 502)
    const text = await response.text()
    assert.match(text, /UPSTREAM_ERROR/)
    assert.doesNotMatch(text, /version/)
  })

  await check('redirects are forbidden and still consume the pre-reserved quota', async () => {
    const before = quota.reserveCount
    const response = await nativeFetch(`${proxyUrl}/chat/completions`, chatOptions('redirect'))
    assert.equal(response.status, 502)
    assert.equal(quota.reserveCount, before + 1)
  })

  await check('invalid provider, origin, token, limits, or quota configuration is not healthy', async () => {
    const validEnv = {
      LLM_API_KEY: 'x',
      LLM_ALLOWED_ORIGIN: ORIGIN,
      LLM_PROXY_TOKEN: PROXY_TOKEN,
      LLM_EDGE_TOKEN: EDGE_TOKEN,
      LLM_QUOTA_STATE_FILE: '/var/lib/space-ai-platform/quota/daily.json',
    }
    assert.equal(loadConfig(validEnv).baseUrl, 'https://api.minimax.cn/v1')
    assert.equal(loadConfig({ ...validEnv, LLM_BASE_URL: 'https://provider.example/v1' }).baseUrlValid, false)
    assert.equal(loadConfig({ ...validEnv, LLM_MODEL: 'other' }).modelValid, false)
    assert.equal(loadConfig({ ...validEnv, LLM_ALLOWED_ORIGIN: 'http://space.example' }).allowedOriginValid, false)
    assert.equal(loadConfig({ ...validEnv, LLM_PROXY_TOKEN: 'short' }).proxyTokenValid, false)
    assert.equal(loadConfig({ ...validEnv, LLM_PROXY_TOKEN: `${PROXY_TOKEN}:bad` }).proxyTokenValid, false)
    assert.equal(loadConfig({ ...validEnv, LLM_EDGE_TOKEN: 'short' }).edgeTokenValid, false)
    assert.equal(loadConfig({ ...validEnv, LLM_EDGE_TOKEN: PROXY_TOKEN }).serviceTokensDistinct, false)
    assert.equal(loadConfig({ ...validEnv, LLM_MAX_COMPLETION_TOKENS: '2049' }).limitsValid, false)
    assert.equal(loadConfig({ ...validEnv, LLM_GLOBAL_RATE_LIMIT_PER_MINUTE: '101' }).limitsValid, false)
    assert.equal(loadConfig({ ...validEnv, LLM_DAILY_LIMIT: '101' }).dailyQuota.valid, false)
  })

  await check('dual-token configuration fails health closed despite forged validation flags', async () => {
    const invalidConfigs = [
      { ...baseConfig, edgeToken: '', edgeTokenValid: true },
      { ...baseConfig, edgeToken: 'short', edgeTokenValid: true },
      { ...baseConfig, proxyToken: '', proxyTokenValid: true },
      { ...baseConfig, proxyToken: 'short', proxyTokenValid: true },
      {
        ...baseConfig,
        edgeToken: PROXY_TOKEN,
        edgeTokenValid: true,
        proxyTokenValid: true,
        serviceTokensDistinct: true,
      },
    ]
    for (const config of invalidConfigs) {
      const invalidQuota = makeQuota()
      let fetchCount = 0
      const invalidProxy = createLlmProxyServer(config, {
        fetch: async () => { fetchCount += 1; throw new Error('must not fetch') },
        quota: invalidQuota,
      })
      extraServers.push(invalidProxy)
      const port = await listen(invalidProxy)
      assert.equal((await nativeFetch(`http://127.0.0.1:${port}/health`)).status, 503)
      assert.equal(invalidQuota.inspectCount, 0)
      assert.equal(fetchCount, 0)
    }
  })

  await check('missing or wrong dual tokens fail before boundary, rate, quota, and upstream work', async () => {
    const authQuota = makeQuota()
    const beforeUpstream = upstreamRequests.length
    const authProxy = createLlmProxyServer({
      ...baseConfig,
      rateLimitPerMinute: 1,
      globalRateLimitPerMinute: 1,
    }, {
      fetch: transportFetch,
      quota: authQuota,
    })
    extraServers.push(authProxy)
    const port = await listen(authProxy)
    const url = `http://127.0.0.1:${port}/chat/completions`
    const cases = [
      { 'x-space-edge-token': undefined },
      { 'x-space-edge-token': 'wrong-edge-token-0123456789-abcdef' },
      { 'x-space-proxy-token': undefined },
      { 'x-space-proxy-token': 'wrong-proxy-token-0123456789-abcde' },
    ]
    for (const headers of cases) {
      const options = chatOptions('auth-failure', {
        headers: {
          origin: 'https://wrong.example',
          'x-forwarded-proto': 'http',
          'x-space-client-ip': 'not-an-ip',
          ...headers,
        },
      })
      for (const [key, value] of Object.entries(headers)) {
        if (value === undefined) delete options.headers[key]
      }
      const response = await nativeFetch(url, options)
      assert.equal(response.status, 401)
    }
    assert.equal(authQuota.reserveCount, 0)
    assert.equal(upstreamRequests.length, beforeUpstream)
    assert.equal((await nativeFetch(url, chatOptions('auth-control'))).status, 200)
    assert.equal(authQuota.reserveCount, 1)
    assert.equal(upstreamRequests.length, beforeUpstream + 1)
  })

  await check('duplicate edge or proxy token headers are rejected before quota and upstream', async () => {
    const duplicateQuota = makeQuota()
    let fetchCount = 0
    const duplicateProxy = createLlmProxyServer(baseConfig, {
      fetch: async () => { fetchCount += 1; throw new Error('must not fetch') },
      quota: duplicateQuota,
    })
    extraServers.push(duplicateProxy)
    const port = await listen(duplicateProxy)
    const url = `http://127.0.0.1:${port}/chat/completions`
    const duplicateEdge = await rawChatRequest(url, { edgeToken: [EDGE_TOKEN, EDGE_TOKEN] })
    const duplicateProxyToken = await rawChatRequest(url, { proxyToken: [PROXY_TOKEN, PROXY_TOKEN] })
    assert.equal(duplicateEdge.status, 401)
    assert.equal(duplicateProxyToken.status, 401)
    assert.doesNotMatch(duplicateEdge.body + duplicateProxyToken.body, new RegExp(`${EDGE_TOKEN}|${PROXY_TOKEN}`))
    assert.equal(duplicateQuota.reserveCount, 0)
    assert.equal(fetchCount, 0)
  })

  await check('edge and proxy tokens never reach upstream responses or structured logs', async () => {
    const response = await nativeFetch(`${proxyUrl}/chat/completions`, chatOptions('service-token-leak-check'))
    const responseText = await response.text()
    assert.equal(response.status, 200)
    const sent = upstreamRequests.at(-1)
    assert.equal(sent.edgeToken, undefined)
    assert.equal(sent.proxyToken, undefined)
    const evidence = `${responseText}\n${JSON.stringify(sent)}\n${JSON.stringify(proxyLogs)}`
    assert.doesNotMatch(evidence, new RegExp(`${EDGE_TOKEN}|${PROXY_TOKEN}`))
    assert.doesNotMatch(evidence, /x-space-(?:edge|proxy)-token/i)
  })

  assert.equal(passed, 28)
  console.log(`LLM proxy security tests: ${passed}/${passed} passed`)
} finally {
  for (const server of extraServers.reverse()) await close(server)
  await close(proxy)
  await close(upstream)
}
