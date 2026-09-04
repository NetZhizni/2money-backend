import ReceiptModel from '#sql/ReceiptModel'
import { parseSince } from '#util/time'

/**
 * GET /api/receipts
 * За замовчуванням — власні чеки (активні, або дельта за `?since=`).
 * `?scope=all` — чеки всієї родини, так само активні-тільки або дельта за
 * `?since=` — свій курсор, окремий від курсора власних чеків. Той самий
 * контракт, що й listTransactions/listBudgets.
 */
const listReceipts = async (req) => {
  const { scope } = req.query
  const syncedAt = Date.now()
  const since = parseSince(req.query.since)
  const items = scope === 'all' ? await ReceiptModel.listAll({ since }) : await ReceiptModel.listForOwner({ ownerId: req.user.id, since })
  return { items, syncedAt }
}

export default listReceipts
