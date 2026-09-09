import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // 开发代理只读取服务端命名的变量，禁止把密钥放入 VITE_* 客户端命名空间。
  const llmBaseUrl = env.LLM_BASE_URL || 'https://api.minimax.chat/v1'
  const llmApiKey = env.LLM_API_KEY
  const appBase = env.APP_BASE || env.VITE_APP_BASE || (mode === 'production' ? '/space-ai-platform/' : '/')
  return {
    base: appBase,
    plugins: [vue()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5173,
      host: true,
      proxy: {
        // Demo 开发代理：浏览器 → /api/llm → MiniMax-M3
        '/api/llm': {
          target: llmBaseUrl,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/llm/, ''),
          secure: true,
          // 只由 dev server 注入上游凭据，浏览器请求不携带 key。
          headers: llmApiKey ? { Authorization: `Bearer ${llmApiKey}` } : undefined,
        },
      },
    },
  }
})
