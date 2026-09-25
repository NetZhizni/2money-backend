import { v7 } from 'uuid'

/**
 * UUIDv7: time-ordered (sortable by creation time, unlike v4), so primary
 * keys stay well-behaved in btree indexes. Generated app-side (not by
 * Postgres — 17.6 doesn't have a built-in uuidv7()) so an offline client can
 * assign an id to a new record before it ever reaches the server.
 */
export const uuidv7 = v7

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Whether `value` is a well-formed UUID string. Checked before an id from a
 * request reaches a `$1::uuid[]` parameter: one malformed entry would fail
 * the cast for the whole statement, taking every valid id in the same batch
 * down with it.
 */
export const isUuid = (value) => typeof value === 'string' && UUID_RE.test(value)
