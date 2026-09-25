const camelToSnake = (name) => name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)

/**
 * One syncable field. `name` is what the client sends (camelCase, matching
 * the frontend's TS models); `column` is the Postgres column it maps to
 * (snake_case by default). `date: true` marks an epoch-ms field the client
 * sends as a number and the database stores as a timestamp — engine.js runs
 * those through msToDate on the way in. `default` is only used on create:
 * a field the client omits is written as this rather than left NULL, which
 * keeps an offline client's partial record from violating a NOT NULL.
 * `serverOnly: true` marks a field the client never gets to write:
 * engine.js strips it from every incoming body before any hook runs, so only
 * a hook (or the admin restore's rawUpsert) can ever set it.
 * `ref: '<entity>'` marks a field holding the id of the record this row lives
 * in — an account, a category, a parent category. A write that newly points
 * it at a deleted record is refused (see engine.js's refuseDeletedRefs): the
 * foreign key can't catch that, since deletes are soft and the tombstone
 * still satisfies it. Left off links that only say where a row came from (a
 * transaction's templateId/receiptId) — losing those is harmless.
 */
function col(name, { column, date = false, default: def, serverOnly = false, ref } = {}) {
  return { name, column: column ?? camelToSnake(name), date, default: def, serverOnly, ref }
}

/**
 * The single source of truth for every syncable entity — engine.js builds all
 * of its SQL from this, and router.js mounts one REST resource per entry, so
 * adding an entity means adding a row here (plus an optional hook), not a new
 * router/service/model trio.
 *
 * Only names that appear in this file ever reach a SQL string; every value is
 * parameterized. That's what keeps the generic query building injection-safe
 * — nothing about the shape of a query is ever taken from the request.
 *
 * Reading: the family is the trust boundary. One server hosts one family, and
 * every active member can read every row of every entity — `?scope=all` and
 * POST /<entity>/by-ids apply no owner filter at all, and the frontend always
 * pulls with `scope=all`, because the combined balance, the "view as" switcher
 * and cross-profile transfers all need everyone's data on every device. So
 * `listDefaultFilter` is NOT access control; it only decides what a request
 * WITHOUT `scope=all` returns — the caller's own slice:
 *   - 'owner'       — rows they own (accounts, budgets, templates, receipts)
 *   - 'participant' — theirs plus ones they're a counterparty on, matched
 *                     against participant_ids (transactions — see the
 *                     transactions hook)
 *   - 'none'        — the whole table: categories and tags are shared
 *                     resources with no "own" slice to speak of
 * If members ever need privacy from each other, this is where it would have
 * to start — and `scope=all` and by-ids would have to become filtered too.
 *
 * Writing IS guarded. With `ownerGuarded` on, an upsert or delete only touches
 * a row whose owner_id already matches the caller, so a member can't take over
 * or remove someone else's record by reusing its id. It's off exactly where
 * listDefaultFilter is 'none' — a shared resource has no single owner, and any
 * member may edit it.
 */
export const registry = {
  accounts: {
    table: 'accounts',
    path: 'accounts',
    listDefaultFilter: 'owner',
    ownerGuarded: true,
    messages: { notFound: 'Рахунок не знайдено', conflict: 'Рахунок з таким id вже належить іншому користувачу' },
    columns: [
      col('name'),
      col('type'),
      col('currency'),
      col('icon'),
      col('color'),
      col('initialBalance', { default: 0 }),
      col('loanDirection', { default: null }),
      col('includeInTotal', { default: true }),
      col('archived', { default: false }),
      col('order', { default: 0 }),
      col('note', { default: null }),
      col('currencyDisplay', { default: null }),
    ],
  },

  categories: {
    table: 'categories',
    path: 'categories',
    listDefaultFilter: 'none',
    ownerGuarded: false,
    messages: { notFound: 'Категорію не знайдено', conflict: 'Категорія з таким id вже належить іншому користувачу' },
    columns: [
      col('name'),
      col('kind'),
      col('icon'),
      col('color'),
      col('parentId', { default: null, ref: 'categories' }),
      col('archived', { default: false }),
      col('order', { default: 0 }),
      col('isDefault', { default: false }),
      col('currency', { default: null }),
      col('currencyDisplay', { default: null }),
    ],
  },

  tags: {
    table: 'tags',
    path: 'tags',
    listDefaultFilter: 'none',
    ownerGuarded: false,
    messages: { notFound: 'Тег не знайдено', conflict: 'Тег з таким id вже належить іншому користувачу' },
    columns: [col('name'), col('color'), col('archived', { default: false })],
  },

  transactions: {
    table: 'transactions',
    path: 'transactions',
    listDefaultFilter: 'participant',
    ownerGuarded: true,
    messages: { notFound: 'Транзакцію не знайдено', conflict: 'Транзакція з таким id вже належить іншому користувачу' },
    columns: [
      // Who can see the row — derived from the destination account's owner
      // (see hooks/transactions.js), never taken from the request.
      col('participantIds', { serverOnly: true }),
      col('type'),
      col('date', { date: true }),
      col('accountId', { ref: 'accounts' }),
      col('toAccountId', { default: null, ref: 'accounts' }),
      col('categoryId', { default: null, ref: 'categories' }),
      col('subcategoryId', { default: null, ref: 'categories' }),
      col('amount'),
      col('toAmount', { default: null }),
      col('currency'),
      col('note', { default: null }),
      col('templateId', { default: null }),
      col('receiptId', { default: null }),
      col('tagIds', { default: [] }),
    ],
  },

  recurringTemplates: {
    table: 'recurring_templates',
    path: 'recurring-templates',
    listDefaultFilter: 'owner',
    ownerGuarded: true,
    messages: { notFound: 'Шаблон не знайдено', conflict: 'Шаблон з таким id вже належить іншому користувачу' },
    columns: [
      col('type'),
      col('accountId', { ref: 'accounts' }),
      col('toAccountId', { default: null, ref: 'accounts' }),
      col('categoryId', { default: null, ref: 'categories' }),
      col('subcategoryId', { default: null, ref: 'categories' }),
      col('amount'),
      col('currency'),
      col('note', { default: null }),
      col('frequency'),
      col('interval', { default: 1 }),
      col('startDate', { date: true }),
      col('endDate', { date: true, default: null }),
      col('nextDate', { date: true }),
      col('active', { default: true }),
    ],
  },

  budgets: {
    table: 'budgets',
    path: 'budgets',
    listDefaultFilter: 'owner',
    ownerGuarded: true,
    messages: { notFound: 'Бюджет не знайдено', conflict: 'Бюджет з таким id вже належить іншому користувачу' },
    columns: [col('categoryId', { ref: 'categories' }), col('amount'), col('currency'), col('period', { default: 'monthly' }), col('month')],
  },

  receipts: {
    table: 'receipts',
    path: 'receipts',
    listDefaultFilter: 'owner',
    ownerGuarded: true,
    messages: { notFound: 'Чек не знайдено', conflict: 'Чек з таким id вже належить іншому користувачу' },
    columns: [
      col('merchant', { default: null }),
      col('date', { date: true, default: null }),
      col('currency', { default: null }),
      col('note', { default: null }),
      col('accountId', { default: null, ref: 'accounts' }),
    ],
  },
}

/** Always quote: several real column names here ("order", "interval") are reserved words in SQL. */
export const quoteCol = (name) => `"${name}"`
