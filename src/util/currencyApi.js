/**
 * fawazahmed0/currency-api (github.com/fawazahmed0/exchange-api) — a free,
 * no-key, no-rate-limit set of static JSON files, one per base currency per
 * day. Only the USD file is ever used here: it quotes every other currency
 * against USD, and any pair can be derived from it (the frontend's
 * db/exchangeRates.ts crossRate), so one file per day covers every base
 * currency. Served from jsDelivr, with the same files mirrored on
 * Cloudflare Pages as the documented fallback.
 */

/** The API's history starts here — nothing older exists to download. */
export const FIRST_AVAILABLE_DATE = '2024-03-02'

const PIVOT = 'usd'
const TIMEOUT_MS = 10_000
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** A real calendar day in YYYY-MM-DD form (rejects e.g. 2025-02-30). */
export function isDateKey(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function snapshotUrls(apiDate) {
  const file = `v1/currencies/${PIVOT}.min.json`
  return [
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${apiDate}/${file}`,
    `https://${apiDate}.currency-api.pages.dev/${file}`,
  ]
}

/** Only the entries that are actually usable rates — it's third-party data about to be stored for good. */
function usableRates(rates) {
  const result = {}
  for (const [code, value] of Object.entries(rates)) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) result[code] = value
  }
  return result
}

/**
 * Downloads the snapshot for `apiDate` (YYYY-MM-DD, or `latest`), trying
 * each mirror in turn, along with the day the API says it's for — for
 * `latest`, whichever day was last published. Null when no mirror has it.
 * @returns {Promise<{ date: string, rates: Record<string, number> } | null>}
 */
export async function downloadSnapshot(apiDate) {
  for (const url of snapshotUrls(apiDate)) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (!response.ok) continue
      const data = await response.json()
      const rates = data?.[PIVOT]
      if (!rates || typeof rates !== 'object' || Array.isArray(rates) || !isDateKey(data.date)) continue
      return { date: data.date, rates: usableRates(rates) }
    } catch {
      // Network error or timeout — try the next mirror.
    }
  }
  return null
}
