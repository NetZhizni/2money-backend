import pg from '#util/pg'

/** How long a deleted operation's tombstone is kept before it's removed for good. */
export const TOMBSTONE_RETENTION_DAYS = 90

/**
 * How long the new watermark is on record before the rows it covers are
 * removed — far longer than one pull takes between reading it (sync/engine.js
 * readClock) and listing rows, so no pull can see the old watermark and yet
 * find the rows already gone.
 */
const ANNOUNCE_DELAY_MS = 60_000

/**
 * Removes for good the operations deleted more than TOMBSTONE_RETENTION_DAYS
 * ago. A tombstone only exists so that devices which were offline learn
 * about the delete (see sync/engine.js) — one that old has done its job for
 * every device that has synced since, and a device that hasn't is served the
 * full list instead of a delta (see engine.js cursorExpired), which settles
 * it without the tombstone.
 *
 * Only operations: nothing references them, so removing one changes no other
 * row. An account's tombstone is still referenced by its operations' foreign
 * keys (RESTRICT), and removing a category's would null out references in
 * live rows (SET NULL) without their updated_at moving — a change no device
 * would ever hear about.
 *
 * Watermark first, rows after: sync_purges records how far the purge
 * reaches (the latest updated_at among the rows about to go — as stored,
 * down to the microsecond) before anything disappears, and the rows follow
 * ANNOUNCE_DELAY_MS later. The other way round, a pull that read the old
 * watermark could list rows after they were gone and advance its cursor past
 * deletions it never saw.
 */
export async function purgeDeleted({ announceDelayMs = ANNOUNCE_DELAY_MS } = {}) {
  const {
    rows: [{ cutoff }],
  } = await pg.query(`SELECT (now() - make_interval(days => $1))::text AS cutoff`, [TOMBSTONE_RETENTION_DAYS])

  const { rowCount: announced } = await pg.query(
    `INSERT INTO sync_purges (entity, purged_through)
     SELECT 'transactions', max(updated_at) FROM transactions WHERE deleted_at < $1::timestamptz
     HAVING max(updated_at) IS NOT NULL
     ON CONFLICT (entity) DO UPDATE SET purged_through = GREATEST(sync_purges.purged_through, EXCLUDED.purged_through)`,
    [cutoff],
  )
  if (!announced) return { transactions: 0 }

  await new Promise((resolve) => setTimeout(resolve, announceDelayMs))
  const { rowCount } = await pg.query(`DELETE FROM transactions WHERE deleted_at < $1::timestamptz`, [cutoff])
  return { transactions: rowCount }
}
