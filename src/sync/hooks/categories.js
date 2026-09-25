import pg from '#util/pg'
import { isUuid } from '#util/uuid'
import { baseCurrencyOf, currentCurrencies, idsWithOperations, currencyLockedError, refuseInUse } from './lookups.js'

const CATEGORY_REFS = ['category_id', 'subcategory_id']
const LOCKED_MESSAGE = 'Неможливо змінити валюту категорії — по ній вже є операції'
const IN_USE_MESSAGE = 'Неможливо видалити категорію — по ній є операції. Її можна архівувати або об’єднати з іншою'

/** category id -> the currency most of its existing operations are in, for the ones that have any. */
async function dominantCurrencies(ids) {
  const valid = ids.filter(isUuid)
  if (!valid.length) return new Map()
  const { rows } = await pg.query(
    `SELECT DISTINCT ON (category_id) category_id, currency
     FROM transactions
     WHERE category_id = ANY($1::uuid[]) AND deleted_at IS NULL
     GROUP BY category_id, currency
     ORDER BY category_id, COUNT(*) DESC`,
    [valid],
  )
  return new Map(rows.map((row) => [row.category_id, row.currency]))
}

/**
 * Resolves every category's currency for the whole batch at once, and which
 * of them that would change despite operations already being filed under it
 * (same rule as the accounts hook — see lookups.js's currencyLockedError).
 *
 * Subcategories never carry their own currency — they inherit the parent's,
 * so storing one would just be a second source of truth to drift. A
 * top-level category with no currency of its own (an older record, or a
 * client that didn't send one) adopts the currency most of its existing
 * operations are already in, and only falls back to the owner's base
 * currency when there's nothing to infer from.
 */
async function prepare({ items, ownerId }) {
  const missing = items.filter((body) => !body.parentId && !body.currency).map((body) => body.id)
  const dominant = await dominantCurrencies(missing)
  const baseCurrency = missing.some((id) => !dominant.has(id)) ? await baseCurrencyOf(ownerId) : undefined
  const resolveCurrency = (body) => (body.parentId ? null : body.currency || dominant.get(body.id) || baseCurrency)

  // Categories are shared across the family, so no owner filter here.
  const current = await currentCurrencies('categories', items.map((body) => body.id))
  const changing = items.filter((body) => current.get(body.id) && current.get(body.id) !== resolveCurrency(body)).map((body) => body.id)
  const locked = await idsWithOperations(changing, CATEGORY_REFS)
  return { resolveCurrency, locked }
}

export default {
  prepare,

  beforeCreate({ id, body, ctx }) {
    if (ctx.locked.has(id)) throw currencyLockedError(LOCKED_MESSAGE)
    return {
      ...body,
      currency: ctx.resolveCurrency(body),
      currencyDisplay: body.parentId ? null : (body.currencyDisplay ?? null),
    }
  },

  // Anyone's operation filed under it (as its category or subcategory) keeps
  // a category from being deleted — see lookups.js's inUseError. Categories
  // are shared, so that's every member's operations, not just the caller's.
  beforeRemove: refuseInUse(CATEGORY_REFS, IN_USE_MESSAGE),
}
