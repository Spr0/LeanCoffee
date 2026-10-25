export type Theme = 'light' | 'dark'

const KEY = 'lean-coffee-theme'

export function readTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // Storage unavailable (private mode): the choice lasts for this page only.
  }
}
