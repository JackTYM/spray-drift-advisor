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
    public: { apiBase: 'http://localhost:8787', vapidPublicKey: '' },
  },
  app: {
    head: {
      title: 'Spray Drift Advisor',
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }, { name: 'theme-color', content: '#1c2530' }],
      link: [{ rel: 'manifest', href: '/manifest.webmanifest' }],
    },
  },
})
