import CategoryModel from '#sql/CategoryModel'
import TransactionModel from '#sql/TransactionModel'

/**
 * PATCH /api/categories/:id. Не використовується фронтендом сьогодні
 * (offline-first outbox завжди йде через POST-апсерт — див.
 * upsertCategory.js), лишається заради узгодженого API — тож той самий захист
 * від зміни валюти після появи операцій діє і тут.
 */
const patchCategory = async (req) => {
  const b = req.body
  const id = req.params.id

  if (b.currency !== undefined) {
    const existingCurrency = await CategoryModel.getCurrency({ id })
    if (existingCurrency && existingCurrency !== b.currency && (await TransactionModel.existsForCategory({ categoryId: id }))) {
      const error = new Error('Неможливо змінити валюту категорії — по ній вже є операції')
      error.status = 400
      throw error
    }
  }

  const category = await CategoryModel.patch({
    id,
    ownerId: req.user.id,
    name: b.name,
    kind: b.kind,
    icon: b.icon,
    color: b.color,
    parent_id: b.parentId,
    archived: b.archived,
    order: b.order,
    is_default: b.isDefault,
    currency: b.currency,
    currency_display: b.currencyDisplay,
  })
  if (!category) {
    const error = new Error('Категорію не знайдено')
    error.status = 404
    throw error
  }
  return category
}

export default patchCategory
