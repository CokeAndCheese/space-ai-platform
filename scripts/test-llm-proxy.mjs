import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import http from 'node:http'
import { once } from 'node:events'
import { createLlmProxyServer, loadConfig } from '../server/llm-proxy.mjs'

async function listen(server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return server.address().port
}

async function close(server) {
  if (!server?.listening) return
  server.close()
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
      origin: 'https://space.example',
      'x-space-proxy-token': 'test-proxy-token',
      ...overrides.headers,
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content }],
      ...overrides.body,
    }),
  }
}

const upstreamRequests = []
const upstream = http.createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  const content = body.messages[0].content
  upstreamRequests.push({ authorization: request.headers.authorization, body })

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
  if (content === 'disconnect-stream') {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write('data: first\n\n')
    const interval = setInterval(() => response.write('data: waiting\n\n'), 25)
    response.once('close', () => clearInterval(interval))
    return
  }

  response.writeHead(200, { 'content-type': 'application/json' })
  response.end('{"choices":[{"message":{"content":"ok"}}]}')
})

const upstreamPort = await listen(upstream)
const nativeFetch = globalThis.fetch
let fetchAbortCount = 0

// Rewrite only the test transport. The proxy still validates an HTTPS provider
// URL and exercises the real request/response and AbortSignal paths.
globalThis.fetch = async (url, options) => {
  options?.signal?.addEventListener('abort', () => { fetchAbortCount += 1 }, { once: true })
  const rewritten = String(url).replace(
    `https://127.0.0.1:${upstreamPort}`,
    `http://127.0.0.1:${upstreamPort}`,
  )
  return nativeFetch(rewritten, options)
}

const baseConfig = {
  apiKey: 'test-provider-key',
  baseUrl: `https://127.0.0.1:${upstreamPort}`,
  baseUrlValid: true,
  model: 'server-owned-model',
  proxyToken: 'test-proxy-token',
  allowedOrigin: 'https://space.example',
  allowedOriginValid: true,
  port: 0,
  maxBodyBytes: 512,
  maxUpstreamBodyBytes: 256,
  timeoutMs: 200,
  rateLimitPerMinute: 100,
  maxConcurrent: 1,
  maxConcurrentPerClient: 1,
}

const proxy = createLlmProxyServer(baseConfig)
const proxyPort = await listen(proxy)
const proxyUrl = `http://127.0.0.1:${proxyPort}`
let rateProxy

try {
  const health = await nativeFetch(`${proxyUrl}/health`)
  assert.equal(health.status, 200)

  const unauthorized = await nativeFetch(`${proxyUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"messages":[{"role":"user","content":"x"}]}',
  })
  assert.equal(unauthorized.status, 401)

  const deniedOrigin = await nativeFetch(
    `${proxyUrl}/chat/completions`,
    chatOptions('x', { headers: { origin: 'https://wrong.example' } }),
  )
  assert.equal(deniedOrigin.status, 403)

  const success = await nativeFetch(
    `${proxyUrl}/chat/completions`,
    chatOptions('hello', {
      body: {
        model: 'client-controlled-model',
        response_format: { type: 'json_object' },
      },
    }),
  )
  assert.equal(success.status, 200)
  assert.equal((await success.json()).choices[0].message.content, 'ok')
  assert.equal(upstreamRequests.length, 1)
  assert.equal(upstreamRequests[0].authorization, 'Bearer test-provider-key')
  assert.equal(upstreamRequests[0].body.model, 'server-owned-model')

  const oversized = await nativeFetch(
    `${proxyUrl}/chat/completions`,
    chatOptions('x'.repeat(600)),
  )
  assert.equal(oversized.status, 413)

  const abortsBeforeTimeout = fetchAbortCount
  const hangingRequest = nativeFetch(
    `${proxyUrl}/chat/completions`,
    chatOptions('hang-after-headers'),
  )
  await waitFor(() => upstreamRequests.some(({ body }) => body.messages[0].content === 'hang-after-headers'))
  const concurrencyLimited = await nativeFetch(
    `${proxyUrl}/chat/completions`,
    chatOptions('concurrent'),
  )
  assert.equal(concurrencyLimited.status, 429)
  const timedOut = await hangingRequest
  assert.equal(timedOut.status, 504)
  assert.ok(fetchAbortCount > abortsBeforeTimeout)
  const recovered = await nativeFetch(
    `${proxyUrl}/chat/completions`,
    chatOptions('recovered'),
  )
  assert.equal(recovered.status, 200)

  const upstreamTooLarge = await nativeFetch(
    `${proxyUrl}/chat/completions`,
    chatOptions('oversized-upstream'),
  )
  assert.equal(upstreamTooLarge.status, 502)
  assert.equal((await upstreamTooLarge.json()).error.code, 'UPSTREAM_RESPONSE_TOO_LARGE')

  const abortsBeforeDisconnect = fetchAbortCount
  await new Promise((resolve, reject) => {
    let settled = false
    const request = http.request(
      `${proxyUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://space.example',
          'x-space-proxy-token': 'test-proxy-token',
        },
      },
      (response) => {
        response.once('data', () => {
          settled = true
          response.destroy()
          resolve()
        })
      },
    )
    request.once('error', (error) => {
      if (!settled) reject(error)
    })
    request.end(JSON.stringify({
      messages: [{ role: 'user', content: 'disconnect-stream' }],
      stream: true,
    }))
  })
  await waitFor(() => fetchAbortCount > abortsBeforeDisconnect)

  rateProxy = createLlmProxyServer({ ...baseConfig, rateLimitPerMinute: 1 })
  const rateProxyPort = await listen(rateProxy)
  const rateUrl = `http://127.0.0.1:${rateProxyPort}/chat/completions`
  const firstRateRequest = await nativeFetch(rateUrl, chatOptions('rate-first'))
  assert.equal(firstRateRequest.status, 200)
  const secondRateRequest = await nativeFetch(rateUrl, chatOptions('rate-second'))
  assert.equal(secondRateRequest.status, 429)

  const invalidOrigin = loadConfig({
    LLM_API_KEY: 'x',
    LLM_BASE_URL: 'https://provider.example/v1',
    LLM_MODEL: 'x',
    LLM_PROXY_TOKEN: 'x',
    LLM_ALLOWED_ORIGIN: 'http://space.example',
  })
  assert.equal(invalidOrigin.allowedOriginValid, false)

  const [nginxConfig, composeConfig, dockerfile] = await Promise.all([
    readFile(new URL('../deploy/nginx.conf', import.meta.url), 'utf8'),
    readFile(new URL('../compose.yml', import.meta.url), 'utf8'),
    readFile(new URL('../Dockerfile', import.meta.url), 'utf8'),
  ])
  assert.match(nginxConfig, /location \/api\/llm\//)
  assert.match(nginxConfig, /rewrite \^\/api\/llm\/\(\.\*\)\$ \/\$1 break;/)
  assert.match(nginxConfig, /proxy_set_header Origin \$http_origin;/)
  assert.match(nginxConfig, /proxy_set_header X-Space-Proxy-Token "\$\{LLM_PROXY_TOKEN\}";/)
  assert.match(composeConfig, /llm-internal:\n    internal: true/)
  assert.doesNotMatch(
    composeConfig.match(/  llm-proxy:[\s\S]*?\nnetworks:/)?.[0] ?? '',
    /\n      - web\n/,
  )
  assert.match(dockerfile, /ARG VITE_LLM_ENABLED=false/)
  assert.match(dockerfile, /ARG VITE_APP_BASE=\/space-ai-platform\//)

  console.log('LLM proxy/deployment tests: 10/10 passed')
} finally {
  globalThis.fetch = nativeFetch
  await close(rateProxy)
  await close(proxy)
  await close(upstream)
}
