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
  const suite = await server.ssrLoadModule('/src/test/package/packageLifecycleSuite.ts')
  if (typeof suite.runPackageLifecycleSuite !== 'function') {
    throw new Error('packageLifecycleSuite.ts must export runPackageLifecycleSuite()')
  }
  const result = await suite.runPackageLifecycleSuite()
  console.log(
    `[standard-model-package-lifecycle:test] ${result.passed} tests passed in ${result.durationMs.toFixed(1)}ms`,
  )
} finally {
  await server.close()
}
