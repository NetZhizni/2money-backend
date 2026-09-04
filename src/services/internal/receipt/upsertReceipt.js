import ReceiptModel from '#sql/ReceiptModel'
import { uuidv7 } from '#util/uuid'
import { msToDate } from '#util/time'

/** POST /api/receipts — створює/оновлює лише метадані чека (merchant/date/currency), клієнт сам генерує id. */
const upsertReceipt = async (req) => {
  const b = req.body
  const receipt = await ReceiptModel.upsert({
    id: b.id || uuidv7(),
    ownerId: req.user.id,
    merchant: b.merchant ?? null,
    date: msToDate(b.date),
    currency: b.currency ?? null,
    note: b.note ?? null,
    accountId: b.accountId ?? null,
  })
  if (!receipt) {
    const error = new Error('Чек з таким id вже належить іншому користувачу')
    error.status = 409
    throw error
  }
  return receipt
}

export default upsertReceipt
