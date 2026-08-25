// Same 8-color categorical palette as the frontend (FinTrack's src/utils/color.ts)
// so a user's badge color, assigned once here at creation time, matches what
// the client would have picked.
const CATEGORICAL = [
  '#2a78d6', // blue
  '#eb6834', // orange
  '#1baf7a', // aqua
  '#eda100', // yellow
  '#e87ba4', // magenta
  '#008300', // green
  '#4a3aa7', // violet
  '#e34948', // red
]

/** Deterministic badge color per email — stable across re-creation attempts, no randomness. */
export function colorForEmail(email) {
  let hash = 0
  for (const ch of email) hash = (hash * 31 + ch.charCodeAt(0)) % CATEGORICAL.length
  return CATEGORICAL[hash]
}
