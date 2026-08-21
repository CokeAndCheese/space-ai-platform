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
  const suite = await server.ssrLoadModule('/src/test/topology/sceneLifecycleSuite.ts')
  if (typeof suite.runTopologySceneLifecycleSuite !== 'function') {
    throw new Error('sceneLifecycleSuite.ts must export runTopologySceneLifecycleSuite()')
  }
  const result = await suite.runTopologySceneLifecycleSuite()
  console.log(
    `[topology-scene-lifecycle:test] ${result.passed} tests passed in ${result.durationMs.toFixed(1)}ms`,
  )
} finally {
  await server.close()
}
