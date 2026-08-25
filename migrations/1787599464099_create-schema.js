export const shorthands = undefined

const schema = 'fin'

// Every table that participates in offline-first delta sync (accounts,
// categories, transactions, recurring_templates, budgets) gets the same
// three sync columns: created_at/updated_at for bookkeeping + `?since=`
// cursor filtering, and deleted_at as a soft-delete tombstone so an offline
// client that pulls a delta batch finds out a record was removed instead of
// just never hearing about it again.
const syncColumns = (pgm) => ({
  created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  deleted_at: { type: 'timestamptz' },
})

export const up = (pgm) => {
  pgm.createSchema(schema, { ifNotExists: true })

  // One row per authenticated, allowlisted family member. Doc id === app id
  // (uuid), matched against Firebase Auth by email (see src/middleware/auth.js).
  pgm.createTable({ schema, name: 'users' }, {
    id: { type: 'uuid', primaryKey: true },
    email: { type: 'text', notNull: true, unique: true },
    display_name: { type: 'text', notNull: true },
    photo_url: { type: 'text' },
    color: { type: 'text', notNull: true },
    role: { type: 'text', notNull: true, default: 'member' },
    is_active: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  })
  pgm.addConstraint({ schema, name: 'users' }, 'users_role_check', {
    check: "role in ('owner', 'member')",
  })

  // 1:1 with users — per-profile preferences, not shared family data.
  pgm.createTable({ schema, name: 'app_settings' }, {
    user_id: {
      type: 'uuid',
      primaryKey: true,
      references: `${schema}.users(id)`,
      onDelete: 'cascade',
    },
    base_currency: { type: 'varchar(3)', notNull: true, default: 'UAH' },
    theme: { type: 'text', notNull: true, default: 'system' },
    onboarded: { type: 'boolean', notNull: true, default: false },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  })
  pgm.addConstraint({ schema, name: 'app_settings' }, 'app_settings_theme_check', {
    check: "theme in ('system', 'light', 'dark')",
  })

  pgm.createTable({ schema, name: 'accounts' }, {
    id: { type: 'uuid', primaryKey: true },
    owner_id: { type: 'uuid', notNull: true, references: `${schema}.users(id)`, onDelete: 'cascade' },
    name: { type: 'text', notNull: true },
    type: { type: 'text', notNull: true },
    currency: { type: 'varchar(3)', notNull: true },
    icon: { type: 'text', notNull: true },
    color: { type: 'text', notNull: true },
    initial_balance: { type: 'numeric(14,2)', notNull: true, default: 0 },
    loan_direction: { type: 'text' },
    include_in_total: { type: 'boolean', notNull: true, default: true },
    archived: { type: 'boolean', notNull: true, default: false },
    order: { type: 'integer', notNull: true, default: 0 },
    note: { type: 'text' },
    ...syncColumns(pgm),
  })
  pgm.addConstraint({ schema, name: 'accounts' }, 'accounts_type_check', {
    check: "type in ('regular', 'savings', 'loan')",
  })
  pgm.addConstraint({ schema, name: 'accounts' }, 'accounts_loan_direction_check', {
    check: "loan_direction is null or loan_direction in ('lent', 'borrowed')",
  })

  pgm.createTable({ schema, name: 'categories' }, {
    id: { type: 'uuid', primaryKey: true },
    owner_id: { type: 'uuid', notNull: true, references: `${schema}.users(id)`, onDelete: 'cascade' },
    name: { type: 'text', notNull: true },
    kind: { type: 'text', notNull: true },
    icon: { type: 'text', notNull: true },
    color: { type: 'text', notNull: true },
    parent_id: { type: 'uuid', references: `${schema}.categories(id)`, onDelete: 'set null' },
    archived: { type: 'boolean', notNull: true, default: false },
    order: { type: 'integer', notNull: true, default: 0 },
    is_default: { type: 'boolean', notNull: true, default: false },
    ...syncColumns(pgm),
  })
  pgm.addConstraint({ schema, name: 'categories' }, 'categories_kind_check', {
    check: "kind in ('expense', 'income')",
  })

  // Recurring templates before transactions so transactions.template_id can
  // reference it directly.
  pgm.createTable({ schema, name: 'recurring_templates' }, {
    id: { type: 'uuid', primaryKey: true },
    owner_id: { type: 'uuid', notNull: true, references: `${schema}.users(id)`, onDelete: 'cascade' },
    type: { type: 'text', notNull: true },
    account_id: { type: 'uuid', notNull: true, references: `${schema}.accounts(id)`, onDelete: 'cascade' },
    to_account_id: { type: 'uuid', references: `${schema}.accounts(id)`, onDelete: 'cascade' },
    category_id: { type: 'uuid', references: `${schema}.categories(id)`, onDelete: 'set null' },
    subcategory_id: { type: 'uuid', references: `${schema}.categories(id)`, onDelete: 'set null' },
    amount: { type: 'numeric(14,2)', notNull: true },
    currency: { type: 'varchar(3)', notNull: true },
    note: { type: 'text' },
    frequency: { type: 'text', notNull: true },
    interval: { type: 'integer', notNull: true, default: 1 },
    start_date: { type: 'timestamptz', notNull: true },
    end_date: { type: 'timestamptz' },
    next_date: { type: 'timestamptz', notNull: true },
    active: { type: 'boolean', notNull: true, default: true },
    ...syncColumns(pgm),
  })
  pgm.addConstraint({ schema, name: 'recurring_templates' }, 'recurring_templates_type_check', {
    check: "type in ('expense', 'income', 'transfer')",
  })
  pgm.addConstraint({ schema, name: 'recurring_templates' }, 'recurring_templates_frequency_check', {
    check: "frequency in ('daily', 'weekly', 'monthly', 'yearly')",
  })

  pgm.createTable({ schema, name: 'transactions' }, {
    id: { type: 'uuid', primaryKey: true },
    owner_id: { type: 'uuid', notNull: true, references: `${schema}.users(id)`, onDelete: 'cascade' },
    // [ownerId], or [ownerId, counterpartyId] for a cross-profile transfer —
    // lets a family member's transactions feed read include transfers where
    // they're only the receiving side.
    participant_ids: { type: 'uuid[]', notNull: true, default: pgm.func("'{}'::uuid[]") },
    type: { type: 'text', notNull: true },
    date: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    account_id: { type: 'uuid', notNull: true, references: `${schema}.accounts(id)`, onDelete: 'restrict' },
    to_account_id: { type: 'uuid', references: `${schema}.accounts(id)`, onDelete: 'restrict' },
    category_id: { type: 'uuid', references: `${schema}.categories(id)`, onDelete: 'set null' },
    subcategory_id: { type: 'uuid', references: `${schema}.categories(id)`, onDelete: 'set null' },
    amount: { type: 'numeric(14,2)', notNull: true },
    to_amount: { type: 'numeric(14,2)' },
    currency: { type: 'varchar(3)', notNull: true },
    exchange_rate: { type: 'numeric(18,6)', notNull: true, default: 1 },
    base_amount: { type: 'numeric(14,2)', notNull: true },
    note: { type: 'text' },
    template_id: { type: 'uuid', references: `${schema}.recurring_templates(id)`, onDelete: 'set null' },
    ...syncColumns(pgm),
  })
  pgm.addConstraint({ schema, name: 'transactions' }, 'transactions_type_check', {
    check: "type in ('expense', 'income', 'transfer')",
  })

  pgm.createTable({ schema, name: 'budgets' }, {
    id: { type: 'uuid', primaryKey: true },
    owner_id: { type: 'uuid', notNull: true, references: `${schema}.users(id)`, onDelete: 'cascade' },
    category_id: { type: 'uuid', notNull: true, references: `${schema}.categories(id)`, onDelete: 'cascade' },
    amount: { type: 'numeric(14,2)', notNull: true },
    currency: { type: 'varchar(3)', notNull: true },
    period: { type: 'text', notNull: true, default: 'monthly' },
    ...syncColumns(pgm),
  })

  // owner_id + updated_at indexes on every syncable table: owner_id backs
  // the default "my records" list, updated_at backs the `?since=` delta pull.
  for (const table of ['accounts', 'categories', 'transactions', 'recurring_templates', 'budgets']) {
    pgm.createIndex({ schema, name: table }, 'owner_id')
    pgm.createIndex({ schema, name: table }, 'updated_at')
  }
  pgm.createIndex({ schema, name: 'transactions' }, 'participant_ids', { method: 'gin' })
  pgm.createIndex({ schema, name: 'transactions' }, 'account_id')
  pgm.createIndex({ schema, name: 'transactions' }, 'to_account_id')
  pgm.createIndex({ schema, name: 'categories' }, 'parent_id')
}

export const down = (pgm) => {
  pgm.dropSchema(schema, { cascade: true })
}
