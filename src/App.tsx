import { usePath } from './lib/router'
import BoardRoute from './pages/BoardRoute'
import Home from './pages/Home'

function boardCode(path: string): string | null {
  const match = /^\/b\/([^/]+)\/?$/.exec(path)
  if (!match?.[1]) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return null // Malformed escape in the URL: show the home page.
  }
}

export default function App() {
  const code = boardCode(usePath())
  return code ? <BoardRoute key={code} code={code} /> : <Home />
}
