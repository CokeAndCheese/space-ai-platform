import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Demo 兼容旧 VITE_LLM_* 本地配置；这些变量只在 Vite server 配置中读取，
  // 客户端代码不再引用它们，因此不会进入浏览器 bundle。
  const llmBaseUrl = env.LLM_BASE_URL || env.VITE_LLM_BASE_URL || 'https://api.minimax.chat/v1'
  const llmApiKey = env.LLM_API_KEY || env.VITE_LLM_API_KEY
  return {
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
