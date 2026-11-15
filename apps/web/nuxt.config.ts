// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2026-11-01',
  devtools: { enabled: true },
  ssr: false,
  typescript: { tsConfig: { compilerOptions: { noUncheckedIndexedAccess: false } } },
  css: ['~/assets/main.css'],
  build: { transpile: ['@drift/engine'] },
  // maplibre-gl loads its own worker module; pre-bundling it breaks that URL in dev.
  vite: { optimizeDeps: { exclude: ['maplibre-gl'] } },
  nitro: {
    preset: 'cloudflare_module',
    cloudflare: { deployConfig: true, nodeCompat: true, wrangler: { name: 'drift-web' } },
  },
  runtimeConfig: {
    public: { // Baked in at build time: this is a client-only app, so there is no server to read env at runtime.
      apiBase: process.env.NUXT_PUBLIC_API_BASE || 'http://localhost:8787',
      vapidPublicKey: process.env.NUXT_PUBLIC_VAPID_PUBLIC_KEY || '', },
  },
  app: {
    head: {
      title: 'Stillair',
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }, { name: 'theme-color', content: '#0d1826' }],
      link: [
        { rel: 'manifest', href: '/manifest.webmanifest' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Condensed:wght@600;700&display=swap' },
      ],
    },
  },
})
