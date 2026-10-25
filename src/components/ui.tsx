import { useId, type ButtonHTMLAttributes, type ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerOutline'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-teal text-on-teal hover:opacity-90',
  secondary: 'border-2 border-teal text-teal bg-panel hover:bg-teal-soft',
  ghost: 'border-2 border-line text-ink bg-panel hover:bg-surface',
  danger: 'bg-danger text-ground hover:opacity-90',
  dangerOutline: 'border-2 border-danger text-danger bg-panel hover:bg-surface',
}

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 text-[15px] font-bold disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-line-soft bg-surface p-7 ${className}`}>
      {children}
    </div>
  )
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-[13px] font-bold tracking-[0.12em] text-muted uppercase">{children}</p>
}

const PASTELS = ['#FFD9E0', '#CFE6FF', '#D5F2D0', '#FFF1A8', '#E4DBFF', '#FFD9B8']

export function Avatar({ name }: { name: string }) {
  const hash = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] font-extrabold text-[#1E2A28]"
      style={{ background: PASTELS[hash % PASTELS.length] }}
    >
      {[...name][0]?.toUpperCase()}
    </span>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint: string
  disabled?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line-soft py-3">
      <div>
        <p className="text-[15px] font-bold">{label}</p>
        <p className="text-[13px] text-muted">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-8 w-13 shrink-0 rounded-full border-2 disabled:opacity-60 ${checked ? 'border-teal bg-teal' : 'border-line-strong bg-line'}`}
      >
        <span
          className={`absolute top-0.5 size-6 rounded-full bg-white shadow transition-[left] ${checked ? 'left-[22px]' : 'left-0.5'}`}
        />
      </button>
    </div>
  )
}

export function Stepper({
  label,
  value,
  display,
  onChange,
  min,
  max,
  step,
  disabled,
}: {
  label: string
  value: number
  display: string
  onChange: (v: number) => void
  min: number
  max: number
  step: number
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className="rounded-xl border border-line-soft bg-panel p-3.5">
      <p className="mb-2 text-[13px] font-bold" id={id}>
        {label}
      </p>
      <div className="flex items-center justify-between" role="group" aria-labelledby={id}>
        <button
          type="button"
          aria-label={`Decrease ${label}`}
          disabled={disabled || value - step < min}
          onClick={() => onChange(value - step)}
          className="size-11 rounded-lg border-2 border-line text-xl font-bold disabled:opacity-40"
        >
          −
        </button>
        <span className="text-[22px] font-bold tabular-nums" aria-live="polite">
          {display}
        </span>
        <button
          type="button"
          aria-label={`Increase ${label}`}
          disabled={disabled || value + step > max}
          onClick={() => onChange(value + step)}
          className="size-11 rounded-lg border-2 border-line text-xl font-bold disabled:opacity-40"
        >
          +
        </button>
      </div>
    </div>
  )
}

export function ErrorText({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="mt-2 text-[14px] font-bold text-danger">
      {message}
    </p>
  )
}
