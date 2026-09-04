const schema = 'fin'

/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined

/**
 * The account a receipt was paid from — the single source of truth for
 * "same account" once operations start getting grouped/merged into a
 * receipt (see stores/receipts.ts's ReceiptEditModal.vue cascade-update:
 * changing a receipt's account re-patches every transaction linked to it).
 * `ON DELETE SET NULL` (not RESTRICT, unlike transactions.account_id) since
 * an account can only actually be removed once nothing references it
 * anymore anyway — every transaction still linked to this receipt already
 * blocks deletion via its own `account_id` RESTRICT constraint, so this
 * column only ever goes null for a receipt whose transactions were all since
 * detached/removed.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.addColumn({ schema, name: 'receipts' }, {
    account_id: { type: 'uuid', references: `${schema}.accounts(id)`, onDelete: 'set null' },
  })
  pgm.createIndex({ schema, name: 'receipts' }, 'account_id')
}

export const down = (pgm) => {
  pgm.dropColumn({ schema, name: 'receipts' }, 'account_id')
}
