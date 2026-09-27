import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'

const API = process.env.VITE_API_TARGET || 'http://localhost:8787'

export default defineConfig(({ mode }) => ({
  // The Android build is already an installed app: a service worker would only
  // add a second, invisible copy of the shell that can go stale between
  // reinstalls, so the PWA plugin is left out of that build entirely.
  base: mode === 'capacitor' ? './' : '/',
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  plugins: [
    react(),
    tailwind(),
    mode === 'capacitor'
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
    outDir: mode === 'capacitor' ? 'dist-native' : 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
}))
