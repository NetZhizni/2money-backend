import pg from '#util/pg'
import { isUuid } from '#util/uuid'

/**
 * Batch lookups the hooks share — each one query for a whole batch, never
 * one per row (see engine.js's upsertMany). Table and column names are only
 * ever passed in from hook code, never from a request.
 */

/** The owner's base currency — the fallback for a record sent without one of its own. */
export async function baseCurrencyOf(ownerId) {
  const { rows } = await pg.query(`SELECT base_currency FROM app_settings WHERE user_id = $1`, [ownerId])
  return rows[0]?.base_currency ?? 'UAH'
}

/** id -> current currency, for the rows among `ids` that exist (and, with `ownerId`, belong to them). */
export async function currentCurrencies(table, ids, ownerId) {
  const valid = ids.filter(isUuid)
  if (!valid.length) return new Map()
  const { rows } = ownerId
    ? await pg.query(`SELECT id, currency FROM ${table} WHERE id = ANY($1::uuid[]) AND owner_id = $2 AND deleted_at IS NULL`, [valid, ownerId])
    : await pg.query(`SELECT id, currency FROM ${table} WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`, [valid])
  return new Map(rows.map((row) => [row.id, row.currency]))
}

/** The ids among `ids` that at least one active transaction references through any of `columns`. */
export async function idsWithOperations(ids, columns) {
  const valid = ids.filter(isUuid)
  if (!valid.length) return new Set()
  const match = columns.map((column) => `t.${column} = ref.id`).join(' OR ')
  const { rows } = await pg.query(
    `SELECT ref.id FROM unnest($1::uuid[]) AS ref(id)
     WHERE EXISTS (SELECT 1 FROM transactions t WHERE (${match}) AND t.deleted_at IS NULL)`,
    [valid],
  )
  return new Set(rows.map((row) => row.id))
}

/**
 * An account's or category's currency is baked into every transaction
 * already booked against it (amounts are stored in that currency, not
 * converted — see the frontend's Transaction.amount), so changing it
 * retroactively would silently reinterpret all of that history.
 */
export function currencyLockedError(message) {
  const error = new Error(message)
  error.status = 400
  error.reason = 'currencyLocked'
  return error
}

/**
 * Refused by a hook's beforeRemove: every operation booked against an
 * account or category counts toward some account's balance, so deleting the
 * record either takes those operations along (and silently rewrites the
 * balances on the other side of every transfer, another member's included)
 * or orphans them. Only an unused one can go — the client offers archiving
 * or merging into another record instead.
 */
export function inUseError(message) {
  const error = new Error(message)
  error.status = 409
  error.reason = 'inUse'
  return error
}

/** beforeRemove for an entity whose records operations point at through `columns`: every id still in use is refused. */
export function refuseInUse(columns, message) {
  return async ({ ids }) => {
    const used = await idsWithOperations(ids, columns)
    return new Map([...used].map((id) => [id, inUseError(message)]))
  }
}
