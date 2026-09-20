/** epoch-ms (as used throughout the frontend's model types) -> JS Date for pg params. */
export function msToDate(ms) {
  return ms == null ? null : new Date(Number(ms))
}

/** `?since=<epoch-ms>` query param -> JS Date, or undefined if absent/invalid (= "full load"). */
export function parseSince(value) {
  if (value == null || value === '') return undefined
  const ms = Number(value)
  return Number.isFinite(ms) ? new Date(ms) : undefined
}

/**
 * epoch-ms -> 'YYYY-MM' (UTC-based). Only needed as a fallback for a
 * whole-family backup file exported before Budget.month existed (see
 * services/internal/admin/restoreFamilyBackup.js) — mirrors the one-time
 * `to_char(created_at, 'YYYY-MM')` backfill the add-budget-month migration
 * ran on rows already in the database.
 */
export function monthKey(ms) {
  const d = new Date(Number(ms))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
