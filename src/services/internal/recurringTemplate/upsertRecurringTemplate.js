import RecurringTemplateModel from '#sql/RecurringTemplateModel'
import { uuidv7 } from '#util/uuid'
import { msToDate } from '#util/time'

const upsertRecurringTemplate = async (req) => {
  const b = req.body
  const template = await RecurringTemplateModel.upsert({
    id: b.id || uuidv7(),
    ownerId: req.user.id,
    type: b.type,
    accountId: b.accountId,
    toAccountId: b.toAccountId ?? null,
    categoryId: b.categoryId ?? null,
    subcategoryId: b.subcategoryId ?? null,
    amount: b.amount,
    currency: b.currency,
    note: b.note ?? null,
    frequency: b.frequency,
    interval: b.interval,
    startDate: msToDate(b.startDate),
    endDate: msToDate(b.endDate),
    nextDate: msToDate(b.nextDate),
    active: b.active,
  })
  if (!template) {
    const error = new Error('Шаблон з таким id вже належить іншому користувачу')
    error.status = 409
    throw error
  }
  return template
}

export default upsertRecurringTemplate
