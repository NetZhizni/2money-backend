import pg from '#util/pg'
import { FIRST_AVAILABLE_DATE } from '#util/currencyApi'
import { refreshLatest, storeDay } from '#services/rates/getRateSnapshots'

/**
 * Days of missing history filled in per run, newest first: a fresh server
 * gets its first year at once and the rest over the next runs, rather than
 * asking the free rates API for a thousand files in one go.
 */
const MAX_BACKFILL_PER_RUN = 365

/**
 * Keeps rate_snapshots complete, so the family's rate history doesn't depend
 * on the rates API still being there — and statistics never wait on a
 * download for a day nobody had asked about yet (see
 * services/internal/rates/getRateSnapshots.js, which otherwise fetches days
 * lazily, as clients ask). Stores the latest published day, then any day
 * since the API's history began that isn't stored yet — including days the
 * server was down for. A day the API itself doesn't have just stays missing
 * and is tried again next run.
 */
export async function fetchRates({ maxBackfill = MAX_BACKFILL_PER_RUN } = {}) {
  const latest = await refreshLatest()
  const { rows } = await pg.query(
    `SELECT day::date::text AS date
     FROM generate_series($1::date, (now() AT TIME ZONE 'UTC')::date - 1, interval '1 day') AS day
     WHERE NOT EXISTS (SELECT 1 FROM rate_snapshots WHERE rate_snapshots.date = day::date)
     ORDER BY day DESC
     LIMIT $2`,
    [FIRST_AVAILABLE_DATE, maxBackfill],
  )
  const stored = await Promise.all(rows.map((row) => storeDay(row.date)))
  return {
    latest: latest?.date ?? null,
    backfilled: stored.filter(Boolean).length,
    unavailable: stored.filter((rates) => !rates).length,
  }
}
