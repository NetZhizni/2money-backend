import AccountModel from '#sql/AccountModel'
import TransactionModel from '#sql/TransactionModel'

/**
 * PATCH /api/accounts/:id — частковий апдейт, тільки власник. Не використовується
 * фронтендом сьогодні (offline-first outbox завжди йде через POST-апсерт — див.
 * upsertAccount.js), лишається тут заради узгодженого API — тож той самий
 * захист від зміни валюти після появи операцій діє і тут.
 */
const patchAccount = async (req) => {
  const b = req.body
  const ownerId = req.user.id
  const id = req.params.id

  if (b.currency !== undefined) {
    const existingCurrency = await AccountModel.getCurrency({ id, ownerId })
    if (existingCurrency && existingCurrency !== b.currency && (await TransactionModel.existsForAccount({ accountId: id }))) {
      const error = new Error('Неможливо змінити валюту рахунку — по ньому вже є операції')
      error.status = 400
      throw error
    }
  }

  const account = await AccountModel.patch({
    id,
    ownerId,
    name: b.name,
    type: b.type,
    currency: b.currency,
    icon: b.icon,
    color: b.color,
    initial_balance: b.initialBalance,
    loan_direction: b.loanDirection,
    include_in_total: b.includeInTotal,
    archived: b.archived,
    order: b.order,
    note: b.note,
    currency_display: b.currencyDisplay,
  })
  if (!account) {
    const error = new Error('Рахунок не знайдено')
    error.status = 404
    throw error
  }
  return account
}

export default patchAccount
