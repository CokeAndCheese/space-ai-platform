import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  root: process.cwd(),
  appType: 'custom',
  logLevel: 'error',
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, hmr: false, ws: false },
})

try {
  const suite = await server.ssrLoadModule('/src/test/package/packageV2Suite.ts')
  const result = await suite.runPackageV2Suite()
  console.log(`[standard-model-package-v2:test] ${result.passed} tests passed in ${result.durationMs.toFixed(1)}ms`)
} finally {
  await server.close()
}
