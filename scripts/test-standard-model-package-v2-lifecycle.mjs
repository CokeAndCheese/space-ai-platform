import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'

const server = await createServer({
  configFile: false,
  root: process.cwd(),
  appType: 'custom',
  logLevel: 'error',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('../src', import.meta.url)),
    },
  },
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, hmr: false, ws: false },
})

try {
  const suite = await server.ssrLoadModule('/src/test/package/packageV2LifecycleSuite.ts')
  if (typeof suite.runPackageV2LifecycleSuite !== 'function') {
    throw new Error('packageV2LifecycleSuite.ts must export runPackageV2LifecycleSuite()')
  }
  const result = await suite.runPackageV2LifecycleSuite()
  console.log(
    `[standard-model-package-v2-lifecycle:test] ${result.passed} tests passed ` +
    `in ${result.durationMs.toFixed(1)}ms`,
  )
} finally {
  await server.close()
}
