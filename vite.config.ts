import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import { securityHeadersPlugin } from './security-headers.ts'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    plugins: [react(), tailwindcss(), securityHeadersPlugin(env.VITE_SUPABASE_URL)],
    build: {
      sourcemap: false,
      // Never inline assets as data: URIs; the CSP allows fonts from 'self' only.
      assetsInlineLimit: 0,
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}', 'netlify/**/*.test.ts'],
      // Unit tests never reach Supabase; placeholders let modules that create the client load
      // without a local .env.local, as in CI.
      env: {
        VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_unit_tests_only',
      },
    },
  }
})
