import AccountModel from '#sql/AccountModel'
import TransactionModel from '#sql/TransactionModel'

/**
 * DELETE /api/accounts/:id — soft delete + каскадне приховання всіх
 * транзакцій, що торкались цього рахунку (як remove() у FinTrack accounts store).
 */
const removeAccount = async (req) => {
  const ownerId = req.user.id
  const id = req.params.id
  const removed = await AccountModel.remove({ id, ownerId })
  if (!removed) {
    const error = new Error('Рахунок не знайдено')
    error.status = 404
    throw error
  }
  await TransactionModel.removeByAccount({ ownerId, accountId: id })
  return { removed: true }
}

export default removeAccount
