const schema = 'fin'

/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined

/**
 * Recurring templates catch up with what an operation can carry, and learn
 * to wait for the user:
 *   - to_amount — the second amount of a cross-currency transfer, or of an
 *     operation against a category with its own currency (same meaning as
 *     transactions.to_amount), copied onto every operation the template makes;
 *   - tag_ids — same as transactions.tag_ids, likewise copied;
 *   - require_confirm — don't book due occurrences automatically; the app
 *     lists each one for the user to book (amount still editable) or skip.
 * Existing templates keep booking automatically, with no second amount or tags.
 *
 * Accounts get an optional savings goal — a target balance in the account's
 * own currency and the date it should be reached by. Only meaningful on a
 * savings account; the frontend never saves one anywhere else.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.addColumns({ schema, name: 'recurring_templates' }, {
    to_amount: { type: 'numeric(14,2)' },
    tag_ids: { type: 'uuid[]', notNull: true, default: pgm.func("'{}'::uuid[]") },
    require_confirm: { type: 'boolean', notNull: true, default: false },
  })
  pgm.addColumns({ schema, name: 'accounts' }, {
    goal_amount: { type: 'numeric(14,2)' },
    goal_date: { type: 'timestamptz' },
  })
}

export const down = (pgm) => {
  pgm.dropColumns({ schema, name: 'recurring_templates' }, ['to_amount', 'tag_ids', 'require_confirm'])
  pgm.dropColumns({ schema, name: 'accounts' }, ['goal_amount', 'goal_date'])
}
