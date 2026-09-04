const schema = 'fin'

/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined

/**
 * The app no longer computes/stores a per-transaction exchange-rate snapshot
 * (see frontend's types/models.ts — Transaction.exchangeRate/baseAmount were
 * removed): any base-currency figure is now computed on the fly from
 * amount/to_amount + the CURRENT rate, wherever it's needed. Both columns
 * stay in the table (by decision — not worth a destructive DROP COLUMN for
 * two columns application code simply stops writing/reading), but
 * `base_amount` was NOT NULL with no default, so it must become nullable —
 * otherwise every INSERT that no longer supplies it would fail.
 * `exchange_rate` already has a DEFAULT (1), so omitting it from an INSERT is
 * already safe and needs no change here.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.alterColumn({ schema, name: 'transactions' }, 'base_amount', { notNull: false })
}

export const down = (pgm) => {
  pgm.alterColumn({ schema, name: 'transactions' }, 'base_amount', { notNull: true })
}
