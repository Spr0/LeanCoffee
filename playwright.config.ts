import { defineConfig, devices } from '@playwright/test'
import { loadEnv } from 'vite'

// Same variables the app is built with (.env.local locally, written by CI from the local stack).
Object.assign(process.env, loadEnv('production', process.cwd(), 'VITE_'))

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173'

// Against the hosted project every step is a round trip to a database shared with other runs, and
// an anonymous sign-up or a Realtime fan-out can stall for several seconds (measured up to 4.9 s
// for a change to reach another browser). A local stack keeps Playwright's 5 s.
const hosted = !/^https?:\/\/(127\.0\.0\.1|localhost)\b/.test(process.env.VITE_SUPABASE_URL ?? '')

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  expect: { timeout: hosted ? 15_000 : 5_000 },
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    // The request fixture runs in Node, which ignores HTTPS_PROXY; remote runs from a proxied
    // container need it set explicitly.
    ...(process.env.E2E_BASE_URL && process.env.HTTPS_PROXY
      ? { proxy: { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } }
      : {}),
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
})
