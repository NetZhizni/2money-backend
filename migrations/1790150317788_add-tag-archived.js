const schema = 'fin'

/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined

/**
 * Archiving for tags, same meaning as accounts.archived/categories.archived:
 * an archived tag drops out of the frontend's tag picker for new operations
 * but stays on every operation that already carries it (and in analytics and
 * the operations filter). Existing tags start out active.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.addColumn({ schema, name: 'tags' }, {
    archived: { type: 'boolean', notNull: true, default: false },
  })
}

export const down = (pgm) => {
  pgm.dropColumn({ schema, name: 'tags' }, 'archived')
}
