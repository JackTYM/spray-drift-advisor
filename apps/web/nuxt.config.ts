// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2026-11-01',
  devtools: { enabled: true },
  ssr: false,
  typescript: { tsConfig: { compilerOptions: { noUncheckedIndexedAccess: false } } },
  css: ['~/assets/main.css'],
  build: { transpile: ['@drift/engine'] },
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
      title: 'Spray Drift Advisor',
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }, { name: 'theme-color', content: '#1c2530' }],
      link: [{ rel: 'manifest', href: '/manifest.webmanifest' }],
    },
  },
})
