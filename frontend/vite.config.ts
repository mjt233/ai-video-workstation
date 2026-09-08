import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5233,
    proxy: {
      '/api': 'http://localhost:3001',
      // LLM 会话 WebSocket（服务器 /llm-ws；生产同源无需代理）
      '/llm-ws': { target: 'ws://localhost:3001', ws: true }
    }
  }
})
