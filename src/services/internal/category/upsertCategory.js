import CategoryModel from '#sql/CategoryModel'
import TransactionModel from '#sql/TransactionModel'
import AppSettingsModel from '#sql/AppSettingsModel'
import { uuidv7 } from '#util/uuid'

/**
 * POST /api/categories — створення/ідемпотентний replay з outbox.
 *
 * Валюта категорії: лише верхньорівнева категорія її має (підкатегорія
 * завжди успадковує батьківську — це вирішує сам клієнт, надсилаючи `null`,
 * див. CategoryFormModal.vue). Коли верхньорівнева категорія її не надіслала
 * (типово — категорія, заведена ще до того, як валюта стала обов'язковою),
 * підставляємо НАЙПОШИРЕНІШУ валюту серед уже заведених по ній операцій, а не
 * сліпо базову валюту власника — інакше категорія, по якій завжди були лише
 * операції в USD, мовчки стала б "базовою валютою" і перетворила б кожну
 * наступну USD-операцію на фейковий крос-валютний випадок. Лише за
 * відсутності будь-якої історії (справді нова категорія) фолбечимо на базову
 * валюту — так само, як для рахунків.
 */
const upsertCategory = async (req) => {
  const b = req.body
  const ownerId = req.user.id
  const id = b.id || uuidv7()

  let currency = b.parentId ? null : b.currency
  if (!b.parentId && !currency) {
    currency = await TransactionModel.getDominantCurrencyForCategory({ categoryId: id })
    if (!currency) {
      const settings = await AppSettingsModel.getByUserId({ userId: ownerId })
      currency = settings?.base_currency ?? 'UAH'
    }
  }

  if (b.id) {
    const existingCurrency = await CategoryModel.getCurrency({ id: b.id })
    if (existingCurrency && existingCurrency !== currency && (await TransactionModel.existsForCategory({ categoryId: b.id }))) {
      const error = new Error('Неможливо змінити валюту категорії — по ній вже є операції')
      error.status = 400
      throw error
    }
  }

  const category = await CategoryModel.upsert({
    id,
    ownerId,
    name: b.name,
    kind: b.kind,
    icon: b.icon,
    color: b.color,
    parentId: b.parentId ?? null,
    archived: b.archived,
    order: b.order,
    isDefault: b.isDefault,
    currency,
    // Only a top-level category carries its own display override either —
    // same rule, and same reason, as `currency` above.
    currencyDisplay: b.parentId ? null : (b.currencyDisplay ?? null),
  })
  if (!category) {
    const error = new Error('Категорія з таким id вже належить іншому користувачу')
    error.status = 409
    throw error
  }
  return category
}

export default upsertCategory
