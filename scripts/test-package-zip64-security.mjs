import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'

const TIMEOUT_MS = 5_000
const packageLock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'))
assert.equal(packageLock.packages['node_modules/fflate']?.version, '0.8.3')

const childSource = `
  import { createServer } from 'vite'
  const server = await createServer({
    configFile: false,
    envDir: false,
    root: process.cwd(),
    appType: 'custom',
    logLevel: 'error',
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false, ws: false },
  })
  try {
    const [{ parsePackageZipV1 }, { parsePackageZipV2 }] = await Promise.all([
      server.ssrLoadModule('/src/adapters/package/zipV1.ts'),
      server.ssrLoadModule('/src/adapters/package/zipV2.ts'),
    ])
    const malicious = new Uint8Array(22)
    const view = new DataView(malicious.buffer)
    view.setUint32(0, 0x06054b50, true)
    view.setUint16(4, 0, true)
    view.setUint16(6, 0, true)
    view.setUint16(8, 0xffff, true)
    view.setUint16(10, 0xffff, true)
    view.setUint32(12, 0xffffffff, true)
    view.setUint32(16, 0xffffffff, true)
    view.setUint16(20, 0, true)
    const uriV1 = 'https://space-model-package.invalid/space-model-package.v1.json'
    const uriV2 = 'https://space-model.invalid/space-model-package.v2.json'
    const v1 = parsePackageZipV1(malicious, uriV1)
    const v2 = parsePackageZipV2(malicious, uriV2)
    process.stdout.write(JSON.stringify({
      v1: v1.ok ? 'UNSAFE_SUCCESS' : v1.diagnostic.code,
      v2: v2.ok ? 'UNSAFE_SUCCESS' : v2.diagnostic.code,
    }))
  } finally {
    await server.close()
  }
`

const startedAt = Date.now()
const result = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['--input-type=module', '--eval', childSource], {
    cwd: process.cwd(),
    env: { NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const stdout = []
  const stderr = []
  let outputBytes = 0
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    child.kill('SIGKILL')
  }, TIMEOUT_MS)
  child.stdout.on('data', (chunk) => {
    outputBytes += chunk.length
    if (outputBytes > 8_192) child.kill('SIGKILL')
    else stdout.push(chunk)
  })
  child.stderr.on('data', (chunk) => {
    outputBytes += chunk.length
    if (outputBytes > 8_192) child.kill('SIGKILL')
    else stderr.push(chunk)
  })
  child.once('error', reject)
  child.once('close', (code) => {
    clearTimeout(timeout)
    if (timedOut) {
      reject(new Error(`ZIP64 parser exceeded ${TIMEOUT_MS}ms isolation timeout`))
      return
    }
    if (outputBytes > 8_192) {
      reject(new Error('ZIP64 parser exceeded the bounded diagnostic output'))
      return
    }
    if (code !== 0) {
      reject(new Error(`ZIP64 parser child exited ${code}: ${Buffer.concat(stderr).toString('utf8').slice(0, 500)}`))
      return
    }
    try {
      resolve(JSON.parse(Buffer.concat(stdout).toString('utf8')))
    } catch {
      reject(new Error('ZIP64 parser child returned invalid output'))
    }
  })
})

assert.equal(result.v1, 'PACKAGE_FIELD_INVALID')
assert.equal(result.v2, 'PACKAGE_FIELD_INVALID')
assert.ok(Date.now() - startedAt < TIMEOUT_MS)

console.log('Package ZIP64 security tests: 4/4 passed (fflate 0.8.3, v1/v2 fail closed in bounded child).')
