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
  const suite = await server.ssrLoadModule('/src/test/topology/topologyCoreSuite.ts')
  if (typeof suite.runTopologyCoreSuite !== 'function') {
    throw new Error('topologyCoreSuite.ts must export runTopologyCoreSuite()')
  }
  const result = await suite.runTopologyCoreSuite()
  console.log(
    `[topology:test] ${result.passed} tests passed in ${result.durationMs.toFixed(1)}ms`,
  )
} finally {
  await server.close()
}
