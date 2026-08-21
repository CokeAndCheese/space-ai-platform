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
  const suite = await server.ssrLoadModule('/src/test/templates/topologyQuickActionSuite.ts')
  if (typeof suite.runTopologyQuickActionSuite !== 'function') {
    throw new Error('topologyQuickActionSuite.ts must export runTopologyQuickActionSuite()')
  }
  const result = await suite.runTopologyQuickActionSuite()
  console.log(
    `[topology-quick-action:test] ${result.passed} tests passed in ${result.durationMs.toFixed(1)}ms`,
  )
} finally {
  await server.close()
}
