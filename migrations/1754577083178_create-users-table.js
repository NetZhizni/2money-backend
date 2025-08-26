/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  // Таблиця валют
  pgm.createTable('currencies', {
    code: { type: 'varchar(3)', primaryKey: true }, // ISO code (e.g. USD)
    numeric_code: { type: 'integer', notNull: true }, // Numeric code (e.g. 840)
    name: { type: 'text', notNull: true },
    symbol: { type: 'text' },
    decimal_digits: { type: 'smallint', default: 2 },
    is_archive: {
      type: 'boolean',
      notNull: true,
      default: false,
    },
  })

  // Таблиця користувачів
  pgm.createTable('users', {
    id: 'id',
    last_name: { type: 'text', notNull: true },
    first_name: { type: 'text', notNull: true },
    photo: { type: 'text' },
    base_currency: {
      type: 'varchar(3)',
      references: 'currencies(code)',
      onDelete: 'SET NULL',
    },
    email: { type: 'text', notNull: true, unique: true },
    is_archive: {
      type: 'boolean',
      notNull: true,
      default: false,
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
    updated_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  })

  // Типи рахунків
  pgm.createTable('account_types', {
    id: 'id',
    name: { type: 'text', notNull: true },
  })

  // Рахунки
  pgm.createTable('accounts', {
    id: 'id',
    name: { type: 'text', notNull: true },
    currency: {
      type: 'varchar(3)',
      references: 'currencies(code)',
      notNull: true,
    },
    initial_balance: { type: 'numeric(14,2)', default: 0 },
    icon: { type: 'text' },
    color: { type: 'text' },
    owner_id: {
      type: 'integer',
      references: 'users(id)',
      notNull: true,
      onDelete: 'cascade',
    },
    account_type_id: {
      type: 'integer',
      references: 'account_types(id)',
      notNull: true,
    },
    is_archive: {
      type: 'boolean',
      notNull: true,
      default: false,
    },
  })

  // Типи операцій
  pgm.createTable('operation_types', {
    id: 'id',
    code: { type: 'varchar(50)', notNull: true, unique: true }, // напр. 'income'
    name: { type: 'text', notNull: true }, // напр. 'Дохід'
  })

  // Операції
  pgm.createTable('transactions', {
    id: 'id',
    date: { type: 'timestamptz', default: pgm.func('current_timestamp') },
    operation_type_id: {
      type: 'integer',
      references: 'operation_types(id)',
      notNull: true,
      onDelete: 'restrict',
    },
    from_account_id: {
      type: 'integer',
      references: 'accounts(id)',
      onDelete: 'SET NULL',
    },
    from_amount: { type: 'numeric(14,2)', notNull: true },
    to_account_id: {
      type: 'integer',
      references: 'accounts(id)',
      onDelete: 'SET NULL',
    },
    to_amount: { type: 'numeric(14,2)', notNull: true },
    comment: { type: 'text' },
  })

  // Індекси для швидкого доступу
  pgm.createIndex('accounts', 'owner_id')
  pgm.createIndex('transactions', ['from_account_id', 'to_account_id'])
}

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('transactions')
  pgm.dropTable('operation_types')
  pgm.dropTable('accounts')
  pgm.dropTable('account_types')
  pgm.dropTable('users')
  pgm.dropTable('currencies')
}
