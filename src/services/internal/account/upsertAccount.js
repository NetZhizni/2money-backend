import AccountModel from '#sql/AccountModel'
import TransactionModel from '#sql/TransactionModel'
import AppSettingsModel from '#sql/AppSettingsModel'
import { uuidv7 } from '#util/uuid'

/**
 * POST /api/accounts — створення або ідемпотентний replay з outbox
 * (id завжди клієнтський, UUIDv7; ON CONFLICT DO UPDATE в AccountModel).
 *
 * Валюта рахунку: якщо клієнт її не надіслав, підставляємо базову валюту
 * власника (той самий фолбек, що й на фронтенді — див. AccountFormModal.vue),
 * а не мовчки відмовляємо. Якщо рахунок уже існує і по ньому вже є операції,
 * фактична зміна валюти забороняється (незалежно від того, з клієнта прийшла
 * нова валюта явно, чи ні — обидва шляхи зрештою пишуть один і той самий
 * стовпець).
 */
const upsertAccount = async (req) => {
  const b = req.body
  const ownerId = req.user.id
  const id = b.id || uuidv7()

  let currency = b.currency
  if (!currency) {
    const settings = await AppSettingsModel.getByUserId({ userId: ownerId })
    currency = settings?.base_currency ?? 'UAH'
  }

  if (b.id) {
    const existingCurrency = await AccountModel.getCurrency({ id: b.id, ownerId })
    if (existingCurrency && existingCurrency !== currency && (await TransactionModel.existsForAccount({ accountId: b.id }))) {
      const error = new Error('Неможливо змінити валюту рахунку — по ньому вже є операції')
      error.status = 400
      throw error
    }
  }

  const account = await AccountModel.upsert({
    id,
    ownerId,
    name: b.name,
    type: b.type,
    currency,
    icon: b.icon,
    color: b.color,
    initialBalance: b.initialBalance,
    loanDirection: b.loanDirection ?? null,
    includeInTotal: b.includeInTotal,
    archived: b.archived,
    order: b.order,
    note: b.note ?? null,
    currencyDisplay: b.currencyDisplay ?? null,
  })
  if (!account) {
    const error = new Error('Рахунок з таким id вже належить іншому користувачу')
    error.status = 409
    throw error
  }
  return account
}

export default upsertAccount
