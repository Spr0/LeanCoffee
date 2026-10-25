/**
 * Export colours: the app's light-theme accent (src/index.css) on white paper, as hex without '#'.
 * Every text/fill pair here meets WCAG AA 4.5:1 (accent on white 7.18, white on accent 7.18,
 * accent on soft 5.99, black on band 19.08).
 */
export const EXPORT_COLORS = {
  accent: '24624A', // --teal (light)
  onAccent: 'FFFFFF', // --on-teal (light)
  soft: 'DCEFE4', // --teal-soft (light): key-facts box
  band: 'EEF6F1', // banded table rows
  rule: 'C9D6CF', // light table borders
  muted: '55625F', // --muted (light)
} as const
