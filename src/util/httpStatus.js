// not_null_violation, check_violation — the two integrity errors that mean
// "this row's own data is malformed" rather than "it clashes with another row".
const PG_BAD_ROW = new Set(['23502', '23514'])
const PG_FOREIGN_KEY = '23503'

function pgCode(error) {
  return typeof error?.code === 'string' ? error.code : ''
}

/**
 * The HTTP status an error that reached a route answers with.
 *
 * Intentional business errors carry their own `.status` (see sync/engine.js,
 * middleware/auth.js). Of the rest, Postgres errors in SQLSTATE class 22
 * (data exception: an invalid uuid/number/date, a value too long) and class
 * 23 (integrity violation: NOT NULL, CHECK, a foreign key, a unique key) are
 * deterministic — replaying the same request against the same data can only
 * fail the same way — so they're the client's problem, not a server bug.
 *
 * That matters beyond logging: the frontend's outbox (db/sync/outbox.ts)
 * drops a write the server answered with a 4xx, but keeps a 5xx queued and
 * retries it — so a malformed row answered with a 500 would be retried until
 * the outbox gives up on it, instead of being reported straight away.
 *
 * Everything else (a bug, a lost connection, a deadlock) stays a 500.
 */
export function httpStatusFor(error) {
  if (error?.status) return error.status
  const code = pgCode(error)
  if (code.startsWith('22') || PG_BAD_ROW.has(code)) return 400
  if (code.startsWith('23')) return 409
  return 500
}

/**
 * A machine-readable "why" to go with the status, for the per-item results
 * of the bulk sync endpoints — it's what the frontend turns into a message
 * the user can act on when one of their changes didn't make it (see its
 * db/sync/outbox.ts), where the status alone can't tell "someone edited this
 * later" from "this refers to an account the server doesn't have".
 *
 * Business errors name their own (see sync/engine.js); the rest are
 * classified the same way httpStatusFor classifies them.
 */
export function reasonFor(error) {
  if (error?.reason) return error.reason
  const code = pgCode(error)
  if (code === PG_FOREIGN_KEY) return 'reference'
  if (code.startsWith('22') || PG_BAD_ROW.has(code)) return 'invalid'
  if (code.startsWith('23')) return 'conflict'
  const status = httpStatusFor(error)
  if (status === 404) return 'notFound'
  if (status === 409) return 'conflict'
  return status >= 500 ? 'server' : 'invalid'
}
