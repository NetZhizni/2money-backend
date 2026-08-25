import TransactionModel from '#sql/TransactionModel'

/** DELETE /api/transactions/:id — soft delete, лише власник (не контрагент переказу). */
const removeTransaction = async (req) => {
  const removed = await TransactionModel.remove({ id: req.params.id, ownerId: req.user.id })
  if (!removed) {
    const error = new Error('Транзакцію не знайдено')
    error.status = 404
    throw error
  }
  return { removed: true }
}

export default removeTransaction
