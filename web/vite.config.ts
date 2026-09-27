import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'

const API = process.env.VITE_API_TARGET || 'http://localhost:8787'

/** The GitHub Pages site lives under /<repo>/, not at the domain root. */
const PAGES_BASE = process.env.PAGES_BASE || '/Bilinext/'

export default defineConfig(({ mode }) => ({
  // Neither packaged build gets a service worker: the APK is already an
  // installed app, and on Pages a cached shell would keep serving an old copy
  // after a deploy. Only the server's own build is a PWA.
  base: mode === 'capacitor' ? './' : mode === 'pages' ? PAGES_BASE : '/',
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  plugins: [
    react(),
    tailwind(),
    mode === 'capacitor' || mode === 'pages'
      ? null
      : VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'BiliNext',
        short_name: 'BiliNext',
        description: '第三方 Bilibili 客戶端',
        theme_color: '#0f1117',
        background_color: '#0f1117',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Media and API responses are user-specific and signed with short-lived
        // tokens; caching them would serve stale 403s, so only the shell is
        // precached.
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /\/api\/proxy\/image/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'bili-images',
              expiration: { maxEntries: 500, maxAgeSeconds: 7 * 24 * 3600 },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': { target: API, changeOrigin: true },
    },
  },
  // The two builds must not share an output directory. The server serves
  // web/dist, and vite empties the directory it writes to, so a native build
  // landing there would both blank the folder mid-request and leave the
  // browser serving the APK's bundle (hash routes, no API base at all).
  build: {
    outDir: mode === 'capacitor' ? 'dist-native' : mode === 'pages' ? 'dist-pages' : 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
}))
