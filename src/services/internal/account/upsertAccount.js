import AccountModel from '#sql/AccountModel'
import { uuidv7 } from '#util/uuid'

/**
 * POST /api/accounts — створення або ідемпотентний replay з outbox
 * (id завжди клієнтський, UUIDv7; ON CONFLICT DO UPDATE в AccountModel).
 */
const upsertAccount = async (req) => {
  const b = req.body
  const account = await AccountModel.upsert({
    id: b.id || uuidv7(),
    ownerId: req.user.id,
    name: b.name,
    type: b.type,
    currency: b.currency,
    icon: b.icon,
    color: b.color,
    initialBalance: b.initialBalance,
    loanDirection: b.loanDirection ?? null,
    includeInTotal: b.includeInTotal,
    archived: b.archived,
    order: b.order,
    note: b.note ?? null,
  })
  if (!account) {
    const error = new Error('Рахунок з таким id вже належить іншому користувачу')
    error.status = 409
    throw error
  }
  return account
}

export default upsertAccount
