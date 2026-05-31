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
    '/api/translator-openai-proxy': './api/translator-openai-proxy.js',
    '/api/me/access': './api/me/access.js',
    '/api/me/adult-consent': './api/me/adult-consent.js',
    '/api/admin/users': './api/admin/users.js',
    '/api/admin/users/sync-auth': './api/admin/users/sync-auth.js',
    '/api/admin/catalog': './api/admin/catalog.js',
    '/api/admin/features': './api/admin/features.js',
    '/api/admin/audit': './api/admin/audit.js',
    '/api/admin/usage': './api/admin/usage.js',
    '/api/admin/consent': './api/admin/consent.js',
  }
  if (exactRoutes[pathname]) return { modulePath: exactRoutes[pathname], params: {} }

  let match = pathname.match(/^\/api\/admin\/users\/([^/]+)\/access$/u)
  if (match) return { modulePath: './api/admin/users/[id]/access.js', params: { id: decodeURIComponent(match[1]) } }

  match = pathname.match(/^\/api\/admin\/users\/([^/]+)\/plan$/u)
  if (match) return { modulePath: './api/admin/users/[id]/plan.js', params: { id: decodeURIComponent(match[1]) } }

  match = pathname.match(/^\/api\/admin\/users\/([^/]+)\/feature-override$/u)
  if (match) return { modulePath: './api/admin/users/[id]/feature-override.js', params: { id: decodeURIComponent(match[1]) } }

  match = pathname.match(/^\/api\/admin\/users\/([^/]+)\/status$/u)
  if (match) return { modulePath: './api/admin/users/[id]/status.js', params: { id: decodeURIComponent(match[1]) } }

  match = pathname.match(/^\/api\/admin\/features\/([^/]+)\/plan$/u)
  if (match) return { modulePath: './api/admin/features/[key]/plan.js', params: { key: decodeURIComponent(match[1]) } }

  match = pathname.match(/^\/api\/admin\/features\/([^/]+)$/u)
  if (match) return { modulePath: './api/admin/features/[key].js', params: { key: decodeURIComponent(match[1]) } }

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
