const schema = 'fin'

/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined

/**
 * How far back each entity's tombstones have been purged for good (see
 * jobs/purgeDeleted.js): the latest updated_at among the deleted rows it has
 * physically removed. A client whose delta cursor is older than that may have
 * missed one of those deletions, so its next pull gets the full list instead
 * of a delta (see sync/engine.js expiredCursors). No row = never purged.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.createTable({ schema, name: 'sync_purges' }, {
    entity: { type: 'text', primaryKey: true },
    purged_through: { type: 'timestamptz', notNull: true },
  })
}

export const down = (pgm) => {
  pgm.dropTable({ schema, name: 'sync_purges' })
}
