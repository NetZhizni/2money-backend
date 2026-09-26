const schema = 'fin'

/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined

/**
 * Accounts get an optional credit limit (credit card, overdraft) — how far
 * below zero the balance may go, in the account's own currency. Only
 * meaningful on a regular account; the frontend never saves one anywhere
 * else. It never counts toward any total — the balance stays the account's
 * own money.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.addColumns({ schema, name: 'accounts' }, {
    credit_limit: { type: 'numeric(14,2)' },
  })
}

export const down = (pgm) => {
  pgm.dropColumns({ schema, name: 'accounts' }, ['credit_limit'])
}
