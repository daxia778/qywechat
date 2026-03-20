import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 8200,
    strictPort: true,  // 端口被占用时报错而非自动切换，确保始终在 8200
    proxy: {
      // ⚠️ WS 规则必须在 /api 前面，否则 /api/v1/ws 会被当作普通 HTTP 代理
      '/api/v1/ws': {
        target: 'ws://localhost:8201',
        ws: true,
      },
      '/api': {
        target: 'http://localhost:8201',
      },
      '/uploads': {
        target: 'http://localhost:8201',
      },
    },
  },
  build: {
    target: 'es2020',
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,   // Remove console.log in production
        drop_debugger: true,
      },
    },
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          charts: ['echarts'],
          icons: ['lucide-react'],
        },
      },
    },
  },
})
