import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const [
  dockerfile,
  defaultCompose,
  aiCompose,
  nginxTemplate,
  envExample,
  llmClient,
  chatPanel,
  llmProxy,
  deploymentDoc,
  containerBoundaryTest,
] = await Promise.all([
  read('Dockerfile'),
  read('compose.yml'),
  read('compose.ai.yml'),
  read('deploy/nginx.ai.conf.template'),
  read('.env.runtime.example'),
  read('src/ai/parser/llmClient.ts'),
  read('src/views/ChatPanel.vue'),
  read('server/llm-proxy.mjs'),
  read('docs/TENCENT_LIGHTHOUSE_DEPLOYMENT.md'),
  read('scripts/test-online-container-boundary.mjs'),
])

const defaultWeb = defaultCompose.match(/services:\n  web:([\s\S]*?)\n  llm-proxy:/)?.[1] ?? ''
const aiWeb = aiCompose.match(/services:\n  web:([\s\S]*?)\n  llm-proxy:/)?.[1] ?? ''
const aiProxy = aiCompose.match(/\n  llm-proxy:([\s\S]*?)\nnetworks:/)?.[1] ?? ''

let passed = 0
function check(name, action) {
  action()
  passed += 1
  process.stdout.write(`ok ${passed} - ${name}\n`)
}

check('default Compose remains static, AI-off, and profile-gated', () => {
  assert.match(defaultCompose, /target: static-runtime/)
  assert.match(defaultCompose, /VITE_LLM_ENABLED: "false"/)
  assert.match(defaultCompose, /profiles:\n\s+- llm/)
  assert.doesNotMatch(defaultCompose, /\n\s+ports:/)
  assert.match(defaultWeb, /networks:\n\s+- web\n\s+- llm-internal/)
  assert.doesNotMatch(defaultWeb, /space-ai-platform-edge/)
})

check('AI override explicitly selects the AI runtime, build flag, and replacement networks', () => {
  assert.match(aiCompose, /target: ai-runtime/)
  assert.match(aiCompose, /VITE_LLM_ENABLED: "true"/)
  assert.match(aiCompose, /condition: service_healthy/)
  assert.match(aiWeb, /networks: !override\n\s+- space-ai-platform-edge\n\s+- llm-internal/)
  assert.doesNotMatch(aiWeb, /\n\s+- web\s*$/m)
})

check('web runtime config excludes edge and provider secrets while Nginx relays the request-scoped edge header', () => {
  const web = aiCompose.match(/services:\n  web:([\s\S]*?)\n  llm-proxy:/)?.[1] ?? ''
  assert.match(web, /LLM_PROXY_TOKEN/)
  assert.doesNotMatch(web, /LLM_EDGE_TOKEN|LLM_API_KEY|LLM_BASE_URL|LLM_MODEL|env_file/)
  assert.match(nginxTemplate, /proxy_set_header X-Space-Edge-Token \$http_x_space_edge_token;/)
})

check('dedicated edge is external and defaults to the project-exclusive name', () => {
  assert.match(aiCompose, /space-ai-platform-edge:\n\s+external: true\n\s+name: \$\{SPACE_AI_EDGE_NETWORK:-space-ai-platform-edge\}/)
})

check('proxy has no host port, shared web, or edge network and gets dedicated egress', () => {
  assert.doesNotMatch(aiProxy, /\n\s+ports:/)
  assert.doesNotMatch(aiProxy, /\n\s+- (?:web|space-ai-platform-edge)\s*$/m)
  assert.match(aiProxy, /\n\s+- llm-internal\s*$/m)
  assert.match(aiProxy, /\n\s+- llm-egress\s*$/m)
  assert.match(aiProxy, /LLM_PROXY_TOKEN: \$\{LLM_PROXY_TOKEN:\?LLM_PROXY_TOKEN is required\}/)
  assert.match(aiProxy, /LLM_EDGE_TOKEN: \$\{LLM_EDGE_TOKEN:\?LLM_EDGE_TOKEN is required\}/)
  assert.match(aiCompose, /llm-egress:\n\s+driver: bridge/)
})

check('quota storage is an explicit persistent bind and Docker cannot auto-create it', () => {
  assert.match(aiCompose, /LLM_QUOTA_STATE_FILE: \/var\/lib\/space-ai-platform\/quota\/daily\.json/)
  assert.match(aiCompose, /source: \$\{SPACE_AI_QUOTA_DIR:-\/srv\/apps\/space-ai-platform-data\/llm-quota\}/)
  assert.match(aiCompose, /create_host_path: false/)
  assert.match(aiCompose, /LLM_DAILY_LIMIT: "100"/)
  assert.match(aiCompose, /LLM_QUOTA_TIME_ZONE: Asia\/Shanghai/)
})

check('provider and generation settings are fixed in the server-only proxy service', () => {
  assert.match(aiCompose, /LLM_BASE_URL: https:\/\/api\.minimax\.cn\/v1/)
  assert.match(aiCompose, /LLM_MODEL: MiniMax-M3/)
  assert.match(aiCompose, /LLM_MAX_COMPLETION_TOKENS: "2048"/)
})

check('Docker keeps static runtime unchanged and adds an explicit filtered AI runtime', () => {
  assert.match(dockerfile, /FROM static-runtime AS ai-runtime/)
  assert.match(dockerfile, /COPY deploy\/nginx\.ai\.conf\.template \/etc\/nginx\/templates\/default\.conf\.template/)
  assert.match(dockerfile, /NGINX_ENVSUBST_FILTER="\^LLM_PROXY_TOKEN\$"/)
  assert.match(dockerfile, /COPY server\/llm-quota\.mjs \.\/server\/llm-quota\.mjs/)
  assert.match(dockerfile, /COPY deploy\/nginx\.static\.conf \/etc\/nginx\/conf\.d\/default\.conf/)
})

check('Nginx exposes only the project-internal API route and injects the service token', () => {
  assert.match(nginxTemplate, /location = \/api\/llm\/chat\/completions/)
  assert.match(nginxTemplate, /rewrite \^\/api\/llm\/chat\/completions\$ \/chat\/completions break;/)
  assert.match(nginxTemplate, /proxy_set_header X-Space-Proxy-Token "\$\{LLM_PROXY_TOKEN\}";/)
  assert.match(nginxTemplate, /location \^~ \/api\/ \{ return 404; \}/)
  assert.doesNotMatch(nginxTemplate, /location .+\/api\/llm\/health/)
})

check('Nginx passes only Caddy-controlled client and HTTPS boundary headers', () => {
  assert.match(nginxTemplate, /proxy_set_header X-Space-Client-IP \$http_x_space_client_ip;/)
  assert.match(nginxTemplate, /proxy_set_header X-Space-Edge-Token \$http_x_space_edge_token;/)
  assert.match(nginxTemplate, /proxy_set_header X-Forwarded-Proto \$http_x_forwarded_proto;/)
  assert.match(nginxTemplate, /proxy_set_header Origin \$http_origin;/)
  assert.match(nginxTemplate, /proxy_set_header X-Forwarded-For "";/)
  assert.doesNotMatch(nginxTemplate, /proxy_add_x_forwarded_for/)
})

check('proxy validates two distinct token domains before origin, limits, quota, or upstream', () => {
  assert.match(llmProxy, /SERVICE_TOKEN_PATTERN = \/\^\[A-Za-z0-9_-\]\{32,256\}\$\//)
  assert.match(llmProxy, /SERVICE_TOKEN_PATTERN\.test\(config\.proxyToken\)/)
  assert.match(llmProxy, /SERVICE_TOKEN_PATTERN\.test\(config\.edgeToken\)/)
  assert.match(llmProxy, /!secureTokenMatches\(config\.proxyToken, config\.edgeToken\)/)
  assert.match(llmProxy, /uniqueRequestHeader\(request, 'x-space-edge-token'\)/)
  assert.match(llmProxy, /uniqueRequestHeader\(request, 'x-space-proxy-token'\)/)
  const authIndex = llmProxy.indexOf('const edgeAuthorized = secureTokenMatches')
  const originIndex = llmProxy.indexOf('request.headers.origin', authIndex)
  const rateIndex = llmProxy.indexOf('if (!takeGlobalRateSlot', authIndex)
  const quotaIndex = llmProxy.indexOf('await quota.reserve()', authIndex)
  const fetchIndex = llmProxy.indexOf('await fetchImpl', authIndex)
  assert.ok(authIndex > 0 && authIndex < originIndex)
  assert.ok(authIndex < rateIndex && authIndex < quotaIndex && authIndex < fetchIndex)
})

check('AI proxying disables buffering and retains static assets and SPA fallback', () => {
  assert.match(nginxTemplate, /proxy_buffering off;/)
  assert.match(nginxTemplate, /proxy_request_buffering off;/)
  for (const path of ['assets', 'models', 'draco']) {
    assert.ok(nginxTemplate.includes(`location /${path}/ {`))
  }
  assert.match(nginxTemplate, /try_files \$uri \$uri\/ \/index\.html;/)
  assert.ok((nginxTemplate.match(/X-Content-Type-Options "nosniff"/g) ?? []).length >= 4)
})

check('browser client uses Vite BASE_URL and never embeds a provider URL or key', () => {
  assert.match(llmClient, /resolveLlmApiPath\(import\.meta\.env\.BASE_URL\)/)
  assert.match(llmClient, /api\/llm\/chat\/completions/)
  assert.doesNotMatch(llmClient, /fetch\(['"]\/api\/llm|api\.minimax|import\.meta\.env\.VITE_LLM_API_KEY/)
  assert.match(llmClient, /MAX_ERROR_DETAIL_BYTES = 512/)
})

check('production settings state the fixed model, subpath proxy, and shared daily limit', () => {
  assert.match(chatPanel, /服务器固定模型/)
  assert.match(chatPanel, /浏览器设置不能更换供应商、模型或输出预算/)
  assert.match(chatPanel, /同源项目子路径/)
  assert.match(chatPanel, /全站匿名访客共享 100 次\/天（Asia\/Shanghai 日界）/)
})

check('runtime example contains only server names and the verified MiniMax endpoint', () => {
  assert.match(envExample, /LLM_BASE_URL=https:\/\/api\.minimax\.cn\/v1/)
  assert.match(envExample, /LLM_GLOBAL_RATE_LIMIT_PER_MINUTE=60/)
  assert.match(envExample, /LLM_DAILY_LIMIT=100/)
  assert.match(envExample, /LLM_PROXY_TOKEN=\nLLM_EDGE_TOKEN=/)
  assert.match(envExample, /two independent 32-256 character base64url values; they must differ/)
  assert.doesNotMatch(envExample, /^VITE_/m)
})

check('runbook gates Compose support and treats network membership as defense in depth', () => {
  assert.match(deploymentDoc, /Docker Compose 2\.24\.4 or later/)
  assert.match(deploymentDoc, /https:\/\/docs\.docker\.com\/reference\/compose-file\/merge\//)
  assert.match(deploymentDoc, /space-ai-platform-edge/)
  assert.match(deploymentDoc, /Only Caddy and this project's `web`/)
  assert.match(deploymentDoc, /Network membership alone/)
  assert.match(deploymentDoc, /known edge IP/)
  assert.match(deploymentDoc, /X-Space-Client-IP \{http\.request\.remote\.host\}/)
  assert.match(deploymentDoc, /AI `web` has no edge-token environment variable, configuration field, or persistent copy/)
  assert.match(deploymentDoc, /Nginx necessarily receives that header in request memory/)
  assert.match(deploymentDoc, /`web`\/Nginx is part of the trusted computing base/)
  assert.match(deploymentDoc, /does not protect an already compromised Caddy, `web`\/Nginx, `llm-proxy`, or Docker\/root administrator/)
  assert.doesNotMatch(deploymentDoc, /`web` receives no edge token/)
})

check('runbook uses runtime Caddy edge token injection and deletes token fields from both log scopes', () => {
  const caddyRoute = deploymentDoc.match(/```caddyfile\n([\s\S]*?)```/)?.[1] ?? ''
  assert.match(caddyRoute, /X-Space-Edge-Token \{env\.LLM_EDGE_TOKEN\}/)
  assert.doesNotMatch(caddyRoute, /\{\$LLM_EDGE_TOKEN\}/)
  assert.match(deploymentDoc, /never use the parse-time environment expansion `\{\$LLM_EDGE_TOKEN\}`/)
  assert.match(deploymentDoc, /request>headers>X-Space-Edge-Token delete/)
  assert.match(deploymentDoc, /request>headers>X-Space-Proxy-Token delete/)
  assert.match(deploymentDoc, /global `log default`/)
  assert.match(deploymentDoc, /site access-log `log`/)
  assert.match(deploymentDoc, /caddyserver\.com\/docs\/caddyfile\/directives\/reverse_proxy/)
  assert.match(deploymentDoc, /caddyserver\.com\/docs\/caddyfile\/concepts/)
  assert.match(deploymentDoc, /caddyserver\.com\/docs\/caddyfile\/directives\/log/)
})

check('runbook rollback restores a recorded static image without build or pull', () => {
  const rollback = deploymentDoc.match(/## Rollback([\s\S]*?)## Source delivery/)?.[1] ?? ''
  assert.match(rollback, /space-ai-platform:static-\$\{SPACE_AI_EXACT_SHA\}/)
  assert.match(deploymentDoc, /space-ai-platform:ai-\$\{SPACE_AI_EXACT_SHA\}/)
  assert.match(rollback, /docker image inspect/)
  assert.match(rollback, /--no-build --pull never --no-deps/)
  assert.doesNotMatch(rollback, /(?:^|\s)--build(?:\s|$)/m)
})

check('runbook handles abandoned quota locks without resetting state', () => {
  assert.match(deploymentDoc, /daily\.json\.lock/)
  assert.match(deploymentDoc, /rmdir/)
  assert.match(deploymentDoc, /Never remove it automatically/)
  assert.match(deploymentDoc, /Never remove or reinitialize the file/)
  assert.match(deploymentDoc, /without writing state or calling the provider/)
})

check('container boundary fixture is local-only, fixed-image, and cleanup-scoped', () => {
  assert.match(containerBoundaryTest, /MIN_COMPOSE_VERSION = '2\.24\.4'/)
  assert.match(containerBoundaryTest, /--pull=never/)
  assert.match(containerBoundaryTest, /com\.space-ai-platform\.container-boundary-test/)
  assert.match(containerBoundaryTest, /createLlmProxyServer/)
  assert.match(containerBoundaryTest, /fakeFetch/)
  assert.match(containerBoundaryTest, /sourceServerRoot/)
  assert.match(containerBoundaryTest, /llm-proxy\.mjs/)
  assert.match(containerBoundaryTest, /llm-quota\.mjs/)
  assert.doesNotMatch(containerBoundaryTest, /src=\$\{repoRoot\},dst=\/repo/)
  assert.match(containerBoundaryTest, /quotaReservations/)
  assert.match(containerBoundaryTest, /upstreamRequests/)
  assert.match(containerBoundaryTest, /attack-denied/)
  assert.match(containerBoundaryTest, /container_request_result/)
  assert.match(containerBoundaryTest, /transport: report\.transport/)
  assert.match(containerBoundaryTest, /status: report\.status/)
  assert.match(containerBoundaryTest, /assertDeniedOrUnreachable/)
  assert.match(containerBoundaryTest, /method: 'POST'/)
  assert.match(containerBoundaryTest, /x-forwarded-proto/)
  assert.match(containerBoundaryTest, /x-space-client-ip/)
  assert.match(containerBoundaryTest, /x-space-proxy-token/)
  assert.match(containerBoundaryTest, /x-space-edge-token/)
  assert.match(containerBoundaryTest, /edgeMode === 'repeated'/)
  assert.match(containerBoundaryTest, /FIXTURE_EDGE_TOKEN/)
  assert.ok((containerBoundaryTest.match(/\/api\/llm\/chat\/completions/g) ?? []).length >= 3)
  assert.match(containerBoundaryTest, /known-IP request with missing edge token/)
  assert.match(containerBoundaryTest, /known-IP request with forged edge token/)
  assert.match(containerBoundaryTest, /known-IP request with repeated edge token/)
  assert.match(containerBoundaryTest, /for \(const edgeMode of \['missing', 'wrong', 'repeated'\]\)/)
  assert.match(containerBoundaryTest, /assert\.equal\(negative\.report\.status, 401\)/)
  assert.match(containerBoundaryTest, /assert\.equal\(positive\.report\.status, 200\)/)
  assert.match(containerBoundaryTest, /assert\.equal\(counters\.quotaReservations, 0\)/)
  assert.match(containerBoundaryTest, /assert\.equal\(counters\.upstreamRequests, 0\)/)
  assert.match(containerBoundaryTest, /assert\.equal\(counters\.quotaReservations, 1\)/)
  assert.match(containerBoundaryTest, /assert\.equal\(counters\.upstreamRequests, 1\)/)
  assert.match(containerBoundaryTest, /productionEdgeServices/)
  assert.match(containerBoundaryTest, /Object\.hasOwn\(service\.networks \?\? \{\}, 'space-ai-platform-edge'\)/)
  assert.match(containerBoundaryTest, /\[names\.edgeNegative, names\.edgePositive, names\.web\]\.sort\(\)/)
  const negativeClient = containerBoundaryTest.match(/createContainer\(names\.edgeNegative, \[([\s\S]*?)\n  \]\)/)?.[1] ?? ''
  const positiveClient = containerBoundaryTest.match(/createContainer\(names\.edgePositive, \[([\s\S]*?)\n  \]\)/)?.[1] ?? ''
  assert.match(negativeClient, /'--mount', clientMount/)
  assert.doesNotMatch(negativeClient, /FIXTURE_EDGE_TOKEN|TEST_EDGE_TOKEN|sourceMount|stateMount|fixtureRoot/)
  assert.match(positiveClient, /FIXTURE_EDGE_TOKEN=\$\{TEST_EDGE_TOKEN\}/)
  assert.match(containerBoundaryTest, /\(edgeNegative\.Mounts \?\? \[\]\)\.map/)
  assert.match(containerBoundaryTest, /clientSource\.includes\(TEST_EDGE_TOKEN\), false/)
  assert.match(containerBoundaryTest, /container === names\.edgeNegative/)
  assert.match(containerBoundaryTest, /args\.some\(\(value\) => String\(value\)\.includes\(TEST_EDGE_TOKEN\)\)/)
  assert.match(containerBoundaryTest, /assert\.equal\(passed, 17\)/)
  assert.match(containerBoundaryTest, /safeRemoveContainer/)
  assert.match(containerBoundaryTest, /safeRemoveNetwork/)
})

assert.equal(passed, 20)
console.log(`Online deployment wiring tests: ${passed}/${passed} passed`)
