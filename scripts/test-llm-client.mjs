import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { transformWithEsbuild } from 'vite'

const source = await readFile(new URL('../src/ai/parser/llmClient.ts', import.meta.url), 'utf8')

async function loadClient(enabled) {
  const instrumented = `${source}\nexport { makePayload as __makePayload, requestCompletion as __requestCompletion }\n`
  const transformed = await transformWithEsbuild(instrumented, 'llmClient.ts', {
    define: {
      'import.meta.env.BASE_URL': '"/space-ai-platform/"',
      'import.meta.env.DEV': 'false',
      'import.meta.env.PROD': 'true',
      'import.meta.env.VITE_LLM_ENABLED': JSON.stringify(enabled ? 'true' : 'false'),
      'import.meta.env.VITE_LLM_MODEL': '"ignored-client-model"',
    },
    format: 'esm',
    loader: 'ts',
    target: 'es2022',
  })
  const encoded = Buffer.from(transformed.code).toString('base64')
  return import(`data:text/javascript;base64,${encoded}#${enabled ? 'enabled' : 'disabled'}`)
}

let passed = 0
async function check(name, action) {
  await action()
  passed += 1
  process.stdout.write(`ok ${passed} - ${name}\n`)
}

const nativeFetch = globalThis.fetch
try {
  const enabledClient = await loadClient(true)

  await check('API path is resolved below Vite BASE_URL with one separator', async () => {
    assert.equal(enabledClient.resolveLlmApiPath('/space-ai-platform/'), '/space-ai-platform/api/llm/chat/completions')
    assert.equal(enabledClient.resolveLlmApiPath('/space-ai-platform'), '/space-ai-platform/api/llm/chat/completions')
    assert.equal(enabledClient.resolveLlmApiPath('/'), '/api/llm/chat/completions')
    for (const invalid of [
      'https://evil.example/app/',
      '//evil.example/app/',
      '/app/?next=evil',
      '/app/#fragment',
      '/../outside/',
      '/%2e%2e/outside/',
      'relative/',
    ]) {
      assert.throws(() => enabledClient.resolveLlmApiPath(invalid), /Vite BASE_URL/)
    }
  })

  await check('production request uses the project-subpath same-origin endpoint', async () => {
    let captured
    globalThis.fetch = async (url, options) => {
      captured = { url, options }
      return new Response('{"choices":[]}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    const response = await enabledClient.__requestCompletion({ messages: [] })
    assert.equal(response.status, 200)
    assert.equal(captured.url, '/space-ai-platform/api/llm/chat/completions')
    assert.equal(captured.options.method, 'POST')
    assert.deepEqual(Object.keys(captured.options.headers), ['Content-Type'])
  })

  await check('browser error detail is bounded to 500 characters and does not read success', async () => {
    globalThis.fetch = async () => new Response('x'.repeat(2_000), { status: 429 })
    let error
    try {
      await enabledClient.__requestCompletion({ messages: [] })
    } catch (caught) {
      error = caught
    }
    assert.ok(error instanceof Error)
    assert.equal((error.message.match(/x/g) ?? []).length, 500)
    assert.ok(error.message.length < 600)
  })

  await check('production payload ignores a browser-selected model', async () => {
    const payload = enabledClient.__makePayload('system', 'user', {
      model: 'browser-selected-model',
      temperature: 0,
    })
    assert.equal(payload.model, 'MiniMax-M3')
    assert.equal(payload.response_format.type, 'json_object')
  })

  await check('non-stream length truncation is rejected even when content is valid JSON', async () => {
    globalThis.fetch = async () => new Response(
      '{"choices":[{"finish_reason":"length","message":{"content":"{\\"version\\":1}"}}]}',
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
    await assert.rejects(
      enabledClient.callLLM('system', 'user'),
      /长度上限/,
    )
  })

  await check('AI-off production build fails locally before fetch', async () => {
    const disabledClient = await loadClient(false)
    let fetchCount = 0
    globalThis.fetch = async () => {
      fetchCount += 1
      return new Response('{}')
    }
    await assert.rejects(
      disabledClient.__requestCompletion({ messages: [] }),
      /在线 AI 尚未在安全入口启用/,
    )
    assert.equal(fetchCount, 0)
  })

  await check('stream ending without the provider DONE sentinel is an error', async () => {
    globalThis.fetch = async () => new Response(
      'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    )
    const events = []
    for await (const event of enabledClient.streamLLM('system', 'user')) events.push(event)
    assert.deepEqual(events.map(({ type }) => type), ['delta', 'error'])
    assert.match(events.at(-1).content, /未正常结束/)
  })

  await check('stream finish_reason length is an error rather than completion', async () => {
    globalThis.fetch = async () => new Response(
      'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n',
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    )
    const events = []
    for await (const event of enabledClient.streamLLM('system', 'user')) events.push(event)
    assert.deepEqual(events.map(({ type }) => type), ['error'])
    assert.match(events[0].content, /长度上限/)
  })

  assert.equal(passed, 8)
  console.log(`LLM browser client tests: ${passed}/${passed} passed`)
} finally {
  globalThis.fetch = nativeFetch
}
