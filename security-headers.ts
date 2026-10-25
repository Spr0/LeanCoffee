import type { Plugin } from 'vite'

/**
 * Response headers from build prompt 4.8, generated from the Supabase URL the app is built with.
 * Written to dist/_headers for Netlify and sent by `vite preview`, so tests run under the same
 * Content Security Policy as production.
 */
export function securityHeaders(supabaseUrl: string): Record<string, string> {
  const origin = new URL(supabaseUrl).origin
  const ws = origin.replace(/^http/, 'ws')
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    // React sets a few dynamic widths and colors through style attributes.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ${origin} ${ws}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ')
  return {
    'Content-Security-Policy': csp,
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    // Board links carry the room code; never send them to another site.
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
  }
}

/** Invite pages stay out of search engines; robots.txt allows /b/ so crawlers can see this (D53). */
export const NOINDEX_PREFIX = '/b/'

/** Built files under /assets/ carry a content hash in their names, so they never change. */
export const ASSETS_PREFIX = '/assets/'
export const ASSET_CACHE = 'public, max-age=31536000, immutable'

export function securityHeadersPlugin(supabaseUrl: string | undefined): Plugin {
  const headers = supabaseUrl ? securityHeaders(supabaseUrl) : null
  return {
    name: 'lean-coffee-security-headers',
    generateBundle() {
      // A production build without the URL would ship without a CSP; refuse instead.
      if (!headers)
        this.error('VITE_SUPABASE_URL must be set to build (it defines the security headers)')
      const lines = [
        '/*',
        ...Object.entries(headers).map(([k, v]) => `  ${k}: ${v}`),
        '',
        `${NOINDEX_PREFIX}*`,
        '  X-Robots-Tag: noindex',
        '',
        `${ASSETS_PREFIX}*`,
        `  Cache-Control: ${ASSET_CACHE}`,
        '',
      ]
      this.emitFile({ type: 'asset', fileName: '_headers', source: lines.join('\n') })
    },
    configurePreviewServer(server) {
      if (!headers) return
      server.middlewares.use((req, res, next) => {
        for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
        if (req.url?.startsWith(NOINDEX_PREFIX)) res.setHeader('X-Robots-Tag', 'noindex')
        // Set before the static server runs, which keeps a header that is already present.
        if (req.url?.startsWith(ASSETS_PREFIX)) res.setHeader('Cache-Control', ASSET_CACHE)
        next()
      })
    },
  }
}
