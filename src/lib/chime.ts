const KEY = 'lean-coffee-muted'

export function isMuted(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function setMuted(muted: boolean): void {
  try {
    localStorage.setItem(KEY, muted ? '1' : '0')
  } catch {
    // Without storage the setting lasts for this page only.
  }
}

/** A short two-note tone. Browsers allow audio once the person has interacted with the page. */
export function chime(): void {
  if (isMuted()) return
  try {
    const ctx = new AudioContext()
    ;[660, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18)
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + i * 0.18 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.35)
      osc.connect(gain).connect(ctx.destination)
      osc.start(ctx.currentTime + i * 0.18)
      osc.stop(ctx.currentTime + i * 0.18 + 0.4)
    })
    window.setTimeout(() => void ctx.close(), 1000)
  } catch {
    // No audio available.
  }
}
