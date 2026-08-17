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
  const suite = await server.ssrLoadModule('/src/test/objects/objectsToolSuite.ts')
  if (typeof suite.runObjectsToolSuite !== 'function') {
    throw new Error('objectsToolSuite.ts must export runObjectsToolSuite()')
  }
  const result = await suite.runObjectsToolSuite()
  console.log(`[objects:test] ${result.passed} tests passed in ${result.durationMs.toFixed(1)}ms`)
} finally {
  await server.close()
}
