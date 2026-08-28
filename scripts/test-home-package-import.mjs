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
  const suite = await server.ssrLoadModule('/src/test/package/homePackageImportSuite.ts')
  if (typeof suite.runHomePackageImportSuite !== 'function') {
    throw new Error('homePackageImportSuite.ts must export runHomePackageImportSuite()')
  }
  const result = await suite.runHomePackageImportSuite()
  console.log(
    `[home-package-import:test] ${result.passed} tests passed in ${result.durationMs.toFixed(1)}ms`,
  )
} finally {
  await server.close()
}
