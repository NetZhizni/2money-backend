import TransactionModel from '#sql/TransactionModel'
import AccountModel from '#sql/AccountModel'
import { uuidv7 } from '#util/uuid'
import { msToDate } from '#util/time'

/**
 * POST /api/transactions
 * `participant_ids` НЕ береться з клієнта (це керує видимістю запису для
 * інших користувачів) — сервер сам виводить його з власників account_id/
 * to_account_id, щоб клієнт не міг підсунути собі видимість чужих даних.
 */
const upsertTransaction = async (req) => {
  const b = req.body
  const ownerId = req.user.id

  const participantIds = [ownerId]
  if (b.toAccountId) {
    const toOwnerId = await AccountModel.getOwnerId({ id: b.toAccountId })
    if (toOwnerId && toOwnerId !== ownerId) participantIds.push(toOwnerId)
  }

  const transaction = await TransactionModel.upsert({
    id: b.id || uuidv7(),
    ownerId,
    participantIds,
    type: b.type,
    date: msToDate(b.date),
    accountId: b.accountId,
    toAccountId: b.toAccountId ?? null,
    categoryId: b.categoryId ?? null,
    subcategoryId: b.subcategoryId ?? null,
    amount: b.amount,
    toAmount: b.toAmount ?? null,
    currency: b.currency,
    note: b.note ?? null,
    templateId: b.templateId ?? null,
    receiptId: b.receiptId ?? null,
  })
  if (!transaction) {
    const error = new Error('Транзакція з таким id вже належить іншому користувачу')
    error.status = 409
    throw error
  }
  return transaction
}

export default upsertTransaction
