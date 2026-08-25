import BudgetModel from '#sql/BudgetModel'

const removeBudget = async (req) => {
  const removed = await BudgetModel.remove({ id: req.params.id, ownerId: req.user.id })
  if (!removed) {
    const error = new Error('Бюджет не знайдено')
    error.status = 404
    throw error
  }
  return { removed: true }
}

export default removeBudget
