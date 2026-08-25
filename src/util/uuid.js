import { v7 } from 'uuid'

/**
 * UUIDv7: time-ordered (sortable by creation time, unlike v4), so primary
 * keys stay well-behaved in btree indexes. Generated app-side (not by
 * Postgres — 17.6 doesn't have a built-in uuidv7()) so an offline client can
 * assign an id to a new record before it ever reaches the server.
 */
export const uuidv7 = v7
