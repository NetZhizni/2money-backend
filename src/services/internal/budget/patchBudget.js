import BudgetModel from '#sql/BudgetModel'

const patchBudget = async (req) => {
  const b = req.body
  const budget = await BudgetModel.patch({
    id: req.params.id,
    ownerId: req.user.id,
    category_id: b.categoryId,
    amount: b.amount,
    currency: b.currency,
    period: b.period,
  })
  if (!budget) {
    const error = new Error('Бюджет не знайдено')
    error.status = 404
    throw error
  }
  return budget
}

export default patchBudget
