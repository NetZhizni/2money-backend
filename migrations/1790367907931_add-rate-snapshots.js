const schema = 'fin'

/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined

/**
 * One row per day of exchange rates, exactly as fawazahmed0/currency-api
 * published them — units of each currency per 1 USD, lowercase codes (see
 * util/currencyApi.js). Shared by the whole family and never edited: a
 * past day's rates don't change, so the first copy stored is final (see
 * services/internal/rates/getRateSnapshots.js). Keeps the history the
 * frontend's statistics convert at even if that free API ever goes away.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.createTable({ schema, name: 'rate_snapshots' }, {
    date: { type: 'date', primaryKey: true },
    rates: { type: 'jsonb', notNull: true },
    fetched_at: { type: 'timestamptz', notNull: true, default: pgm.func('CURRENT_TIMESTAMP') },
  })
}

export const down = (pgm) => {
  pgm.dropTable({ schema, name: 'rate_snapshots' })
}
