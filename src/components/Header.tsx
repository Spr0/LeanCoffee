import { useEffect, useState, type ReactNode } from 'react'
import { applyTheme, readTheme, type Theme } from '../lib/theme'

function CupIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 9h10v5a4 4 0 0 1-4 4h-2a4 4 0 0 1-4-4V9zM16 10h1.5a2 2 0 0 1 0 4H16" />
    </svg>
  )
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readTheme)
  useEffect(() => applyTheme(theme), [theme])
  const next = theme === 'dark' ? 'light' : 'dark'
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} mode`}
      className="flex size-11 items-center justify-center rounded-xl border-2 border-line text-ink"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {theme === 'dark' ? (
          <path d="M12 3v2M12 19v2M5 12H3M21 12h-2M6.3 6.3 4.9 4.9M19.1 19.1l-1.4-1.4M17.7 6.3l1.4-1.4M4.9 19.1l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" />
        ) : (
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        )}
      </svg>
    </button>
  )
}

/** Common 64 px header for every screen. */
export function Header({ context, right }: { context?: string; right?: ReactNode }) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-line-soft bg-ground px-4 sm:px-10">
      <div className="flex items-center gap-3">
        <a href="/" className="flex items-center gap-3" aria-label="Lean Coffee home">
          <span className="flex size-[34px] items-center justify-center rounded-[9px] bg-teal text-on-teal">
            <CupIcon />
          </span>
          <span className="text-[19px] font-extrabold">Lean Coffee</span>
        </a>
        {context && (
          <span className="border-l border-line pl-3 text-[15px] text-muted">{context}</span>
        )}
      </div>
      <div className="flex items-center gap-3">
        {right}
        <ThemeToggle />
      </div>
    </header>
  )
}
