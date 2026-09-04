const schema = 'fin'

/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined

/**
 * Optional fixed currency for a category (see frontend's types/models.ts
 * Category.currency): unset means "no fixed currency", the category just
 * follows whichever account an operation uses, same as before this column
 * existed. When set and it differs from the account involved,
 * TransactionFormModal.vue shows a two-value calculator and stores the
 * category-currency amount in transactions.to_amount (already a generic,
 * nullable column — no schema change needed there).
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.addColumn({ schema, name: 'categories' }, {
    currency: { type: 'text' },
  })
}

export const down = (pgm) => {
  pgm.dropColumn({ schema, name: 'categories' }, 'currency')
}
