import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, rmSync, writeFile } from 'node:fs'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const mkdtempAsync = promisify(mkdtemp)
const mkdirAsync = promisify(mkdir)
const readFileAsync = promisify(readFile)
const rmAsync = promisify(rm)
const writeFileAsync = promisify(writeFile)

const MIN_COMPOSE_VERSION = '2.24.4'
const NGINX_IMAGE = 'nginx:1.30.4-alpine@sha256:dc5069ad14f19660b141b21236140b91656bf89bbc3e2417c70ae650cd66104c'
const NODE_IMAGE = 'node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32'
const LABEL_KEY = 'com.space-ai-platform.container-boundary-test'
const TEST_PROXY_TOKEN = 'fixture-proxy-token-0123456789-abcdef'
const TEST_EDGE_TOKEN = 'fixture-edge-token-0123456789-abcdefg'
const TEST_ORIGIN = 'https://space.example'
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const runId = `${process.pid}-${randomBytes(5).toString('hex')}`
const prefix = `sap-edge-${runId}`
const names = {
  edge: `${prefix}-edge`,
  edgeNegative: `${prefix}-edge-negative`,
  edgePositive: `${prefix}-edge-positive`,
  egress: `${prefix}-egress`,
  private: `${prefix}-private`,
  proxy: `${prefix}-proxy`,
  shared: `${prefix}-shared`,
  sibling: `${prefix}-sibling`,
  web: `${prefix}-web`,
}
const safeEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => (
  !/^(?:COMPOSE_|LLM_|SPACE_AI_|VITE_LLM_)/.test(key)
)))
const createdContainers = []
const createdNetworks = []
let tempRoot
let fixtureStatePath

function docker(args, { allowFailure = false, timeout = 20_000 } = {}) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    env: safeEnvironment,
    maxBuffer: 1024 * 1024,
    timeout,
  })
  if (!allowFailure && (result.error || result.status !== 0)) {
    const detail = String(result.stderr || result.error?.message || 'unknown Docker failure').trim().slice(0, 600)
    throw new Error(`Docker fixture command failed (exit ${result.status ?? 'spawn'}): ${detail}`)
  }
  return result
}

function observeRequestResult(result, requestCase) {
  const lines = String(result.stdout ?? '').trim().split(/\r?\n/).filter(Boolean)
  if (lines.length === 0) return null
  assert.equal(lines.length, 1, `${requestCase} emitted an unexpected number of result records`)
  const report = JSON.parse(lines[0])
  assert.deepEqual(Object.keys(report).sort(), ['errorCode', 'status', 'transport'])
  assert.ok(report.transport === 'http' || report.transport === 'unreachable')
  if (report.transport === 'http') {
    assert.equal(Number.isInteger(report.status), true)
    assert.ok(report.status >= 100 && report.status <= 599)
    assert.equal(report.errorCode, null)
  } else {
    assert.equal(report.status, null)
    assert.match(report.errorCode, /^[A-Za-z0-9_:-]{1,64}$/)
  }
  process.stdout.write(`${JSON.stringify({
    event: 'container_request_result',
    case: requestCase,
    transport: report.transport,
    status: report.status,
    errorCode: report.errorCode,
  })}\n`)
  return report
}

function runClientRequest(container, requestCase, args, { allowCommandFailure = false, timeout = 5_000 } = {}) {
  if (container === names.edgeNegative) {
    assert.equal(args.some((value) => String(value).includes(TEST_EDGE_TOKEN)), false)
  }
  const result = docker([
    'container', 'exec', container,
    'node', '/fixture/client.mjs', ...args,
  ], { allowFailure: true, timeout })
  const report = observeRequestResult(result, requestCase)
  if (!allowCommandFailure) {
    assert.ok(report, `${requestCase} did not emit a request result`)
    assert.equal(result.status, 0, `${requestCase} client assertion failed`)
  }
  return { exitCode: result.status, report }
}

function assertDeniedOrUnreachable(report) {
  assert.ok(report)
  if (report.transport === 'unreachable') return
  assert.ok(report.status < 200 || report.status >= 300)
}

function parseVersion(value) {
  const match = String(value).trim().match(/^v?(\d+)\.(\d+)\.(\d+)/)
  if (!match) throw new Error('Unable to parse Docker Compose version')
  return match.slice(1).map(Number)
}

function versionAtLeast(actual, minimum) {
  const left = parseVersion(actual)
  const right = parseVersion(minimum)
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index]
  }
  return true
}

function inspectContainer(name) {
  const result = docker(['container', 'inspect', name], { allowFailure: true })
  if (result.status !== 0) return null
  return JSON.parse(result.stdout)[0]
}

function inspectNetwork(name) {
  const result = docker(['network', 'inspect', name], { allowFailure: true })
  if (result.status !== 0) return null
  return JSON.parse(result.stdout)[0]
}

function safeRemoveContainer(name) {
  const inspected = inspectContainer(name)
  if (!inspected) return
  assert.equal(inspected.Config?.Labels?.[LABEL_KEY], runId, `refusing to remove unowned container ${name}`)
  docker(['container', 'rm', '--force', name])
}

function safeRemoveNetwork(name) {
  const inspected = inspectNetwork(name)
  if (!inspected) return
  assert.equal(inspected.Labels?.[LABEL_KEY], runId, `refusing to remove unowned network ${name}`)
  docker(['network', 'rm', name])
}

function cleanupSync() {
  for (const name of [...createdContainers].reverse()) {
    try { safeRemoveContainer(name) } catch { /* normal path reports cleanup failures */ }
  }
  for (const name of [...createdNetworks].reverse()) {
    try { safeRemoveNetwork(name) } catch { /* normal path reports cleanup failures */ }
  }
  if (tempRoot) {
    try { rmSync(tempRoot, { force: true, recursive: true }) } catch { /* OS temp cleanup fallback */ }
  }
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.once(signal, () => {
    cleanupSync()
    process.kill(process.pid, signal)
  })
}

function createNetwork(name, internal = false) {
  assert.equal(inspectNetwork(name), null, `fixture network already exists: ${name}`)
  const args = ['network', 'create', '--label', `${LABEL_KEY}=${runId}`]
  if (internal) args.push('--internal')
  args.push(name)
  docker(args)
  createdNetworks.push(name)
}

function createContainer(name, args) {
  assert.equal(inspectContainer(name), null, `fixture container already exists: ${name}`)
  docker(['container', 'create', '--name', name, '--label', `${LABEL_KEY}=${runId}`, '--pull=never', ...args])
  createdContainers.push(name)
}

function containerNetworkNames(inspected) {
  return Object.keys(inspected.NetworkSettings?.Networks ?? {}).sort()
}

function networkContainerNames(inspected) {
  return Object.values(inspected.Containers ?? {}).map(({ Name }) => Name).sort()
}

async function waitForWeb() {
  let last
  for (let attempt = 0; attempt < 30; attempt += 1) {
    last = runClientRequest(
      names.edgeNegative,
      `fixture-web-health-${attempt + 1}`,
      ['health', 'http://space-ai-platform-web/health'],
      { allowCommandFailure: true },
    )
    if (last.exitCode === 0 && last.report?.transport === 'http' && last.report.status === 200) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`AI web fixture did not become reachable from edge (exit ${last?.exitCode ?? 'unknown'})`)
}

async function waitForProxy() {
  let last
  for (let attempt = 0; attempt < 30; attempt += 1) {
    last = docker([
      'container', 'exec', names.proxy,
      'node', '--input-type=module', '--eval',
      "try { const response = await fetch('http://127.0.0.1:8787/health'); console.log(JSON.stringify({ transport: 'http', status: response.status, errorCode: null })); if (!response.ok) process.exit(1) } catch (error) { const code = String(error?.cause?.code ?? error?.code ?? 'REQUEST_FAILED').replace(/[^A-Za-z0-9_:-]/g, '_').slice(0, 64) || 'REQUEST_FAILED'; console.log(JSON.stringify({ transport: 'unreachable', status: null, errorCode: code })); process.exit(1) }",
    ], { allowFailure: true, timeout: 5_000 })
    const report = observeRequestResult(last, `fixture-proxy-health-${attempt + 1}`)
    if (last.status === 0 && report?.transport === 'http' && report.status === 200) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`actual proxy fixture did not become healthy (exit ${last?.status ?? 'unknown'})`)
}

async function readFixtureState() {
  return JSON.parse(await readFileAsync(fixtureStatePath, 'utf8'))
}

let passed = 0
function check(name, action) {
  action()
  passed += 1
  process.stdout.write(`ok ${passed} - ${name}\n`)
}

async function main() {
  tempRoot = await mkdtempAsync(join(tmpdir(), 'space-ai-edge-boundary-'))
  const staticRoot = join(tempRoot, 'html')
  const fixtureRoot = join(tempRoot, 'fixture')
  const modelRoot = join(tempRoot, 'models')
  const quotaRoot = join(tempRoot, 'quota')
  const sourceRoot = join(tempRoot, 'source')
  const sourceServerRoot = join(sourceRoot, 'server')
  const stateRoot = join(tempRoot, 'state')
  await Promise.all([
    mkdirAsync(staticRoot, { recursive: true }),
    mkdirAsync(fixtureRoot, { recursive: true }),
    mkdirAsync(modelRoot, { recursive: true }),
    mkdirAsync(quotaRoot, { recursive: true }),
    mkdirAsync(sourceServerRoot, { recursive: true }),
    mkdirAsync(stateRoot, { recursive: true }),
  ])

  const [baseCompose, aiCompose, nginxTemplate, proxySource, quotaSource] = await Promise.all([
    readFileAsync(join(repoRoot, 'compose.yml'), 'utf8'),
    readFileAsync(join(repoRoot, 'compose.ai.yml'), 'utf8'),
    readFileAsync(join(repoRoot, 'deploy/nginx.ai.conf.template'), 'utf8'),
    readFileAsync(join(repoRoot, 'server/llm-proxy.mjs'), 'utf8'),
    readFileAsync(join(repoRoot, 'server/llm-quota.mjs'), 'utf8'),
  ])
  const baseComposePath = join(tempRoot, 'compose.yml')
  const aiComposePath = join(tempRoot, 'compose.ai.yml')
  const envPath = join(tempRoot, '.env.runtime')
  const nginxTemplatePath = join(tempRoot, 'nginx.ai.conf.template')
  const proxyFixturePath = join(fixtureRoot, 'proxy-fixture.mjs')
  const clientPath = join(fixtureRoot, 'client.mjs')
  fixtureStatePath = join(stateRoot, 'counters.json')

  await Promise.all([
    writeFileAsync(baseComposePath, baseCompose),
    writeFileAsync(aiComposePath, aiCompose),
    writeFileAsync(nginxTemplatePath, nginxTemplate),
    writeFileAsync(join(sourceServerRoot, 'llm-proxy.mjs'), proxySource),
    writeFileAsync(join(sourceServerRoot, 'llm-quota.mjs'), quotaSource),
    writeFileAsync(join(staticRoot, 'index.html'), '<!doctype html><title>edge fixture</title>'),
    writeFileAsync(envPath, [
      'LLM_API_KEY=test-only-provider-placeholder',
      `LLM_PROXY_TOKEN=${TEST_PROXY_TOKEN}`,
      `LLM_EDGE_TOKEN=${TEST_EDGE_TOKEN}`,
      `LLM_ALLOWED_ORIGIN=${TEST_ORIGIN}`,
      `SPACE_AI_EDGE_NETWORK=${names.edge}`,
      `SPACE_AI_MODEL_DIR=${modelRoot}`,
      `SPACE_AI_QUOTA_DIR=${quotaRoot}`,
      'SPACE_AI_RELEASE=test-only',
      '',
    ].join('\n'), { mode: 0o600 }),
    writeFileAsync(fixtureStatePath, JSON.stringify({ quotaReservations: 0, upstreamRequests: 0, upstreamTokenLeak: false })),
    writeFileAsync(proxyFixturePath, `
      import { writeFileSync } from 'node:fs'
      import {
        createLlmProxyServer,
        MINIMAX_BASE_URL,
        MINIMAX_MODEL,
      } from 'file:///repo/server/llm-proxy.mjs'

      const proxyToken = ${JSON.stringify(TEST_PROXY_TOKEN)}
      const edgeToken = ${JSON.stringify(TEST_EDGE_TOKEN)}
      const statePath = '/state/counters.json'
      const state = { quotaReservations: 0, upstreamRequests: 0, upstreamTokenLeak: false }
      const persist = () => writeFileSync(statePath, JSON.stringify(state))
      const quota = {
        async inspect() { return { date: '2026-09-12', count: state.quotaReservations, limit: 100 } },
        async reserve() {
          state.quotaReservations += 1
          persist()
          return { date: '2026-09-12', count: state.quotaReservations, limit: 100 }
        },
      }
      const fakeFetch = async (url, options = {}) => {
        const headers = new Headers(options.headers)
        state.upstreamRequests += 1
        state.upstreamTokenLeak = headers.has('x-space-edge-token')
          || headers.has('x-space-proxy-token')
          || [...headers.values()].some((value) => value.includes(edgeToken) || value.includes(proxyToken))
        persist()
        if (state.upstreamTokenLeak) throw new Error('service token reached fake upstream')
        if (url !== MINIMAX_BASE_URL + '/chat/completions') throw new Error('unexpected upstream URL')
        return new Response('{"choices":[{"message":{"content":"ok"}}]}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      const config = {
        apiKey: 'fixture-provider-key',
        baseUrl: MINIMAX_BASE_URL,
        baseUrlValid: true,
        model: MINIMAX_MODEL,
        modelValid: true,
        proxyToken,
        proxyTokenValid: true,
        edgeToken,
        edgeTokenValid: true,
        serviceTokensDistinct: true,
        allowedOrigin: ${JSON.stringify(TEST_ORIGIN)},
        allowedOriginValid: true,
        port: 8787,
        maxBodyBytes: 65_536,
        requestReadTimeoutMs: 1_000,
        timeoutMs: 2_000,
        maxUpstreamBodyBytes: 65_536,
        maxStreamBytes: 65_536,
        maxCompletionTokens: 2_048,
        rateLimitPerMinute: 60,
        globalRateLimitPerMinute: 100,
        maxConcurrent: 2,
        maxConcurrentPerClient: 1,
        dailyQuota: { valid: true },
        limitsValid: true,
      }
      persist()
      createLlmProxyServer(config, { fetch: fakeFetch, quota, log: () => {} })
        .listen(8787, '0.0.0.0')
    `),
    writeFileAsync(clientPath, `
      import assert from 'node:assert/strict'
      import http from 'node:http'

      const [mode, url, edgeMode = 'wrong'] = process.argv.slice(2)
      const requestBody = '{"messages":[{"role":"user","content":"fixture"}]}'
      const requestApi = () => new Promise((resolve, reject) => {
        const headers = {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(requestBody),
          origin: ${JSON.stringify(TEST_ORIGIN)},
          'x-forwarded-proto': 'https',
          'x-space-client-ip': '198.51.100.90',
          'x-space-proxy-token': 'sibling-forged-token',
        }
        if (edgeMode === 'correct') {
          assert.match(process.env.FIXTURE_EDGE_TOKEN ?? '', /^[A-Za-z0-9_-]{32,256}$/)
          headers['x-space-edge-token'] = process.env.FIXTURE_EDGE_TOKEN
        }
        if (edgeMode === 'wrong') headers['x-space-edge-token'] = 'sibling-forged-edge-token-0123456789'
        if (edgeMode === 'repeated') {
          headers['x-space-edge-token'] = [
            'sibling-forged-edge-token-0123456789',
            'second-forged-edge-token-0123456789',
          ]
        }
        const request = http.request(url, { method: 'POST', headers }, (response) => {
          response.resume()
          response.once('end', () => resolve(response.statusCode))
        })
        request.setTimeout(1500, () => request.destroy(new Error('request timeout')))
        request.once('error', reject)
        request.end(requestBody)
      })

      const observe = async (requestAction) => {
        try {
          return { transport: 'http', status: await requestAction(), errorCode: null }
        } catch (error) {
          const errorCode = String(error?.cause?.code ?? error?.code ?? 'REQUEST_FAILED')
            .replace(/[^A-Za-z0-9_:-]/g, '_')
            .slice(0, 64) || 'REQUEST_FAILED'
          return { transport: 'unreachable', status: null, errorCode }
        }
      }

      let report

      if (mode === 'attack-denied') {
        report = await observe(requestApi)
      } else if (mode === 'health') {
        report = await observe(async () => (await fetch(url, { signal: AbortSignal.timeout(3000) })).status)
      } else if (mode === 'api') {
        report = await observe(requestApi)
      } else if (mode === 'not-found') {
        report = await observe(async () => (await fetch(url, { signal: AbortSignal.timeout(3000) })).status)
      } else {
        throw new Error('unknown client fixture mode')
      }

      process.stdout.write(JSON.stringify(report) + '\\n')
      if (mode === 'attack-denied') {
        assert.ok(report.transport === 'unreachable' || report.status < 200 || report.status >= 300)
      } else if (mode === 'health' || mode === 'api') {
        assert.equal(report.transport, 'http')
        assert.equal(report.status, 200)
      } else if (mode === 'not-found') {
        assert.equal(report.transport, 'http')
        assert.equal(report.status, 404)
      }
    `),
  ])

  const composeVersion = docker(['compose', 'version', '--short']).stdout.trim()
  check('Docker Compose supports !override (minimum 2.24.4)', () => {
    assert.equal(versionAtLeast(composeVersion, MIN_COMPOSE_VERSION), true)
  })

  const composeArgs = [
    'compose', '--project-directory', tempRoot, '--env-file', envPath,
    '-f', baseComposePath, '-f', aiComposePath, '--profile', 'llm',
    'config', '--format', 'json',
  ]
  const merged = JSON.parse(docker(composeArgs).stdout)
  const defaultModel = JSON.parse(docker([
    'compose', '--project-directory', tempRoot, '--env-file', envPath,
    '-f', baseComposePath, 'config', '--format', 'json',
  ]).stdout)

  check('default static model retains shared web and AI-off build', () => {
    assert.equal(defaultModel.services.web.build.target, 'static-runtime')
    assert.equal(String(defaultModel.services.web.build.args.VITE_LLM_ENABLED), 'false')
    assert.deepEqual(Object.keys(defaultModel.services.web.networks).sort(), ['llm-internal', 'web'])
  })
  check('merged AI web replaces shared web with exclusive edge plus private network', () => {
    assert.equal(merged.services.web.build.target, 'ai-runtime')
    assert.deepEqual(Object.keys(merged.services.web.networks).sort(), ['llm-internal', 'space-ai-platform-edge'])
    assert.equal(merged.networks['space-ai-platform-edge'].external, true)
    assert.equal(merged.networks['space-ai-platform-edge'].name, names.edge)
    assert.equal(merged.services.web.environment.LLM_EDGE_TOKEN, undefined)
    assert.equal(merged.services.web.environment.LLM_API_KEY, undefined)
  })
  check('merged proxy stays private plus egress with no public network or host port', () => {
    assert.deepEqual(Object.keys(merged.services['llm-proxy'].networks).sort(), ['llm-egress', 'llm-internal'])
    assert.equal(merged.services['llm-proxy'].environment.LLM_EDGE_TOKEN, TEST_EDGE_TOKEN)
    assert.equal(merged.services['llm-proxy'].environment.LLM_PROXY_TOKEN, TEST_PROXY_TOKEN)
    assert.equal(merged.services['llm-proxy'].ports, undefined)
    assert.equal(merged.services.web.ports, undefined)
  })

  for (const image of [NGINX_IMAGE, NODE_IMAGE]) {
    const inspected = docker(['image', 'inspect', image], { allowFailure: true })
    if (inspected.status !== 0) throw new Error('Required fixed fixture image is not cached; refusing to pull')
  }
  check('all Docker fixtures use cached digest-pinned images with --pull=never', () => {})

  createNetwork(names.shared)
  createNetwork(names.edge)
  createNetwork(names.private, true)
  createNetwork(names.egress)

  const clientMount = `type=bind,src=${clientPath},dst=/fixture/client.mjs,readonly`
  const proxyFixtureMount = `type=bind,src=${proxyFixturePath},dst=/fixture/proxy-fixture.mjs,readonly`
  const sourceMount = `type=bind,src=${sourceRoot},dst=/repo,readonly`
  const stateMount = `type=bind,src=${stateRoot},dst=/state`
  createContainer(names.proxy, [
    '--network', names.private,
    '--network-alias', 'llm-proxy',
    '--mount', proxyFixtureMount,
    '--mount', sourceMount,
    '--mount', stateMount,
    NODE_IMAGE, 'node', '/fixture/proxy-fixture.mjs',
  ])
  docker(['network', 'connect', names.egress, names.proxy])
  createContainer(names.web, [
    '--network', names.edge,
    '--network-alias', 'space-ai-platform-web',
    '--env', `LLM_PROXY_TOKEN=${TEST_PROXY_TOKEN}`,
    '--env', 'NGINX_ENVSUBST_FILTER=^LLM_PROXY_TOKEN$',
    '--mount', `type=bind,src=${nginxTemplatePath},dst=/etc/nginx/templates/default.conf.template,readonly`,
    '--mount', `type=bind,src=${staticRoot},dst=/usr/share/nginx/html,readonly`,
    NGINX_IMAGE,
  ])
  docker(['network', 'connect', names.private, names.web])
  createContainer(names.sibling, [
    '--network', names.shared,
    '--mount', clientMount,
    NODE_IMAGE, 'node', '--eval', 'setInterval(() => {}, 60000)',
  ])
  createContainer(names.edgeNegative, [
    '--network', names.edge,
    '--mount', clientMount,
    NODE_IMAGE, 'node', '--eval', 'setInterval(() => {}, 60000)',
  ])
  createContainer(names.edgePositive, [
    '--network', names.edge,
    '--env', `FIXTURE_EDGE_TOKEN=${TEST_EDGE_TOKEN}`,
    '--mount', clientMount,
    NODE_IMAGE, 'node', '--eval', 'setInterval(() => {}, 60000)',
  ])

  for (const name of [names.proxy, names.web, names.sibling, names.edgeNegative, names.edgePositive]) {
    docker(['container', 'start', name])
  }
  await waitForProxy()
  await waitForWeb()

  const web = inspectContainer(names.web)
  const proxy = inspectContainer(names.proxy)
  const edgeNegative = inspectContainer(names.edgeNegative)
  const edgePositive = inspectContainer(names.edgePositive)
  const sibling = inspectContainer(names.sibling)
  const edgeIp = web.NetworkSettings.Networks[names.edge]?.IPAddress
  const clientSource = await readFileAsync(clientPath, 'utf8')

  check('fixture runtime and production services have exact memberships and no host ports', () => {
    assert.deepEqual(containerNetworkNames(web), [names.edge, names.private].sort())
    assert.deepEqual(containerNetworkNames(proxy), [names.egress, names.private].sort())
    assert.deepEqual(containerNetworkNames(edgeNegative), [names.edge])
    assert.deepEqual(containerNetworkNames(edgePositive), [names.edge])
    assert.deepEqual(containerNetworkNames(sibling), [names.shared])
    for (const inspected of [web, proxy, edgeNegative, edgePositive, sibling]) {
      assert.deepEqual(inspected.HostConfig.PortBindings ?? {}, {})
    }
    const productionEdgeServices = Object.entries(merged.services)
      .filter(([, service]) => Object.hasOwn(service.networks ?? {}, 'space-ai-platform-edge'))
      .map(([name]) => name)
    assert.deepEqual(productionEdgeServices, ['web'])
    assert.ok(edgeIp)
  })
  check('reachable negative edge client has no correct token material or non-client mount', () => {
    assert.equal((edgeNegative.Config.Env ?? []).some((value) => value.startsWith('FIXTURE_EDGE_TOKEN=')), false)
    assert.deepEqual((edgeNegative.Mounts ?? []).map(({ Destination }) => Destination), ['/fixture/client.mjs'])
    assert.equal(clientSource.includes(TEST_EDGE_TOKEN), false)
    assert.equal(JSON.stringify(edgeNegative.Config.Cmd).includes(TEST_EDGE_TOKEN), false)
  })
  check('fixture edge has two isolated clients plus web; production requires only Caddy plus web', () => {
    assert.deepEqual(
      networkContainerNames(inspectNetwork(names.edge)),
      [names.edgeNegative, names.edgePositive, names.web].sort(),
    )
  })

  const sharedDns = runClientRequest(names.sibling, 'shared-sibling-dns-wrong-edge', [
    'attack-denied', 'http://space-ai-platform-web/api/llm/chat/completions', 'wrong',
  ])
  let counters = await readFixtureState()
  check('shared sibling DNS request is unreachable or denied before quota and upstream', () => {
    assertDeniedOrUnreachable(sharedDns.report)
    assert.equal(counters.quotaReservations, 0)
    assert.equal(counters.upstreamRequests, 0)
  })

  const knownIpMissing = runClientRequest(names.sibling, 'shared-sibling-known-ip-missing-edge', [
    'attack-denied', `http://${edgeIp}/api/llm/chat/completions`, 'missing',
  ])
  counters = await readFixtureState()
  check('known-IP request with missing edge token is denied before quota and upstream', () => {
    assertDeniedOrUnreachable(knownIpMissing.report)
    assert.equal(counters.quotaReservations, 0)
    assert.equal(counters.upstreamRequests, 0)
  })

  const knownIpWrong = runClientRequest(names.sibling, 'shared-sibling-known-ip-wrong-edge', [
    'attack-denied', `http://${edgeIp}/api/llm/chat/completions`, 'wrong',
  ])
  counters = await readFixtureState()
  check('known-IP request with forged edge token is denied before quota and upstream', () => {
    assertDeniedOrUnreachable(knownIpWrong.report)
    assert.equal(counters.quotaReservations, 0)
    assert.equal(counters.upstreamRequests, 0)
  })

  const knownIpRepeated = runClientRequest(names.sibling, 'shared-sibling-known-ip-repeated-edge', [
    'attack-denied', `http://${edgeIp}/api/llm/chat/completions`, 'repeated',
  ])
  counters = await readFixtureState()
  check('known-IP request with repeated edge token is denied before quota and upstream', () => {
    assertDeniedOrUnreachable(knownIpRepeated.report)
    assert.equal(counters.quotaReservations, 0)
    assert.equal(counters.upstreamRequests, 0)
  })

  for (const edgeMode of ['missing', 'wrong', 'repeated']) {
    const negative = runClientRequest(names.edgeNegative, `reachable-edge-negative-${edgeMode}`, [
      'attack-denied', 'http://space-ai-platform-web/api/llm/chat/completions', edgeMode,
    ])
    counters = await readFixtureState()
    check(`reachable edge request with ${edgeMode} edge token returns 401 with zero counters`, () => {
      assert.equal(negative.report.transport, 'http')
      assert.equal(negative.report.status, 401)
      assert.equal(counters.quotaReservations, 0)
      assert.equal(counters.upstreamRequests, 0)
    })
  }

  const positive = runClientRequest(names.edgePositive, 'reachable-edge-positive-correct', [
    'api', 'http://space-ai-platform-web/api/llm/chat/completions', 'correct',
  ])
  counters = await readFixtureState()
  check('fake edge reaches exact API once through actual proxy and Nginx token injection', () => {
    assert.equal(positive.report.transport, 'http')
    assert.equal(positive.report.status, 200)
    assert.equal(counters.quotaReservations, 1)
    assert.equal(counters.upstreamRequests, 1)
    assert.equal(counters.upstreamTokenLeak, false)
  })

  for (const path of ['/api/llm/health', '/api/llm/chat/completions/', '/api/llm']) {
    const neighbor = runClientRequest(names.edgePositive, `reachable-edge-neighbor-${path}`, [
      'not-found', `http://space-ai-platform-web${path}`,
    ])
    assert.equal(neighbor.report.transport, 'http')
    assert.equal(neighbor.report.status, 404)
  }
  counters = await readFixtureState()
  check('fake edge neighboring API paths remain 404 without additional quota or upstream work', () => {
    assert.equal(counters.quotaReservations, 1)
    assert.equal(counters.upstreamRequests, 1)
  })

  assert.equal(passed, 17)
  console.log(`Online container boundary tests: ${passed}/${passed} passed`)
}

let primaryError
try {
  await main()
} catch (error) {
  primaryError = error
} finally {
  const cleanupErrors = []
  for (const name of [...createdContainers].reverse()) {
    try { safeRemoveContainer(name) } catch (error) { cleanupErrors.push(error) }
  }
  for (const name of [...createdNetworks].reverse()) {
    try { safeRemoveNetwork(name) } catch (error) { cleanupErrors.push(error) }
  }
  if (tempRoot) {
    try { await rmAsync(tempRoot, { force: true, recursive: true }) } catch (error) { cleanupErrors.push(error) }
  }
  if (cleanupErrors.length > 0) {
    primaryError = new AggregateError([...(primaryError ? [primaryError] : []), ...cleanupErrors], 'fixture cleanup failed')
  }
}

if (primaryError) throw primaryError
