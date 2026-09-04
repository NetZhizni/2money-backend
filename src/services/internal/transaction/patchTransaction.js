import TransactionModel from '#sql/TransactionModel'
import AccountModel from '#sql/AccountModel'
import { msToDate } from '#util/time'

/** PATCH /api/transactions/:id — той самий перерахунок participant_ids при зміні to_account_id. */
const patchTransaction = async (req) => {
  const b = req.body
  const ownerId = req.user.id

  let participantIds
  if ('toAccountId' in b) {
    participantIds = [ownerId]
    if (b.toAccountId) {
      const toOwnerId = await AccountModel.getOwnerId({ id: b.toAccountId })
      if (toOwnerId && toOwnerId !== ownerId) participantIds.push(toOwnerId)
    }
  }

  const transaction = await TransactionModel.patch({
    id: req.params.id,
    ownerId,
    participant_ids: participantIds,
    type: b.type,
    date: 'date' in b ? msToDate(b.date) : undefined,
    account_id: b.accountId,
    to_account_id: b.toAccountId,
    category_id: b.categoryId,
    subcategory_id: b.subcategoryId,
    amount: b.amount,
    to_amount: b.toAmount,
    currency: b.currency,
    note: b.note,
    template_id: b.templateId,
    receipt_id: b.receiptId,
  })
  if (!transaction) {
    const error = new Error('Транзакцію не знайдено')
    error.status = 404
    throw error
  }
  return transaction
}

export default patchTransaction
