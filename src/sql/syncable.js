import pg from '#util/pg'

/**
 * Shared query helpers for the offline-first "syncable" tables (accounts,
 * categories, transactions, recurring_templates, budgets) — every one of
 * them has id/owner_id/created_at/updated_at/deleted_at and follows the same
 * list/patch/soft-delete shape (see migrations/*_create-schema.js). Each
 * Model still writes its own `create` (upsert), since the column list is
 * different per table, but reuses these for the identical parts.
 */

/** Own records: active-only on first load, delta (incl. tombstones) with `since`. */
export async function listOwned(table, ownerId, since) {
  if (since) {
    const { rows } = await pg.query(
      `SELECT * FROM ${table} WHERE owner_id = $1 AND updated_at > $2 ORDER BY updated_at`,
      [ownerId, since],
    )
    return rows
  }
  const { rows } = await pg.query(
    `SELECT * FROM ${table} WHERE owner_id = $1 AND deleted_at IS NULL ORDER BY created_at`,
    [ownerId],
  )
  return rows
}

/**
 * Whole-family records (no owner filter) — backs every `?scope=all` list:
 * active-only on first load, delta (incl. tombstones) with `since`. Same
 * shape/contract as `listOwned`, just without the `owner_id` predicate, so a
 * client can delta-sync "everyone's" copy of a table the exact same way it
 * delta-syncs its own (see src/db/sync.ts's pullEntity on the frontend).
 */
export async function listAll(table, since) {
  if (since) {
    const { rows } = await pg.query(
      `SELECT * FROM ${table} WHERE updated_at > $1 ORDER BY updated_at`,
      [since],
    )
    return rows
  }
  const { rows } = await pg.query(`SELECT * FROM ${table} WHERE deleted_at IS NULL ORDER BY created_at`)
  return rows
}

/**
 * Builds `col = $N` fragments for a partial UPDATE from a { column: value }
 * map, skipping `undefined` entries (meaning "leave unchanged"). `startIndex`
 * is the first free `$N` placeholder (after id/ownerId, which the caller
 * binds itself).
 */
export function buildPatchSet(fields, startIndex) {
  const setClauses = []
  const values = []
  let i = startIndex
  for (const [column, value] of Object.entries(fields)) {
    if (value === undefined) continue
    // Always quoted: harmless for normal lowercase names, and required for
    // reserved words used as column names (e.g. accounts/categories."order").
    setClauses.push(`"${column}" = $${i}`)
    values.push(value)
    i += 1
  }
  return { setClauses, values }
}

export async function softDelete(table, id, ownerId) {
  const { rowCount } = await pg.query(
    `UPDATE ${table}
     SET deleted_at = current_timestamp, updated_at = current_timestamp
     WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
    [id, ownerId],
  )
  return rowCount > 0
}

/** Same as `softDelete`, without the `owner_id` check — for a shared (not per-owner) table like categories. */
export async function softDeleteAny(table, id) {
  const { rowCount } = await pg.query(
    `UPDATE ${table}
     SET deleted_at = current_timestamp, updated_at = current_timestamp
     WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  )
  return rowCount > 0
}
