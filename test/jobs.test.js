import { describe, test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { startTestDatabase } from './helpers/database.js'

let database
let pg
let uuidv7
let purgeDeleted
let fetchRates
let nextRunAt
let baseUrl
let server

const A = { email: 'jobs-a@test.local' }
const DAY_MS = 24 * 60 * 60 * 1000

// The rates API stand-in (see rates.test.js): any dated file is served, `latest` as `latestDate`.
const realFetch = globalThis.fetch
const upstreamCalls = []
let latestDate = '2026-09-25'

async function call(method, path, body) {
  const response = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': A.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

async function exists(table, id) {
  return (await pg.query(`SELECT 1 FROM ${table} WHERE id = $1`, [id])).rowCount === 1
}

/** A transaction of A's, created through the API — `deletedDaysAgo` tombstones it that long ago. */
async function transaction(accountId, { deletedDaysAgo } = {}) {
  const tx = { id: uuidv7(), type: 'expense', date: Date.now(), accountId, amount: 10, currency: 'UAH' }
  const { body } = await call('POST', '/transactions/bulk', { items: [tx] })
  assert.equal(body.items[0].ok, true)
  if (deletedDaysAgo != null) {
    await pg.query(
      `UPDATE transactions SET deleted_at = now() - make_interval(days => $2), updated_at = now() - make_interval(days => $2) WHERE id = $1`,
      [tx.id, deletedDaysAgo],
    )
  }
  return tx
}

async function account() {
  const acc = { id: uuidv7(), name: 'Картка', type: 'regular', currency: 'UAH', icon: 'mdiCreditCard', color: '#123456' }
  await call('POST', '/accounts/bulk', { items: [acc] })
  return acc
}

before(async () => {
  database = await startTestDatabase()
  ;({ default: pg } = await import('#util/pg'))
  ;({ uuidv7 } = await import('#util/uuid'))
  ;({ purgeDeleted } = await import('../src/jobs/purgeDeleted.js'))
  ;({ fetchRates } = await import('../src/jobs/fetchRates.js'))
  ;({ nextRunAt } = await import('../src/jobs/scheduler.js'))
  const { default: UserModel } = await import('#sql/UserModel')
  const { mountSyncRoutes } = await import('#sync/router')
  const { default: errorMiddleware } = await import('#middleware/error')
  const { default: express } = await import('express')

  A.id = uuidv7()
  await UserModel.create({ id: A.id, email: A.email, displayName: A.email, color: '#000000', role: 'member' })

  globalThis.fetch = async (requested, init) => {
    const target = String(requested)
    if (!target.startsWith('https://')) return realFetch(requested, init)
    upstreamCalls.push(target)
    const date = target.match(/currency-api@([^/]+)\//)?.[1]
    if (!date) return new Response('not found', { status: 404 })
    return new Response(JSON.stringify({ date: date === 'latest' ? latestDate : date, usd: { usd: 1, uah: 42 } }))
  }

  // The real sync routes behind a stand-in for middleware/auth.js, as in sync.test.js.
  const app = express()
  app.use(express.json())
  app.use((req, res, next) => {
    req.user = req.headers['x-test-user'] === A.id ? A : undefined
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
  globalThis.fetch = realFetch
  if (server) await new Promise((resolve) => server.close(resolve))
  await database?.stop()
})

beforeEach(async () => {
  upstreamCalls.length = 0
  await pg.query(`DELETE FROM transactions`)
  await pg.query(`DELETE FROM sync_purges`)
  await pg.query(`DELETE FROM rate_snapshots`)
})

describe('purgeDeleted', () => {
  test('removes operations deleted more than 90 days ago, and records how far it reached', async () => {
    const acc = await account()
    const old = await transaction(acc.id, { deletedDaysAgo: 100 })
    const recent = await transaction(acc.id, { deletedDaysAgo: 10 })
    const live = await transaction(acc.id)

    assert.deepEqual(await purgeDeleted({ announceDelayMs: 0 }), { transactions: 1 })

    assert.equal(await exists('transactions', old.id), false)
    assert.equal(await exists('transactions', recent.id), true)
    assert.equal(await exists('transactions', live.id), true)
    const { rows } = await pg.query(`SELECT purged_through < now() - interval '99 days' AS old_enough FROM sync_purges WHERE entity = 'transactions'`)
    assert.equal(rows[0].old_enough, true)
  })

  test('records nothing when nothing is old enough', async () => {
    const acc = await account()
    await transaction(acc.id, { deletedDaysAgo: 10 })

    assert.deepEqual(await purgeDeleted({ announceDelayMs: 0 }), { transactions: 0 })
    assert.equal((await pg.query(`SELECT 1 FROM sync_purges`)).rowCount, 0)
  })

  test('never lowers the watermark', async () => {
    await pg.query(`INSERT INTO sync_purges (entity, purged_through) VALUES ('transactions', now() - interval '91 days')`)
    const acc = await account()
    await transaction(acc.id, { deletedDaysAgo: 200 })

    await purgeDeleted({ announceDelayMs: 0 })

    const { rows } = await pg.query(`SELECT purged_through > now() - interval '92 days' AS kept FROM sync_purges`)
    assert.equal(rows[0].kept, true)
  })

  test('leaves other entities’ tombstones alone', async () => {
    const acc = await account()
    await pg.query(`UPDATE accounts SET deleted_at = now() - interval '200 days' WHERE id = $1`, [acc.id])

    await purgeDeleted({ announceDelayMs: 0 })

    assert.equal(await exists('accounts', acc.id), true)
  })
})

describe('a cursor older than the purge', () => {
  test('gets the full list instead of a delta, flagged `full` — other entities keep their delta', async () => {
    const acc = await account()
    const cursor = Date.now() - 200 * DAY_MS
    await transaction(acc.id, { deletedDaysAgo: 100 })
    const recentlyDeleted = await transaction(acc.id, { deletedDaysAgo: 10 })
    const live = await transaction(acc.id)
    await purgeDeleted({ announceDelayMs: 0 })

    const { body } = await call('POST', '/sync/pull', { cursors: { transactions: cursor, accounts: cursor }, scope: 'all' })

    assert.deepEqual(body.full, ['transactions'])
    // Active rows only — a full list has no use for tombstones.
    assert.deepEqual(body.entities.transactions.map((tx) => tx.id), [live.id])
    assert.ok(!body.entities.transactions.some((tx) => tx.id === recentlyDeleted.id))
    assert.ok(body.entities.accounts.some((a) => a.id === acc.id)) // a delta, as before
  })

  test('is flagged on every page of a paged pull', async () => {
    const acc = await account()
    await transaction(acc.id, { deletedDaysAgo: 100 })
    await transaction(acc.id)
    await transaction(acc.id)
    await purgeDeleted({ announceDelayMs: 0 })
    const cursor = Date.now() - 200 * DAY_MS

    const first = await call('POST', '/sync/pull', { cursors: { transactions: cursor }, scope: 'all', limit: 1 })
    const second = await call('POST', '/sync/pull', {
      cursors: { transactions: cursor },
      after: first.body.next,
      scope: 'all',
      limit: 1,
    })

    assert.deepEqual(first.body.full, ['transactions'])
    assert.deepEqual(second.body.full, ['transactions'])
    assert.equal(first.body.entities.transactions.length + second.body.entities.transactions.length, 2)
  })

  test('the single-entity list is flagged too', async () => {
    const acc = await account()
    await transaction(acc.id, { deletedDaysAgo: 100 })
    await purgeDeleted({ announceDelayMs: 0 })

    const { body } = await call('GET', `/transactions?scope=all&since=${Date.now() - 200 * DAY_MS}`)
    assert.equal(body.full, true)
  })

  test('a cursor newer than the purge still gets a plain delta', async () => {
    const acc = await account()
    await transaction(acc.id, { deletedDaysAgo: 100 })
    await purgeDeleted({ announceDelayMs: 0 })
    const deleted = await transaction(acc.id, { deletedDaysAgo: 10 })

    const { body } = await call('POST', '/sync/pull', { cursors: { transactions: Date.now() - 50 * DAY_MS }, scope: 'all' })

    assert.equal(body.full, undefined)
    assert.deepEqual(body.entities.transactions.map((tx) => [tx.id, tx.deletedAt != null]), [[deleted.id, true]])
  })
})

describe('mustExist', () => {
  test('an edit of an operation that was purged is refused as deleted, not re-created', async () => {
    const acc = await account()
    const tx = await transaction(acc.id, { deletedDaysAgo: 100 })
    await purgeDeleted({ announceDelayMs: 0 })

    const { body } = await call('POST', '/transactions/bulk', { items: [{ ...tx, note: 'offline edit', mustExist: true }] })

    assert.deepEqual(body.items.map(({ ok, status, reason }) => ({ ok, status, reason })), [{ ok: false, status: 410, reason: 'deleted' }])
    assert.equal(await exists('transactions', tx.id), false)
  })

  test('without it (a new record, or an older client) the write goes through as before', async () => {
    const acc = await account()
    const tx = { id: uuidv7(), type: 'expense', date: Date.now(), accountId: acc.id, amount: 10, currency: 'UAH' }

    const { body } = await call('POST', '/transactions/bulk', { items: [tx] })

    assert.equal(body.items[0].ok, true)
  })

  test('an edit of a record that does exist is written normally', async () => {
    const acc = await account()
    const tx = await transaction(acc.id)

    const { body } = await call('POST', '/transactions/bulk', { items: [{ ...tx, note: 'edited', mustExist: true }] })

    assert.equal(body.items[0].ok, true)
    assert.equal((await pg.query(`SELECT note FROM transactions WHERE id = $1`, [tx.id])).rows[0].note, 'edited')
  })

  test('a creation and an edit of the same record in one batch still create it', async () => {
    const acc = await account()
    const tx = { id: uuidv7(), type: 'expense', date: Date.now(), accountId: acc.id, amount: 10, currency: 'UAH' }

    const { body } = await call('POST', '/transactions/bulk', { items: [tx, { ...tx, note: 'then edited', mustExist: true }] })

    assert.deepEqual(body.items.map((item) => item.ok), [true, true])
    assert.equal((await pg.query(`SELECT note FROM transactions WHERE id = $1`, [tx.id])).rows[0].note, 'then edited')
  })
})

describe('fetchRates', () => {
  const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10)

  test('stores the latest day, then fills missing history newest first', async () => {
    const yesterday = utcDay(Date.now() - DAY_MS)
    const twoDaysAgo = utcDay(Date.now() - 2 * DAY_MS)
    const threeDaysAgo = utcDay(Date.now() - 3 * DAY_MS)
    await pg.query(`INSERT INTO rate_snapshots (date, rates) VALUES ($1, '{"uah":41}')`, [twoDaysAgo])
    latestDate = utcDay(Date.now())

    const summary = await fetchRates({ maxBackfill: 2 })

    assert.deepEqual(summary, { latest: latestDate, backfilled: 2, unavailable: 0 })
    const stored = (await pg.query(`SELECT date::text AS date FROM rate_snapshots ORDER BY date DESC`)).rows.map((row) => row.date)
    assert.deepEqual(stored, [latestDate, yesterday, twoDaysAgo, threeDaysAgo])
    // The day already stored wasn't asked for again.
    assert.ok(!upstreamCalls.some((url) => url.includes(`@${twoDaysAgo}/`)))
  })
})

describe('nextRunAt', () => {
  const at = (iso) => Date.parse(iso)

  test('later today when a time is still ahead, else tomorrow', () => {
    assert.equal(nextRunAt(['03:00'], at('2026-09-25T01:00:00Z')), at('2026-09-25T03:00:00Z'))
    assert.equal(nextRunAt(['03:00'], at('2026-09-25T03:00:00Z')), at('2026-09-26T03:00:00Z'))
    assert.equal(nextRunAt(['03:00'], at('2026-12-31T23:00:00Z')), at('2027-01-01T03:00:00Z'))
  })

  test('the soonest of several times', () => {
    assert.equal(nextRunAt(['00:20', '12:20'], at('2026-09-25T06:00:00Z')), at('2026-09-25T12:20:00Z'))
    assert.equal(nextRunAt(['00:20', '12:20'], at('2026-09-25T13:00:00Z')), at('2026-09-26T00:20:00Z'))
  })
})
