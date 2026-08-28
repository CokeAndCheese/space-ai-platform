import { createServer } from 'vite'
const server = await createServer({ configFile: false, root: process.cwd(), appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false, ws: false } })
try {
  const suite = await server.ssrLoadModule('/src/test/package/packageSuite.ts')
  const closeoutSuite = await server.ssrLoadModule('/src/test/package/packageCloseoutSuite.ts')
  const result = await suite.runPackageSuite()
  const closeout = await closeoutSuite.runPackageCloseoutSuite()
  console.log(`[standard-model-package:test] ${result.passed + closeout.passed} tests passed in ${(result.durationMs + closeout.durationMs).toFixed(1)}ms`)
} finally { await server.close() }
