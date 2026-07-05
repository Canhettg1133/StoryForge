import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'
import { pathToFileURL } from 'url'

function loadLocalServerEnv() {
  const envPath = path.resolve(__dirname, '.env.local')
  if (!fs.existsSync(envPath)) return
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/u)
  lines.forEach((line) => {
    const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*)\s*$/u)
    if (!match) return
    const [, key, value] = match
    if (!process.env[key]) process.env[key] = value
  })
}

function resolveApiRoute(pathname) {
  const exactRoutes = {
    '/api/openai-proxy': './api/openai-proxy.js',
    '/api/cloudflare-workers-ai': './api/cloudflare-workers-ai.js',
    '/api/translator-openai-proxy': './api/translator-openai-proxy.js',
    '/api/vip-page-content': './api/vip-page-content.js',
    '/api/site-announcement': './api/site-announcement.js',
    '/api/me/access': './api/me/access.js',
    '/api/me/adult-consent': './api/me/adult-consent.js',
  }
  if (exactRoutes[pathname]) return { modulePath: exactRoutes[pathname], params: {} }

  return null
}

function storyForgeApiDevMiddleware() {
  return {
    name: 'storyforge-api-dev-middleware',
    configureServer(server) {
      loadLocalServerEnv()
      server.middlewares.use('/api', async (req, res, next) => {
        try {
          const parsed = new URL(req.url || '/', 'http://localhost')
          const apiPathname = parsed.pathname.startsWith('/api')
            ? parsed.pathname
            : `/api${parsed.pathname}`
          const route = resolveApiRoute(apiPathname)
          if (!route) {
            next()
            return
          }

          req.query = {
            ...Object.fromEntries(parsed.searchParams.entries()),
            ...route.params,
          }
          const moduleUrl = pathToFileURL(path.resolve(__dirname, route.modulePath)).href
          const { default: handler } = await import(`${moduleUrl}?t=${Date.now()}`)
          await handler(req, res)
        } catch (error) {
          next(error)
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), storyForgeApiDevMiddleware()],
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
  },
})
