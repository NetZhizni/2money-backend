import pg from '#util/pg'
import { baseCurrencyOf, currentCurrencies, idsWithOperations, currencyLockedError, refuseInUse } from './lookups.js'

const ACCOUNT_REFS = ['account_id', 'to_account_id']
const LOCKED_MESSAGE = 'Неможливо змінити валюту рахунку — по ньому вже є операції'
const IN_USE_MESSAGE = 'Неможливо видалити рахунок — по ньому є операції. Його можна архівувати або об’єднати з іншим'

/**
 * Everything beforeCreate needs, for the whole batch at once: the owner's
 * base currency (the fallback for an account sent without one), and which of
 * the batch's accounts would change currency despite already having
 * operations — allowed only while an account has none at all (see
 * lookups.js's currencyLockedError).
 */
async function prepare({ items, ownerId }) {
  const baseCurrency = items.some((body) => !body.currency) ? await baseCurrencyOf(ownerId) : undefined
  const resolveCurrency = (body) => body.currency || baseCurrency

  const current = await currentCurrencies('accounts', items.map((body) => body.id), ownerId)
  const changing = items.filter((body) => current.get(body.id) && current.get(body.id) !== resolveCurrency(body)).map((body) => body.id)
  const locked = await idsWithOperations(changing, ACCOUNT_REFS)
  return { resolveCurrency, locked }
}

export default {
  prepare,

  beforeCreate({ id, body, ctx }) {
    if (ctx.locked.has(id)) throw currencyLockedError(LOCKED_MESSAGE)
    return { ...body, currency: ctx.resolveCurrency(body) }
  },

  // Anyone's operation on either side of it keeps an account from being
  // deleted — see lookups.js's inUseError. Taking them along instead would
  // rewrite the balance of every account a transfer ever touched, another
  // member's included.
  beforeRemove: refuseInUse(ACCOUNT_REFS, IN_USE_MESSAGE),

  // Deleting an account tombstones every recurring template on either side of
  // it, whoever owns it: a template only makes future operations, and every
  // one of those would now be refused (see engine.js's refuseDeletedRefs) —
  // left alone, it would fail again each time it's due. Done here rather than
  // by an FK cascade so the removals are soft, and therefore visible to an
  // offline client's next delta pull — see engine.js's doc comment. Runs
  // inside the delete's own transaction (see engine.removeMany), so the two
  // can't come apart. The frontend applies the same cascade locally the
  // moment the delete is made (its db/sync/registry.ts DELETE_CASCADES) —
  // keep the two in step.
  async afterRemove({ ids }) {
    await pg.query(
      `UPDATE recurring_templates SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE deleted_at IS NULL AND (account_id = ANY($1::uuid[]) OR to_account_id = ANY($1::uuid[]))`,
      [ids],
    )
  },
}
