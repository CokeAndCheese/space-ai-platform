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
  const suite = await server.ssrLoadModule('/src/test/glbTopology/glbTopologySuite.ts')
  if (typeof suite.runGlbTopologySuite !== 'function') {
    throw new Error('glbTopologySuite.ts must export runGlbTopologySuite()')
  }
  const result = await suite.runGlbTopologySuite()
  console.log(
    `[glb-topology:test] ${result.passed} tests passed in ${result.durationMs.toFixed(1)}ms`,
  )
} finally {
  await server.close()
}
