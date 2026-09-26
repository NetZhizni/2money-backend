import { describe, test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { startTestDatabase } from './helpers/database.js'

let database
let pg
let clearLatestCache
let baseUrl
let server

// The rates API stand-in: `upstream[url]` is served as that file's JSON (an
// Error is thrown as a network failure), anything else is a 404. Requests
// to the app itself still go through the real fetch.
const realFetch = globalThis.fetch
let upstream = {}
const upstreamCalls = []

const url = (date) => `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1/currencies/usd.min.json`
const mirrorUrl = (date) => `https://${date}.currency-api.pages.dev/v1/currencies/usd.min.json`
const file = (date, usd = { usd: 1, uah: 42 }) => ({ date, usd })

async function ask(body) {
  const response = await realFetch(`${baseUrl}/snapshots`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

async function storedDates() {
  return (await pg.query(`SELECT date::text AS date FROM rate_snapshots ORDER BY date`)).rows.map((row) => row.date)
}

before(async () => {
  database = await startTestDatabase()
  ;({ default: pg } = await import('#util/pg'))
  ;({ clearLatestCache } = await import('#services/rates/getRateSnapshots'))
  const { default: ratesRouter } = await import('../src/routers/rates.js')
  const { default: errorMiddleware } = await import('#middleware/error')
  const { default: express } = await import('express')

  globalThis.fetch = async (requested, init) => {
    const target = String(requested)
    if (!target.startsWith('https://')) return realFetch(requested, init)
    upstreamCalls.push(target)
    const body = upstream[target]
    if (body instanceof Error) throw body
    return body ? new Response(JSON.stringify(body)) : new Response('not found', { status: 404 })
  }

  // Mounted without middleware/auth.js (which needs a Firebase token) — in
  // the real app the rates router sits behind it like every other route.
  const app = express()
  app.use(express.json())
  app.use('/api/rates', ratesRouter)
  app.use(errorMiddleware)
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve)
  })
  baseUrl = `http://127.0.0.1:${server.address().port}/api/rates`
})

after(async () => {
  globalThis.fetch = realFetch
  if (server) await new Promise((resolve) => server.close(resolve))
  await database?.stop()
})

beforeEach(async () => {
  upstream = {}
  upstreamCalls.length = 0
  clearLatestCache()
  await pg.query(`DELETE FROM rate_snapshots`)
})

describe('POST /api/rates/snapshots', () => {
  test('a stored day is served from the database without touching the API', async () => {
    await pg.query(`INSERT INTO rate_snapshots (date, rates) VALUES ('2025-01-15', '{"usd":1,"uah":42}')`)

    const { status, body } = await ask({ dates: ['2025-01-15'] })

    assert.equal(status, 200)
    assert.deepEqual(body.snapshots, [{ date: '2025-01-15', rates: { usd: 1, uah: 42 } }])
    assert.equal(body.latest, null)
    assert.equal(upstreamCalls.length, 0)
  })

  test('a missing day is downloaded once, stored, and served from the database after that', async () => {
    upstream[url('2025-01-15')] = file('2025-01-15')

    const first = await ask({ dates: ['2025-01-15'] })
    const second = await ask({ dates: ['2025-01-15'] })

    assert.deepEqual(first.body.snapshots, [{ date: '2025-01-15', rates: { usd: 1, uah: 42 } }])
    assert.deepEqual(second.body.snapshots, first.body.snapshots)
    assert.deepEqual(upstreamCalls, [url('2025-01-15')])
    assert.deepEqual(await storedDates(), ['2025-01-15'])
  })

  test('falls back to the Cloudflare mirror when jsDelivr fails', async () => {
    upstream[url('2025-01-15')] = new TypeError('fetch failed')
    upstream[mirrorUrl('2025-01-15')] = file('2025-01-15')

    const { body } = await ask({ dates: ['2025-01-15'] })

    assert.equal(body.snapshots.length, 1)
    assert.deepEqual(upstreamCalls, [url('2025-01-15'), mirrorUrl('2025-01-15')])
  })

  test('a day the API can’t provide is left out — the request itself still succeeds', async () => {
    upstream[url('2025-01-15')] = file('2025-01-15')

    const { status, body } = await ask({ dates: ['2025-01-15', '2025-01-16'] })

    assert.equal(status, 200)
    assert.deepEqual(body.snapshots.map((s) => s.date), ['2025-01-15'])
    assert.deepEqual(await storedDates(), ['2025-01-15'])
  })

  test('concurrent requests for the same missing day download it once', async () => {
    upstream[url('2025-01-15')] = file('2025-01-15')

    const results = await Promise.all([ask({ dates: ['2025-01-15'] }), ask({ dates: ['2025-01-15'] })])

    assert.ok(results.every((r) => r.body.snapshots.length === 1))
    assert.equal(upstreamCalls.length, 1)
  })

  test('only usable rate values are stored', async () => {
    upstream[url('2025-01-15')] = file('2025-01-15', { usd: 1, uah: 42, bad: -3, zero: 0, text: 'x', nan: null })

    const { body } = await ask({ dates: ['2025-01-15'] })

    assert.deepEqual(body.snapshots[0].rates, { usd: 1, uah: 42 })
  })

  test('ignores malformed, pre-history and far-future dates; too many is a 400', async () => {
    const farFuture = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    const { status, body } = await ask({ dates: ['2025-02-30', 'yesterday', '2023-06-01', farFuture, 42] })
    assert.equal(status, 200)
    assert.deepEqual(body.snapshots, [])
    assert.equal(upstreamCalls.length, 0)

    const tooMany = await ask({ dates: Array.from({ length: 401 }, () => '2025-01-15') })
    assert.equal(tooMany.status, 400)
    assert.equal((await ask({ dates: 'nope' })).status, 400)
  })
})

describe('latest', () => {
  test('is downloaded, stored under the day the API says it’s for, and cached', async () => {
    upstream[url('latest')] = file('2026-09-24', { usd: 1, uah: 44 })

    const first = await ask({ latest: true })
    const second = await ask({ latest: true })

    assert.deepEqual(first.body.latest, { date: '2026-09-24', rates: { usd: 1, uah: 44 } })
    assert.deepEqual(second.body.latest, first.body.latest)
    assert.deepEqual(upstreamCalls, [url('latest')])
    assert.deepEqual(await storedDates(), ['2026-09-24'])
  })

  test('falls back to the newest stored day when the API can’t be reached', async () => {
    await pg.query(
      `INSERT INTO rate_snapshots (date, rates) VALUES ('2026-09-20', '{"uah":43}'), ('2026-09-22', '{"uah":44}')`,
    )

    const { status, body } = await ask({ latest: true })

    assert.equal(status, 200)
    assert.deepEqual(body.latest, { date: '2026-09-22', rates: { uah: 44 } })
  })

  test('comes back alongside the requested days', async () => {
    upstream[url('latest')] = file('2026-09-24', { usd: 1, uah: 44 })
    upstream[url('2025-01-15')] = file('2025-01-15')

    const { body } = await ask({ dates: ['2025-01-15'], latest: true })

    assert.equal(body.snapshots.length, 1)
    assert.equal(body.latest.date, '2026-09-24')
  })
})
