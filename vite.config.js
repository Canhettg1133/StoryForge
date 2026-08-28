import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cloudflare } from '@cloudflare/vite-plugin'
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
    '/api/supreme-chat': './api/supreme-chat.js',
    '/api/supreme-chat-capabilities': './api/supreme-chat-capabilities.js',
    '/api/vip-page-content': './api/vip-page-content.js',
    '/api/site-announcement': './api/site-announcement.js',
    '/api/setup-guides': './api/setup-guides.js',
    '/api/me/access': './api/me/access.js',
    '/api/me/adult-consent': './api/me/adult-consent.js',
    '/api/translator-prompt-settings': './api/translator-prompt-settings.js',
    '/api/cloud': './api/cloud.js',
    '/api/tts/edge': './api/tts/edge.js',
    '/api/tts/google-free': './api/tts/google-free.js',
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
          req.__storyForgeRuntimePlatform = 'local'
          let routeModule
          if (apiPathname.startsWith('/api/tts/')) {
            const moduleId = `/${route.modulePath.replace(/^\.\//u, '')}`
            routeModule = await server.ssrLoadModule(moduleId)
          } else {
            const moduleUrl = pathToFileURL(path.resolve(__dirname, route.modulePath)).href
            routeModule = await import(`${moduleUrl}?t=${Date.now()}`)
          }
          const { default: handler } = routeModule
          await handler(req, res)
        } catch (error) {
          next(error)
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    ...(process.env.STORYFORGE_CLOUDFLARE === 'true'
      ? [cloudflare()]
      : [storyForgeApiDevMiddleware()]),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      '@tanstack/react-virtual',
      '@tiptap/react',
    ],
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 2200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replaceAll('\\', '/')
          if (!normalizedId.includes('/node_modules/')) return null
          if (
            /\/node_modules\/(?:react|react-dom|react-router|react-router-dom)\//u
              .test(normalizedId)
          ) return 'vendor-react'
          if (
            normalizedId.includes('/node_modules/@supabase/')
            || normalizedId.includes('/node_modules/iceberg-js/')
          ) return 'vendor-cloud'
          if (
            normalizedId.includes('/node_modules/@tiptap/')
            || normalizedId.includes('/node_modules/prosemirror-')
          ) return 'vendor-editor'
          if (normalizedId.includes('/node_modules/dexie/')) return 'vendor-db'
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
