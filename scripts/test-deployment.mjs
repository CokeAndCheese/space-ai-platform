import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const nginx = read('deploy/nginx.static.conf')
const dockerfile = read('Dockerfile')
const compose = read('compose.yml')
const ignore = read('.dockerignore')

assert.match(nginx, /location = \/api \{ return 404; \}/)
assert.match(nginx, /location \^~ \/api\/ \{ return 404; \}/)
assert.doesNotMatch(nginx, /proxy_pass|LLM_PROXY_TOKEN/)
assert.match(nginx, /location = \/health/)
assert.match(nginx, /"service":"space-ai-platform"/)
assert.match(nginx, /try_files \$uri \$uri\/ \/index\.html;/)
for (const path of ['assets', 'models', 'draco']) {
  assert.ok(nginx.includes(`location /${path}/ {`))
}

assert.match(dockerfile, /COPY deploy\/nginx\.static\.conf \/etc\/nginx\/conf\.d\/default\.conf/)
assert.doesNotMatch(dockerfile, /COPY deploy\/nginx\.conf|ENV LLM_PROXY_TOKEN/)
assert.match(dockerfile, /ARG VITE_LLM_ENABLED=false/)
assert.match(compose, /VITE_LLM_ENABLED: "false"/)
assert.doesNotMatch(compose, /\n\s+ports:/)
assert.match(compose, /profiles:\n\s+- llm/)
assert.match(compose, /create_host_path: false/)
for (const excluded of ['.git', '.env', '.env.*', 'node_modules', 'public/models', 'docs/reusable-project-team-template']) {
  assert.ok(ignore.split('\n').includes(excluded), `Docker context must exclude ${excluded}`)
}

const manifest = execFileSync('git', ['show', 'HEAD:src/model-manifest.json'])
const summary = JSON.parse(read('deploy/model-assets.summary.json'))
const index = read('deploy/model-assets.sha256')
assert.equal(digest(manifest), summary.sourceManifestSha256)
assert.equal(digest(index), summary.indexSha256)
let totalBytes = 0
const files = new Set()
for (const line of index.trim().split('\n')) {
  const match = line.match(/^([a-f0-9]{64})  (models\/.+\.(?:glb|json))$/)
  assert.ok(match, 'invalid asset index entry')
  const [, expected, path] = match
  assert.ok(!path.split('/').includes('..') && !files.has(path), 'unsafe or duplicate asset path')
  files.add(path)
  const bytes = readFileSync(new URL(`../public/${path}`, import.meta.url))
  assert.equal(digest(bytes), expected, `asset digest: ${path}`)
  totalBytes += bytes.length
}
assert.equal(files.size, summary.fileCount)
assert.equal(totalBytes, summary.totalBytes)
console.log(`Deployment static/config/asset checks: PASS (${files.size} assets, ${totalBytes} bytes).`)
console.log('Container HTTP, gateway and public URL checks remain separate deployment gates.')
