import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    chunkSizeWarningLimit: 2200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return null
          if (id.includes('tiptap') || id.includes('prosemirror')) return 'vendor-editor'
          if (id.includes('dexie')) return 'vendor-db'
          return null
        },
      },
    },
  },
  server: {
    port: 3000,
    open: true,
    proxy: {
      // Proxy calls to 星星 Gemini Proxy — bypass CORS
      '/api/proxy': {
        target: 'https://ag.beijixingxing.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/proxy/, ''),
        secure: true,
      },
    },
  },
})
