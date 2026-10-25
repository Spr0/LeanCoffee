import { usePath } from './lib/router'
import BoardRoute from './pages/BoardRoute'
import Home from './pages/Home'

export default function App() {
  const path = usePath()
  const match = /^\/b\/([^/]+)\/?$/.exec(path)
  if (match?.[1]) return <BoardRoute key={match[1]} code={decodeURIComponent(match[1])} />
  return <Home />
}
