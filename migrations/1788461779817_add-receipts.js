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
 * Groups the transactions saved from one scanned receipt (see
 * backend/src/services/internal/receipt/scanReceipt.js) so they can be shown
 * and totalled together after the fact. The scan endpoint itself still
 * writes nothing — a receipt row is created only when the user actually
 * saves the first operation from it (see ReceiptScanReviewModal.vue), so a
 * scanned-then-discarded photo never leaves a row behind. `transactions.
 * receipt_id` is nullable and `ON DELETE SET NULL` (not CASCADE) — removing
 * a receipt should only ungroup its transactions, never delete them.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.createTable({ schema, name: 'receipts' }, {
    id: { type: 'uuid', primaryKey: true },
    owner_id: { type: 'uuid', notNull: true, references: `${schema}.users(id)`, onDelete: 'cascade' },
    merchant: { type: 'text' },
    date: { type: 'timestamptz' },
    currency: { type: 'varchar(3)' },
    note: { type: 'text' },
    ...syncColumns(pgm),
  })
  pgm.createIndex({ schema, name: 'receipts' }, 'owner_id')
  pgm.createIndex({ schema, name: 'receipts' }, 'updated_at')

  pgm.addColumn({ schema, name: 'transactions' }, {
    receipt_id: { type: 'uuid', references: `${schema}.receipts(id)`, onDelete: 'set null' },
  })
  pgm.createIndex({ schema, name: 'transactions' }, 'receipt_id')
}

export const down = (pgm) => {
  pgm.dropColumn({ schema, name: 'transactions' }, 'receipt_id')
  pgm.dropTable({ schema, name: 'receipts' })
}
