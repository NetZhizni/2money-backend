import ReceiptModel from '#sql/ReceiptModel'
import { msToDate } from '#util/time'

const patchReceipt = async (req) => {
  const b = req.body
  const receipt = await ReceiptModel.patch({
    id: req.params.id,
    ownerId: req.user.id,
    merchant: b.merchant,
    date: 'date' in b ? msToDate(b.date) : undefined,
    currency: b.currency,
    note: b.note,
    account_id: b.accountId,
  })
  if (!receipt) {
    const error = new Error('Чек не знайдено')
    error.status = 404
    throw error
  }
  return receipt
}

export default patchReceipt
