import BudgetModel from '#sql/BudgetModel'
import { parseSince } from '#util/time'

const listBudgets = async (req) => {
  const syncedAt = Date.now()
  const items = await BudgetModel.listForOwner({ ownerId: req.user.id, since: parseSince(req.query.since) })
  return { items, syncedAt }
}

export default listBudgets
