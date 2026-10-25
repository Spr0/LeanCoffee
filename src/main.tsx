import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyTheme, readTheme } from './lib/theme'

applyTheme(readTheme())

// After a redeploy, an open tab can ask for chunks the old build named. Reload once to pick up
// the new build (Vite's documented handler), at most once a minute so a real outage cannot loop.
const RELOADED_AT = 'lean-coffee-reloaded-at'
window.addEventListener('vite:preloadError', (event) => {
  try {
    if (Date.now() - Number(sessionStorage.getItem(RELOADED_AT) ?? 0) < 60_000) return
    sessionStorage.setItem(RELOADED_AT, String(Date.now()))
  } catch {
    return // Without storage we cannot tell a loop apart, so let the error surface.
  }
  event.preventDefault()
  window.location.reload()
})

const root = document.getElementById('root')
if (!root) throw new Error('Root element missing')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
