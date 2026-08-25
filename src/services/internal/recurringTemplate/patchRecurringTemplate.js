import RecurringTemplateModel from '#sql/RecurringTemplateModel'
import { msToDate } from '#util/time'

const patchRecurringTemplate = async (req) => {
  const b = req.body
  const template = await RecurringTemplateModel.patch({
    id: req.params.id,
    ownerId: req.user.id,
    type: b.type,
    account_id: b.accountId,
    to_account_id: b.toAccountId,
    category_id: b.categoryId,
    subcategory_id: b.subcategoryId,
    amount: b.amount,
    currency: b.currency,
    note: b.note,
    frequency: b.frequency,
    interval: b.interval,
    start_date: 'startDate' in b ? msToDate(b.startDate) : undefined,
    end_date: 'endDate' in b ? msToDate(b.endDate) : undefined,
    next_date: 'nextDate' in b ? msToDate(b.nextDate) : undefined,
    active: b.active,
  })
  if (!template) {
    const error = new Error('Шаблон не знайдено')
    error.status = 404
    throw error
  }
  return template
}

export default patchRecurringTemplate
