/** epoch-ms (as used throughout the ported FinTrack model types) -> JS Date for pg params. */
export function msToDate(ms) {
  return ms == null ? null : new Date(Number(ms))
}

/** `?since=<epoch-ms>` query param -> JS Date, or undefined if absent/invalid (= "full load"). */
export function parseSince(value) {
  if (value == null || value === '') return undefined
  const ms = Number(value)
  return Number.isFinite(ms) ? new Date(ms) : undefined
}
