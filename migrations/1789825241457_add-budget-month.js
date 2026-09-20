const schema = 'fin'

/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined

/**
 * Anchors each budget to a specific calendar month ('YYYY-MM'), so the
 * frontend's new Budget section can keep a distinct limit per month per
 * category instead of one open-ended "monthly" limit that silently applied
 * forever — that in turn is what makes "copy last month's budget into this
 * one" a real action instead of a no-op (see frontend's stores/budgets.ts
 * `copyFromPreviousMonth`).
 *
 * Existing rows predate this column, so there's no "the" month to put them
 * in — anchoring each to the month it was CREATED in is the closest
 * approximation (keeps it as a real, still-visible budget for that month
 * rather than orphaning it) and costs the user nothing: the new "copy from
 * previous month" button lets them carry it forward from there with one tap.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.addColumn({ schema, name: 'budgets' }, {
    month: { type: 'varchar(7)' },
  })
  pgm.sql(`UPDATE ${schema}.budgets SET month = to_char(created_at, 'YYYY-MM') WHERE month IS NULL`)
  pgm.alterColumn({ schema, name: 'budgets' }, 'month', { notNull: true })
}

export const down = (pgm) => {
  pgm.dropColumn({ schema, name: 'budgets' }, 'month')
}
