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
  const suite = await server.ssrLoadModule('/src/test/templates/templateV3Suite.ts')
  if (typeof suite.runTemplateV3Suite !== 'function') {
    throw new Error('templateV3Suite.ts must export runTemplateV3Suite()')
  }
  const result = await suite.runTemplateV3Suite()
  console.log(
    `[templates:v3:test] ${result.passed} tests passed in ${result.durationMs.toFixed(1)}ms`,
  )
} finally {
  await server.close()
}
