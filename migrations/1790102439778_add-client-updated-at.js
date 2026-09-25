const schema = 'fin'

const TABLES = ['accounts', 'categories', 'tags', 'transactions', 'recurring_templates', 'budgets', 'receipts']

/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined

/**
 * `client_updated_at` — when a record's last accepted change was made on the
 * device that sent it, as opposed to `updated_at`, which is when that change
 * reached the server (and has to stay that way: it's what every delta pull's
 * cursor is compared against).
 *
 * It's what lets sync/engine.js settle two devices writing the same record as
 * "the later edit wins" rather than "whichever request happened to arrive
 * last" — without it, a phone replaying a week-old offline edit would silently
 * overwrite everything written since.
 *
 * Existing rows have nothing better to go on than their last server write.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  for (const table of TABLES) {
    pgm.addColumn({ schema, name: table }, {
      client_updated_at: { type: 'timestamptz' },
    })
    pgm.sql(`UPDATE ${schema}.${table} SET client_updated_at = updated_at WHERE client_updated_at IS NULL`)
    pgm.alterColumn({ schema, name: table }, 'client_updated_at', { notNull: true, default: pgm.func('current_timestamp') })
  }
}

export const down = (pgm) => {
  for (const table of TABLES) pgm.dropColumn({ schema, name: table }, 'client_updated_at')
}
