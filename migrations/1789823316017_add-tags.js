const schema = 'fin'

/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined

// Same three sync columns every other syncable table gets (see
// migrations/1787599464099_create-schema.js's `syncColumns`) — node-pg-migrate
// doesn't share helpers across migration files, so this is a local copy of
// the same shape rather than an import.
const syncColumns = (pgm) => ({
  created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  deleted_at: { type: 'timestamptz' },
})

/**
 * Tags are a shared family resource, same as categories (see
 * migrations/1787946970749_merge-shared-categories.js) — any active member
 * sees and can create/edit/delete the same list, so `owner_id` here is
 * create-time provenance only, never an access filter (see src/sql/TagModel.js).
 *
 * `transactions.tag_ids` mirrors `transactions.participant_ids` (a plain
 * uuid[], no join table) — an operation can carry any number of tags, and the
 * GIN index lets "operations with this tag" be queried directly if that's
 * ever needed server-side, the same way participant_ids already is.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.createTable({ schema, name: 'tags' }, {
    id: { type: 'uuid', primaryKey: true },
    owner_id: { type: 'uuid', notNull: true, references: `${schema}.users(id)`, onDelete: 'cascade' },
    name: { type: 'text', notNull: true },
    color: { type: 'text', notNull: true },
    ...syncColumns(pgm),
  })
  pgm.createIndex({ schema, name: 'tags' }, 'updated_at')

  pgm.addColumn({ schema, name: 'transactions' }, {
    tag_ids: { type: 'uuid[]', notNull: true, default: pgm.func("'{}'::uuid[]") },
  })
  pgm.createIndex({ schema, name: 'transactions' }, 'tag_ids', { method: 'gin' })
}

export const down = (pgm) => {
  pgm.dropColumn({ schema, name: 'transactions' }, 'tag_ids')
  pgm.dropTable({ schema, name: 'tags' })
}
