import BudgetModel from '#sql/BudgetModel'
import { parseSince } from '#util/time'

/**
 * GET /api/budgets
 * За замовчуванням — власні бюджети (активні, або дельта за `?since=`).
 * `?scope=all` — бюджети всієї родини (сімейний бюджет), так само
 * активні-тільки або дельта за `?since=` — свій курсор, окремий від
 * курсора власних бюджетів.
 */
const listBudgets = async (req) => {
  const { scope } = req.query
  const syncedAt = Date.now()
  const since = parseSince(req.query.since)
  const items = scope === 'all' ? await BudgetModel.listAll({ since }) : await BudgetModel.listForOwner({ ownerId: req.user.id, since })
  return { items, syncedAt }
}

export default listBudgets
