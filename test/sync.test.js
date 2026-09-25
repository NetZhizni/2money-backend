import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestDatabase } from './helpers/database.js'

let database
let engine
let pg
let uuidv7
let httpStatusFor
let reasonFor
let baseUrl
let server

const A = { email: 'a@test.local' }
const B = { email: 'b@test.local' }

const account = (overrides = {}) => ({
  id: uuidv7(),
  name: 'Картка',
  type: 'regular',
  currency: 'UAH',
  icon: 'mdiCreditCard',
  color: '#123456',
  ...overrides,
})

const category = (overrides = {}) => ({
  id: uuidv7(),
  name: 'Продукти',
  kind: 'expense',
  icon: 'mdiCart',
  color: '#654321',
  ...overrides,
})

const template = (accountId, overrides = {}) => ({
  id: uuidv7(),
  type: 'expense',
  accountId,
  amount: 50,
  currency: 'UAH',
  frequency: 'monthly',
  startDate: Date.now(),
  nextDate: Date.now(),
  ...overrides,
})

const transaction = (accountId, overrides = {}) => ({
  id: uuidv7(),
  type: 'expense',
  date: Date.now(),
  accountId,
  amount: 100,
  currency: 'UAH',
  ...overrides,
})

async function call(user, method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': user.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

async function row(table, id) {
  return (await pg.query(`SELECT * FROM ${table} WHERE id = $1`, [id])).rows[0]
}

before(async () => {
  database = await startTestDatabase()
  ;({ default: engine } = await import('#sync/engine'))
  ;({ default: pg } = await import('#util/pg'))
  ;({ uuidv7 } = await import('#util/uuid'))
  ;({ httpStatusFor, reasonFor } = await import('#util/httpStatus'))
  const { default: UserModel } = await import('#sql/UserModel')
  const { mountSyncRoutes } = await import('#sync/router')
  const { default: errorMiddleware } = await import('#middleware/error')
  const { default: express } = await import('express')

  for (const user of [A, B]) {
    user.id = uuidv7()
    await UserModel.create({ id: user.id, email: user.email, displayName: user.email, color: '#000000', role: 'member' })
  }

  // The real sync routes behind a stand-in for middleware/auth.js, which
  // would otherwise need a Firebase token: the caller picks who they are.
  const app = express()
  app.use(express.json())
  app.use((req, res, next) => {
    req.user = [A, B].find((user) => user.id === req.headers['x-test-user'])
    next()
  })
  const api = express.Router()
  mountSyncRoutes(api)
  app.use('/api', api)
  app.use(errorMiddleware)
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve)
  })
  baseUrl = `http://127.0.0.1:${server.address().port}/api`
})

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve))
  await database?.stop()
})

describe('httpStatusFor', () => {
  test('keeps an explicit status', () => assert.equal(httpStatusFor({ status: 404, code: '23503' }), 404))
  test('bad data from Postgres is a 4xx, not a 500', () => {
    assert.equal(httpStatusFor({ code: '22P02' }), 400) // invalid uuid
    assert.equal(httpStatusFor({ code: '23502' }), 400) // NOT NULL
    assert.equal(httpStatusFor({ code: '23514' }), 400) // CHECK
    assert.equal(httpStatusFor({ code: '23503' }), 409) // FK
    assert.equal(httpStatusFor({ code: '23505' }), 409) // unique
  })
  test('anything else stays a retryable 500', () => {
    assert.equal(httpStatusFor({ code: '40P01' }), 500) // deadlock
    assert.equal(httpStatusFor({ code: 'ECONNRESET' }), 500)
    assert.equal(httpStatusFor(new Error('boom')), 500)
  })
  test('reasonFor names why, for the client to show', () => {
    assert.equal(reasonFor({ status: 409, reason: 'stale' }), 'stale')
    assert.equal(reasonFor({ code: '23503' }), 'reference')
    assert.equal(reasonFor({ code: '23502' }), 'invalid')
    assert.equal(reasonFor({ code: '23505' }), 'conflict')
    assert.equal(reasonFor({ status: 404 }), 'notFound')
    assert.equal(reasonFor(new Error('boom')), 'server')
  })
})

describe('bulk upsert', () => {
  test('one bad row does not cost the others their write', async () => {
    const acc = account()
    await engine.create({ entity: 'accounts', ownerId: A.id, body: acc })
    const good1 = transaction(acc.id)
    const missingAmount = transaction(acc.id, { amount: undefined })
    const unknownAccount = transaction(uuidv7())
    const badType = transaction(acc.id, { type: 'gift' })
    const good2 = transaction(acc.id)

    const { status, body } = await call(A, 'POST', '/transactions/bulk', { items: [good1, missingAmount, unknownAccount, badType, good2] })
    assert.equal(status, 200)
    assert.deepEqual(
      body.items.map((item) => [item.id, item.ok, item.status]),
      [
        [good1.id, true, undefined],
        [missingAmount.id, false, 400],
        [unknownAccount.id, false, 409],
        [badType.id, false, 400],
        [good2.id, true, undefined],
      ],
    )
    assert.ok(await row('transactions', good1.id))
    assert.ok(await row('transactions', good2.id))
    assert.equal(await row('transactions', missingAmount.id), undefined)
  })

  test('a malformed id is rejected per item instead of failing the whole batch', async () => {
    const acc = account()
    const { body } = await call(A, 'POST', '/accounts/bulk', { items: [{ ...account(), id: 'not-a-uuid' }, acc] })
    assert.deepEqual(body.items.map((item) => [item.ok, item.status]), [[false, 400], [true, undefined]])
  })

  test('the same id twice in a batch is written once, with the later body', async () => {
    const acc = account({ name: 'v1' })
    const { body } = await call(A, 'POST', '/accounts/bulk', { items: [acc, { ...acc, name: 'v2' }] })
    assert.deepEqual(body.items.map((item) => item.ok), [true, true])
    assert.equal((await row('accounts', acc.id)).name, 'v2')
  })

  test("someone else's id is a per-item 409 and leaves their row untouched", async () => {
    const theirs = account({ name: 'B-owned' })
    await engine.create({ entity: 'accounts', ownerId: B.id, body: theirs })
    const { body } = await call(A, 'POST', '/accounts/bulk', { items: [{ ...theirs, name: 'hijacked' }] })
    assert.equal(body.items[0].status, 409)
    const stored = await row('accounts', theirs.id)
    assert.equal(stored.name, 'B-owned')
    assert.equal(stored.owner_id, B.id)
  })

  test('a parent category and its child land together in one batch', async () => {
    const parent = category()
    const child = category({ parentId: parent.id, currency: 'USD' })
    const { body } = await call(A, 'POST', '/categories/bulk', { items: [parent, child] })
    assert.deepEqual(body.items.map((item) => item.ok), [true, true])
    assert.equal((await row('categories', child.id)).currency, null) // subcategories inherit, never store their own
    assert.equal((await row('categories', parent.id)).currency, 'UAH') // no operations yet -> base currency
  })

  test('a tag keeps its archived flag, and one sent without it starts out active', async () => {
    const archived = { id: uuidv7(), name: 'Trip 2025', color: '#000000', archived: true }
    const legacy = { id: uuidv7(), name: 'Old client', color: '#000000' }
    const { body } = await call(A, 'POST', '/tags/bulk', { items: [archived, legacy] })
    assert.deepEqual(body.items.map((item) => item.ok), [true, true])
    assert.equal((await row('tags', archived.id)).archived, true)
    assert.equal((await row('tags', legacy.id)).archived, false)
  })
})

describe('participantIds', () => {
  test('is derived server-side on create, never taken from the client', async () => {
    const mine = account()
    const theirs = account()
    await engine.create({ entity: 'accounts', ownerId: A.id, body: mine })
    await engine.create({ entity: 'accounts', ownerId: B.id, body: theirs })

    const plain = transaction(mine.id, { participantIds: [B.id] })
    const transfer = transaction(mine.id, { type: 'transfer', toAccountId: theirs.id, toAmount: 100 })
    await call(A, 'POST', '/transactions/bulk', { items: [plain, transfer] })

    assert.deepEqual((await row('transactions', plain.id)).participant_ids, [A.id])
    assert.deepEqual((await row('transactions', transfer.id)).participant_ids, [A.id, B.id])
  })

  test('an update cannot set it directly either, only recompute it from toAccountId', async () => {
    const mine = account()
    const theirs = account()
    await engine.create({ entity: 'accounts', ownerId: A.id, body: mine })
    await engine.create({ entity: 'accounts', ownerId: B.id, body: theirs })
    const tx = transaction(mine.id)
    await engine.create({ entity: 'transactions', ownerId: A.id, body: tx })

    const sneaky = await call(A, 'POST', '/transactions/bulk', { items: [{ ...tx, participantIds: [A.id, B.id], note: 'hi' }] })
    assert.equal(sneaky.body.items[0].ok, true)
    assert.deepEqual((await row('transactions', tx.id)).participant_ids, [A.id])

    await call(A, 'POST', '/transactions/bulk', { items: [{ ...tx, type: 'transfer', toAccountId: theirs.id, toAmount: 100 }] })
    assert.deepEqual((await row('transactions', tx.id)).participant_ids, [A.id, B.id])
  })

  test('PATCH is gone — the outbox only ever sends full records', async () => {
    const acc = account()
    await engine.create({ entity: 'accounts', ownerId: A.id, body: acc })
    const { status } = await fetch(`${baseUrl}/accounts/${acc.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-test-user': A.id },
      body: JSON.stringify({ name: 'x' }),
    })
    assert.equal(status, 404)
  })
})

describe('conflicts between devices', () => {
  test('an edit made earlier than the stored one is refused as stale, with a reason', async () => {
    const acc = account({ name: 'newer' })
    const now = Date.now()
    await call(A, 'POST', '/accounts/bulk', { items: [{ ...acc, editedAt: now - 1_000 }] })

    const late = await call(A, 'POST', '/accounts/bulk', { items: [{ ...acc, name: 'week-old offline edit', editedAt: now - 7 * 86_400_000 }] })
    assert.deepEqual([late.body.items[0].ok, late.body.items[0].status, late.body.items[0].reason], [false, 409, 'stale'])
    assert.equal((await row('accounts', acc.id)).name, 'newer')

    const later = await call(A, 'POST', '/accounts/bulk', { items: [{ ...acc, name: 'latest', editedAt: now }] })
    assert.equal(later.body.items[0].ok, true)
    assert.equal((await row('accounts', acc.id)).name, 'latest')
  })

  test('replaying the same write after a lost response succeeds again instead of conflicting', async () => {
    const acc = account()
    const item = { ...acc, editedAt: Date.now() - 5_000 }
    const first = await call(A, 'POST', '/accounts/bulk', { items: [item] })
    const replay = await call(A, 'POST', '/accounts/bulk', { items: [item] })
    assert.deepEqual([first.body.items[0].ok, replay.body.items[0].ok], [true, true])
  })

  test('a device clock running ahead cannot pre-date every later edit', async () => {
    const acc = account({ name: 'from the future' })
    await call(A, 'POST', '/accounts/bulk', { items: [{ ...acc, editedAt: Date.now() + 86_400_000 }] })
    const stored = await row('accounts', acc.id)
    const { rows } = await pg.query('SELECT now() AS now')
    assert.ok(stored.client_updated_at <= new Date(rows[0].now))

    const next = await call(A, 'POST', '/accounts/bulk', { items: [{ ...acc, name: 'right now', editedAt: Date.now() }] })
    assert.equal(next.body.items[0].ok, true)
  })

  test('a device whose clock runs behind loses its newer edit — until it stamps with the server clock it measured', async () => {
    const acc = account({ name: 'laptop' })
    // The laptop's clock is right; it saves the record first.
    await call(A, 'POST', '/accounts/bulk', { items: [{ ...acc, editedAt: Date.now() }] })

    // Then the phone edits it, but its clock is three minutes slow: by its
    // own reckoning, that edit came before the laptop's.
    const phoneClock = () => Date.now() - 180_000
    const raw = await call(A, 'POST', '/accounts/bulk', { items: [{ ...acc, name: 'phone', editedAt: phoneClock() }] })
    assert.equal(raw.body.items[0].reason, 'stale')
    assert.equal((await row('accounts', acc.id)).name, 'laptop')

    // Measured against a pull's serverNow, the way the frontend's
    // db/sync/clock.ts does it, the same edit is in the right time.
    const sentAt = phoneClock()
    const { body: pull } = await call(A, 'POST', '/sync/pull', { cursors: {} })
    const offset = pull.serverNow - (sentAt + phoneClock()) / 2
    const corrected = await call(A, 'POST', '/accounts/bulk', { items: [{ ...acc, name: 'phone', editedAt: phoneClock() + offset }] })
    assert.equal(corrected.body.items[0].ok, true)
    assert.equal((await row('accounts', acc.id)).name, 'phone')
  })

  test('a shared category edited by two members keeps the later edit, whichever arrives last', async () => {
    const cat = category({ name: 'original' })
    const now = Date.now()
    await call(A, 'POST', '/categories/bulk', { items: [{ ...cat, editedAt: now - 60_000 }] })
    await call(B, 'POST', '/categories/bulk', { items: [{ ...cat, name: "B's rename", editedAt: now - 1_000 }] })
    const aOffline = await call(A, 'POST', '/categories/bulk', { items: [{ ...cat, name: "A's older rename", editedAt: now - 30_000 }] })
    assert.equal(aOffline.body.items[0].reason, 'stale')
    assert.equal((await row('categories', cat.id)).name, "B's rename")
  })

  test('a deleted record is never resurrected by a late write', async () => {
    const acc = account()
    await engine.create({ entity: 'accounts', ownerId: A.id, body: acc })
    const tx = transaction(acc.id)
    await engine.create({ entity: 'transactions', ownerId: A.id, body: tx })
    // Its operations first — an account still in use can't be deleted (see 'bulk delete').
    await call(A, 'POST', '/transactions/bulk-delete', { items: [{ id: tx.id, editedAt: Date.now() }] })
    await call(A, 'POST', '/accounts/bulk-delete', { items: [{ id: acc.id, editedAt: Date.now() }] })

    const late = await call(A, 'POST', '/accounts/bulk', { items: [{ ...acc, name: 'edited offline', editedAt: Date.now() + 1 }] })
    assert.deepEqual([late.body.items[0].status, late.body.items[0].reason], [410, 'deleted'])
    assert.ok((await row('accounts', acc.id)).deleted_at)
    assert.ok((await row('transactions', tx.id)).deleted_at)
  })

  test('a delete made before the record was last edited is refused, not applied over that edit', async () => {
    const acc = account()
    const now = Date.now()
    await call(A, 'POST', '/accounts/bulk', { items: [{ ...acc, editedAt: now - 1_000 }] })

    const stale = await call(A, 'POST', '/accounts/bulk-delete', { items: [{ id: acc.id, editedAt: now - 60_000 }] })
    assert.deepEqual([stale.body.items[0].ok, stale.body.items[0].status, stale.body.items[0].reason], [false, 409, 'stale'])
    assert.equal((await row('accounts', acc.id)).deleted_at, null)

    // No edit time at all means "now" — it always goes through.
    const plain = await call(A, 'POST', '/accounts/bulk-delete', { items: [{ id: acc.id }] })
    assert.equal(plain.body.items[0].ok, true)
    assert.ok((await row('accounts', acc.id)).deleted_at)
  })
})

describe('currency lock', () => {
  test("an account's currency can change only while it has no operations", async () => {
    const acc = account()
    await engine.create({ entity: 'accounts', ownerId: A.id, body: acc })
    await engine.create({ entity: 'accounts', ownerId: A.id, body: { ...acc, currency: 'EUR' } })
    assert.equal((await row('accounts', acc.id)).currency, 'EUR')

    await engine.create({ entity: 'transactions', ownerId: A.id, body: transaction(acc.id, { currency: 'EUR' }) })
    const { body } = await call(A, 'POST', '/accounts/bulk', { items: [{ ...acc, currency: 'USD' }, { ...acc, name: 'renamed', currency: 'EUR' }] })
    // Deduped to the later body, which keeps the currency — so the rename goes through.
    assert.deepEqual(body.items.map((item) => item.ok), [true, true])

    const blocked = await call(A, 'POST', '/accounts/bulk', { items: [{ ...acc, currency: 'USD' }] })
    assert.equal(blocked.body.items[0].status, 400)
    assert.equal((await row('accounts', acc.id)).currency, 'EUR')
  })

  test('a top-level category without a currency adopts its operations’ dominant one', async () => {
    const acc = account({ currency: 'USD' })
    const cat = category({ currency: 'USD' })
    await engine.create({ entity: 'accounts', ownerId: A.id, body: acc })
    await engine.create({ entity: 'categories', ownerId: A.id, body: cat })
    await engine.create({ entity: 'transactions', ownerId: A.id, body: transaction(acc.id, { currency: 'USD', categoryId: cat.id }) })

    await call(A, 'POST', '/categories/bulk', { items: [{ ...cat, currency: undefined, name: 'renamed' }] })
    const stored = await row('categories', cat.id)
    assert.equal(stored.name, 'renamed')
    assert.equal(stored.currency, 'USD')
  })
})

describe('bulk delete', () => {
  test('an account with anyone’s operation on either side of it is refused as in use, and nothing is touched', async () => {
    const used = account()
    const empty = account()
    const theirs = account()
    await engine.create({ entity: 'accounts', ownerId: A.id, body: used })
    await engine.create({ entity: 'accounts', ownerId: A.id, body: empty })
    await engine.create({ entity: 'accounts', ownerId: B.id, body: theirs })
    const transferIn = transaction(theirs.id, { type: 'transfer', toAccountId: used.id, toAmount: 100 })
    await engine.create({ entity: 'transactions', ownerId: B.id, body: transferIn })

    const { body } = await call(A, 'POST', '/accounts/bulk-delete', { items: [{ id: used.id }, { id: empty.id }] })
    assert.deepEqual(
      body.items.map((item) => [item.ok, item.status, item.reason]),
      [
        [false, 409, 'inUse'],
        [true, undefined, undefined],
      ],
    )
    assert.equal((await row('accounts', used.id)).deleted_at, null)
    assert.equal((await row('transactions', transferIn.id)).deleted_at, null)
    assert.ok((await row('accounts', empty.id)).deleted_at)

    // Someone else's account stays a plain "not found", in use or not.
    const foreign = await call(B, 'POST', '/accounts/bulk-delete', { items: [{ id: used.id }] })
    assert.equal(foreign.body.items[0].reason, 'notFound')

    // Once its last operation is gone, it can go too.
    await engine.remove({ entity: 'transactions', id: transferIn.id, ownerId: B.id })
    const again = await call(A, 'POST', '/accounts/bulk-delete', { items: [{ id: used.id }] })
    assert.equal(again.body.items[0].ok, true)
  })

  test('a category with anyone’s operation filed under it, or under one of its subcategories, is refused as in use', async () => {
    const acc = account()
    await engine.create({ entity: 'accounts', ownerId: B.id, body: acc })
    const parent = category()
    const child = category({ parentId: parent.id })
    const unused = category()
    await engine.create({ entity: 'categories', ownerId: A.id, body: parent })
    await engine.create({ entity: 'categories', ownerId: A.id, body: child })
    await engine.create({ entity: 'categories', ownerId: A.id, body: unused })
    await engine.create({ entity: 'transactions', ownerId: B.id, body: transaction(acc.id, { categoryId: parent.id, subcategoryId: child.id }) })

    const { body } = await call(A, 'POST', '/categories/bulk-delete', { items: [parent, child, unused].map(({ id }) => ({ id })) })
    assert.deepEqual(
      body.items.map((item) => [item.ok, item.reason]),
      [
        [false, 'inUse'],
        [false, 'inUse'],
        [true, undefined],
      ],
    )
    assert.equal((await row('categories', parent.id)).deleted_at, null)
    assert.equal((await row('categories', child.id)).deleted_at, null)
  })

  test('is idempotent, and reports unknown, foreign and malformed ids separately', async () => {
    const mine = account()
    const theirs = account()
    await engine.create({ entity: 'accounts', ownerId: A.id, body: mine })
    await engine.create({ entity: 'accounts', ownerId: B.id, body: theirs })
    await call(A, 'POST', '/accounts/bulk-delete', { items: [{ id: mine.id }] })

    const ids = [mine.id, uuidv7(), theirs.id, 'bulk']
    const { body } = await call(A, 'POST', '/accounts/bulk-delete', { items: ids.map((id) => ({ id })) })
    assert.deepEqual(body.items.map((item) => [item.ok, item.status]), [[true, undefined], [false, 404], [false, 404], [false, 400]])
    assert.equal((await row('accounts', theirs.id)).deleted_at, null)
  })

  test('deleting an account takes every recurring template on either side of it, whoever owns it', async () => {
    const mine = account()
    const theirs = account()
    await engine.create({ entity: 'accounts', ownerId: A.id, body: mine })
    await engine.create({ entity: 'accounts', ownerId: B.id, body: theirs })
    const fromMine = template(mine.id)
    const theirsIntoMine = template(theirs.id, { type: 'transfer', toAccountId: mine.id })
    const unrelated = template(theirs.id)
    await engine.create({ entity: 'recurringTemplates', ownerId: A.id, body: fromMine })
    await engine.create({ entity: 'recurringTemplates', ownerId: B.id, body: theirsIntoMine })
    await engine.create({ entity: 'recurringTemplates', ownerId: B.id, body: unrelated })

    await call(A, 'POST', '/accounts/bulk-delete', { items: [{ id: mine.id, editedAt: Date.now() }] })
    assert.ok((await row('recurring_templates', fromMine.id)).deleted_at)
    assert.ok((await row('recurring_templates', theirsIntoMine.id)).deleted_at)
    assert.equal((await row('recurring_templates', unrelated.id)).deleted_at, null)
  })
})

describe('deleted parents', () => {
  test('nothing new can be filed under a deleted account or category', async () => {
    const live = account()
    const goneAccount = account()
    const goneCategory = category()
    await engine.create({ entity: 'accounts', ownerId: A.id, body: live })
    await engine.create({ entity: 'accounts', ownerId: A.id, body: goneAccount })
    await engine.create({ entity: 'categories', ownerId: A.id, body: goneCategory })
    await engine.remove({ entity: 'accounts', id: goneAccount.id, ownerId: A.id })
    await engine.remove({ entity: 'categories', id: goneCategory.id, ownerId: A.id })

    const tx = await call(A, 'POST', '/transactions/bulk', {
      items: [transaction(goneAccount.id), transaction(live.id, { categoryId: goneCategory.id }), transaction(live.id)],
    })
    assert.deepEqual(
      tx.body.items.map((item) => [item.ok, item.status, item.reason]),
      [
        [false, 409, 'parentDeleted'],
        [false, 409, 'parentDeleted'],
        [true, undefined, undefined],
      ],
    )

    const others = await Promise.all([
      call(A, 'POST', '/categories/bulk', { items: [category({ parentId: goneCategory.id })] }),
      call(A, 'POST', '/budgets/bulk', { items: [{ id: uuidv7(), categoryId: goneCategory.id, amount: 1000, currency: 'UAH', month: '2026-09' }] }),
      call(A, 'POST', '/recurring-templates/bulk', { items: [template(goneAccount.id)] }),
    ])
    assert.deepEqual(
      others.map(({ body }) => body.items[0].reason),
      ['parentDeleted', 'parentDeleted', 'parentDeleted'],
    )
  })

  test('a record that already pointed there before the delete can still be edited', async () => {
    const mine = account()
    const theirs = account()
    await engine.create({ entity: 'accounts', ownerId: A.id, body: mine })
    await engine.create({ entity: 'accounts', ownerId: B.id, body: theirs })
    const transfer = transaction(mine.id, { type: 'transfer', toAccountId: theirs.id, toAmount: 100 })
    await engine.create({ entity: 'transactions', ownerId: A.id, body: transfer })
    // Tombstoned directly: an account in use can't be deleted any more (see
    // 'bulk delete' above), so this is data from before that rule.
    await pg.query(`UPDATE accounts SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1`, [theirs.id])

    const edit = await call(A, 'POST', '/transactions/bulk', { items: [{ ...transfer, note: 'returned the favour' }] })
    assert.equal(edit.body.items[0].ok, true)
    const fresh = await call(A, 'POST', '/transactions/bulk', { items: [transaction(mine.id, { type: 'transfer', toAccountId: theirs.id, toAmount: 5 })] })
    assert.equal(fresh.body.items[0].reason, 'parentDeleted')
  })
})

describe('pulling', () => {
  test('a delta includes tombstones, and the cursor comes from the database clock', async () => {
    const before = await call(A, 'GET', '/accounts?scope=all')
    const { rows } = await pg.query('SELECT now() AS now')
    assert.ok(before.body.syncedAt <= new Date(rows[0].now).getTime())

    const acc = account()
    await engine.create({ entity: 'accounts', ownerId: A.id, body: acc })
    await engine.remove({ entity: 'accounts', id: acc.id, ownerId: A.id })

    const delta = await call(A, 'GET', `/accounts?scope=all&since=${before.body.syncedAt}`)
    const item = delta.body.items.find((candidate) => candidate.id === acc.id)
    assert.ok(item?.deletedAt, 'the tombstone reaches a client that pulled before the delete')
  })

  test('every pull answer carries the database clock, for a client to measure its own against', async () => {
    const [{ now: before }] = (await pg.query('SELECT now() AS now')).rows
    const list = await call(A, 'GET', '/tags?scope=all&limit=1')
    const many = await call(A, 'POST', '/sync/pull', { cursors: {} })
    const [{ now: after }] = (await pg.query('SELECT now() AS now')).rows
    for (const { body } of [list, many]) {
      assert.ok(body.serverNow >= before.getTime() && body.serverNow <= after.getTime())
      assert.ok(body.syncedAt < body.serverNow)
    }
  })

  test('POST /sync/pull returns every requested entity in one answer and skips unknown ones', async () => {
    const { status, body } = await call(A, 'POST', '/sync/pull', {
      cursors: { accounts: null, transactions: null, notAnEntity: null },
      scope: 'all',
      users: true,
    })
    assert.equal(status, 200)
    assert.equal(typeof body.syncedAt, 'number')
    assert.ok(Array.isArray(body.entities.accounts))
    assert.ok(Array.isArray(body.entities.transactions))
    assert.equal(body.entities.notAnEntity, undefined)
    assert.deepEqual(body.users.map((user) => user.id).sort(), [A.id, B.id].sort())
  })

  test('POST /<entity>/by-ids returns the server copy, tombstones included', async () => {
    const live = account()
    const gone = account()
    await engine.create({ entity: 'accounts', ownerId: B.id, body: live })
    await engine.create({ entity: 'accounts', ownerId: B.id, body: gone })
    await engine.remove({ entity: 'accounts', id: gone.id, ownerId: B.id })

    const { body } = await call(A, 'POST', '/accounts/by-ids', { ids: [live.id, gone.id, uuidv7(), 'junk'] })
    const byId = new Map(body.items.map((item) => [item.id, item]))
    assert.equal(byId.size, 2)
    assert.equal(byId.get(live.id).deletedAt, null)
    assert.ok(byId.get(gone.id).deletedAt)
  })

  test('a paged full load and a paged delta each add up to the unpaged answer, no row twice', async () => {
    for (let i = 0; i < 5; i++) await engine.create({ entity: 'tags', ownerId: A.id, body: { id: uuidv7(), name: `tag ${i}`, color: '#000000' } })
    const gone = { id: uuidv7(), name: 'gone', color: '#000000' }
    await engine.create({ entity: 'tags', ownerId: A.id, body: gone })
    await engine.remove({ entity: 'tags', id: gone.id, ownerId: A.id })

    const collect = async (query) => {
      const ids = []
      let after = null
      do {
        const page = await call(A, 'GET', `/tags?scope=all&limit=2${query}${after ? `&after=${after}` : ''}`)
        assert.ok(page.body.items.length <= 2)
        ids.push(...page.body.items.map((item) => item.id))
        after = page.body.next
      } while (after)
      return ids
    }

    for (const query of ['', '&since=1']) {
      const whole = await call(A, 'GET', `/tags?scope=all${query}`)
      assert.equal(whole.body.next, null, 'no limit means everything at once, as a pre-paging client expects')
      const paged = await collect(query)
      assert.deepEqual(paged, whole.body.items.map((item) => item.id))
      assert.equal(new Set(paged).size, paged.length)
    }
  })

  test('POST /sync/pull pages each entity on its own, listing only the ones with more', async () => {
    const whole = await call(A, 'POST', '/sync/pull', { cursors: { tags: null, accounts: null }, scope: 'all' })
    assert.deepEqual(whole.body.next, {})

    const seen = { tags: [], accounts: [] }
    let entities = ['tags', 'accounts']
    let after = {}
    let rounds = 0
    while (entities.length) {
      const { body } = await call(A, 'POST', '/sync/pull', {
        cursors: Object.fromEntries(entities.map((entity) => [entity, null])),
        after,
        limit: 3,
        scope: 'all',
      })
      for (const entity of entities) seen[entity].push(...body.entities[entity].map((item) => item.id))
      after = body.next
      entities = Object.keys(body.next)
      rounds += 1
    }
    assert.ok(rounds > 1)
    assert.deepEqual(seen.tags, whole.body.entities.tags.map((item) => item.id))
    assert.deepEqual(seen.accounts, whole.body.entities.accounts.map((item) => item.id))
  })

  test('a pull with nothing new costs two queries, however many entities it asks about', async () => {
    const entities = ['accounts', 'categories', 'tags', 'transactions', 'recurringTemplates', 'budgets', 'receipts']
    const future = Date.now() + 60_000
    const original = pg.query
    let queries = 0
    pg.query = (...args) => {
      queries += 1
      return original.apply(pg, args)
    }
    let body
    try {
      ;({ body } = await call(A, 'POST', '/sync/pull', { cursors: Object.fromEntries(entities.map((e) => [e, future])), scope: 'all' }))
    } finally {
      pg.query = original
    }
    assert.equal(queries, 2) // the cursor, and one "anything new?" for all of them
    assert.deepEqual(Object.keys(body.entities).sort(), [...entities].sort())
    for (const entity of entities) assert.deepEqual(body.entities[entity], [])
  })

  test('an entity with changes still comes down next to the quiet ones', async () => {
    const since = Date.now() - 1_000
    const tag = { id: uuidv7(), name: 'fresh', color: '#000000' }
    await engine.create({ entity: 'tags', ownerId: B.id, body: tag })
    const { body } = await call(A, 'POST', '/sync/pull', { cursors: { tags: since, receipts: Date.now() + 60_000 }, scope: 'all' })
    assert.ok(body.entities.tags.some((item) => item.id === tag.id))
    assert.deepEqual(body.entities.receipts, [])
  })

  test('a malformed page position is a 400, not a database error', async () => {
    const { status } = await call(A, 'GET', '/tags?scope=all&limit=2&after=nope')
    assert.equal(status, 400)
  })
})

describe('family restore', () => {
  test('brings tags and transaction tagIds back, and refuses a row owned by someone else', async () => {
    const { default: restoreFamilyBackup } = await import('#services/admin/restoreFamilyBackup')
    const oldOwnerId = uuidv7()
    const acc = { ...account(), ownerId: oldOwnerId, includeInTotal: true, archived: false, order: 0, initialBalance: 0 }
    const tag = { id: uuidv7(), ownerId: oldOwnerId, name: 'відпустка', color: '#00ff00' }
    const tx = { ...transaction(acc.id), ownerId: oldOwnerId, participantIds: [oldOwnerId], tagIds: [tag.id] }
    const payload = { version: 'family-1', users: [{ id: oldOwnerId, email: A.email }], accounts: [acc], tags: [tag], transactions: [tx] }

    const summary = await restoreFamilyBackup({ user: A, body: payload })
    assert.equal(summary.tags, 1)
    assert.equal((await row('tags', tag.id)).owner_id, A.id)
    assert.deepEqual((await row('transactions', tx.id)).tag_ids, [tag.id])

    const theirs = account()
    await engine.create({ entity: 'accounts', ownerId: B.id, body: theirs })
    const clash = { ...payload, accounts: [{ ...acc, id: theirs.id }], tags: [], transactions: [] }
    await assert.rejects(restoreFamilyBackup({ user: A, body: clash }), (error) => error.status === 409)
    assert.equal((await row('accounts', theirs.id)).owner_id, B.id)
  })
})
