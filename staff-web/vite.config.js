import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/s/',
  server: {
    port: 8200,
    strictPort: false, // 开发时如果 8200 被 admin-web 占用则自动使用下一个可用端口
    proxy: {
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
    outDir: 'dist',
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
      },
    },
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          icons: ['lucide-react'],
        },
      },
    },
  },
})
