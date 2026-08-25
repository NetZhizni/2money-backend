import BudgetModel from '#sql/BudgetModel'
import { uuidv7 } from '#util/uuid'

const upsertBudget = async (req) => {
  const b = req.body
  const budget = await BudgetModel.upsert({
    id: b.id || uuidv7(),
    ownerId: req.user.id,
    categoryId: b.categoryId,
    amount: b.amount,
    currency: b.currency,
    period: b.period,
  })
  if (!budget) {
    const error = new Error('Бюджет з таким id вже належить іншому користувачу')
    error.status = 409
    throw error
  }
  return budget
}

export default upsertBudget
