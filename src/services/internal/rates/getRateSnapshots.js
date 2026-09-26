import RateSnapshotModel from '#sql/RateSnapshotModel'
import { downloadSnapshot, FIRST_AVAILABLE_DATE, isDateKey } from '#util/currencyApi'

/** Per request — the frontend asks in batches well under this (see its db/exchangeRates.ts). */
const MAX_DATES = 400
/** A year of statistics can miss a few hundred days at once — this many downloads run at a time, the rest queue. */
const MAX_CONCURRENT_DOWNLOADS = 8
/**
 * How long a request waits on days still downloading. Whatever isn't in by
 * then keeps downloading (and gets stored) in the background — the caller
 * gets what's ready and fetches the rest straight from the API itself, so a
 * slow upstream never turns into a slow or failing response here.
 */
const RESPONSE_BUDGET_MS = 15_000
/** "latest" moves once a day; re-asking the API for it more often than this is pointless. */
const LATEST_TTL_MS = 60 * 60 * 1000

let activeDownloads = 0
const waitingDownloads = []

async function withDownloadSlot(task) {
  if (activeDownloads < MAX_CONCURRENT_DOWNLOADS) activeDownloads++
  else await new Promise((resolve) => waitingDownloads.push(resolve)) // the finishing task hands its slot straight over
  try {
    return await task()
  } finally {
    const next = waitingDownloads.shift()
    if (next) next()
    else activeDownloads--
  }
}

// One download per missing day at a time, however many requests want it.
const pendingDays = new Map()

/**
 * Downloads day `date` (YYYY-MM-DD) and stores it; resolves to its rates, or
 * null when the API doesn't have that day (or can't be reached). Also what
 * jobs/fetchRates.js fills gaps in the history with.
 */
export function storeDay(date) {
  let pending = pendingDays.get(date)
  if (!pending) {
    pending = withDownloadSlot(() => downloadSnapshot(date))
      .then(async (downloaded) => {
        if (!downloaded || downloaded.date !== date) return null
        await RateSnapshotModel.insert(downloaded)
        return downloaded.rates
      })
      .catch(() => null)
      .finally(() => pendingDays.delete(date))
    pendingDays.set(date, pending)
  }
  return pending
}

/** Stored days first; the rest downloaded (and stored) within RESPONSE_BUDGET_MS. */
async function snapshotsFor(dates) {
  const found = new Map((await RateSnapshotModel.getMany({ dates })).map((row) => [row.date, row.rates]))
  const missing = dates.filter((date) => !found.has(date))
  if (missing.length) {
    let timer
    const budget = new Promise((resolve) => {
      timer = setTimeout(resolve, RESPONSE_BUDGET_MS)
    })
    const downloads = Promise.all(
      missing.map(async (date) => {
        const rates = await storeDay(date)
        if (rates) found.set(date, rates)
      }),
    )
    await Promise.race([downloads, budget])
    clearTimeout(timer)
  }
  return dates.filter((date) => found.has(date)).map((date) => ({ date, rates: found.get(date) }))
}

let latestCache = null
let latestPending = null

/**
 * Downloads the API's most recently published day and stores it under the
 * day it's for, like any other; null when the API can't be reached. What
 * latestSnapshot below refreshes with, and jobs/fetchRates.js runs daily.
 */
export async function refreshLatest() {
  const downloaded = await withDownloadSlot(() => downloadSnapshot('latest'))
  if (!downloaded) return null
  await RateSnapshotModel.insert(downloaded)
  latestCache = { at: Date.now(), snapshot: downloaded }
  return downloaded
}

/**
 * The API's most recently published day (see refreshLatest), re-asked for at
 * most every LATEST_TTL_MS — or, when the API can't be reached, the newest
 * day already stored here, which is the best "today" there is.
 */
function latestSnapshot() {
  if (latestCache && Date.now() - latestCache.at < LATEST_TTL_MS) return Promise.resolve(latestCache.snapshot)
  if (!latestPending) {
    latestPending = (async () => (await refreshLatest()) ?? (await RateSnapshotModel.newest()) ?? null)()
      .catch(() => null)
      .finally(() => {
        latestPending = null
      })
  }
  return latestPending
}

/** Forgets the cached "latest" — for tests. */
export function clearLatestCache() {
  latestCache = null
}

/** A day the API can have: a real date, no earlier than its history, no later than tomorrow in UTC (a client far east of UTC may already be there). */
function isServableDate(value) {
  if (!isDateKey(value) || value < FIRST_AVAILABLE_DATE) return false
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  return value <= tomorrow
}

/**
 * POST /api/rates/snapshots — { dates?: string[], latest?: boolean }.
 *
 * Read-through cache of the daily USD exchange-rate snapshots the
 * frontend's statistics convert at (see its db/exchangeRates.ts): every
 * requested day that's stored is answered from the database, the rest are
 * downloaded from the rates API by this server — never uploaded by a
 * client, so no one device's bad data can end up shared by the family.
 * `latest: true` additionally returns today's rates (see latestSnapshot).
 *
 * Days that can't be had right now are simply left out, and upstream
 * trouble never fails the request: the frontend fetches whatever's
 * missing straight from the API itself, same as it does with no server.
 */
const getRateSnapshots = async (req) => {
  const { dates = [], latest = false } = req.body ?? {}
  if (!Array.isArray(dates) || dates.length > MAX_DATES) {
    const error = new Error(`dates must be an array of at most ${MAX_DATES} YYYY-MM-DD strings`)
    error.status = 400
    throw error
  }
  const wanted = [...new Set(dates.filter(isServableDate))]
  const [snapshots, latestResult] = await Promise.all([snapshotsFor(wanted), latest === true ? latestSnapshot() : null])
  return { snapshots, latest: latestResult }
}

export default getRateSnapshots
