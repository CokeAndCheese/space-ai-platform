import { readFile } from 'node:fs/promises'
import { createServer } from 'vite'

const fixtureBase = new URL('../src/test/topology/fixtures/', import.meta.url)
const fixtures = {
  rotatedSingleRoot: await readFile(
    new URL('rotated-single-root.topology.v1.json', fixtureBase),
    'utf8',
  ),
  multiRootCrossLayer: await readFile(
    new URL('multi-root-cross-layer.topology.v1.json', fixtureBase),
    'utf8',
  ),
}

const server = await createServer({
  configFile: false,
  root: process.cwd(),
  appType: 'custom',
  logLevel: 'error',
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, hmr: false, ws: false },
})

try {
  const suite = await server.ssrLoadModule('/src/test/topology/sidecarToGraphSuite.ts')
  if (typeof suite.runSidecarToGraphSuite !== 'function') {
    throw new Error('sidecarToGraphSuite.ts must export runSidecarToGraphSuite()')
  }
  const result = await suite.runSidecarToGraphSuite(fixtures)
  console.log(
    `[topology-sidecar:test] ${result.passed} tests passed in ${result.durationMs.toFixed(1)}ms`,
  )
} finally {
  await server.close()
}
