import ReceiptModel from '#sql/ReceiptModel'

/** DELETE /api/receipts/:id — soft delete чека; транзакції, що на нього посилались, лишаються (receipt_id -> NULL при реальному видаленні рядка). */
const removeReceipt = async (req) => {
  const removed = await ReceiptModel.remove({ id: req.params.id, ownerId: req.user.id })
  if (!removed) {
    const error = new Error('Чек не знайдено')
    error.status = 404
    throw error
  }
  return { removed: true }
}

export default removeReceipt
