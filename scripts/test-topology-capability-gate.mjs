import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'

const server = await createServer({
  configFile: false,
  root: process.cwd(),
  appType: 'custom',
  logLevel: 'error',
  resolve: {
    alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) },
  },
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, hmr: false, ws: false },
})

try {
  const suite = await server.ssrLoadModule('/src/test/templates/topologyCapabilityGateSuite.ts')
  if (typeof suite.runTopologyCapabilityGateSuite !== 'function') {
    throw new Error('topologyCapabilityGateSuite.ts must export runTopologyCapabilityGateSuite()')
  }
  const result = await suite.runTopologyCapabilityGateSuite()
  console.log(
    `[topology-capability-gate:test] ${result.passed} tests passed ` +
    `in ${result.durationMs.toFixed(1)}ms`,
  )
} finally {
  await server.close()
}
