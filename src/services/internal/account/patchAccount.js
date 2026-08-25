import AccountModel from '#sql/AccountModel'

/** PATCH /api/accounts/:id — частковий апдейт, тільки власник. */
const patchAccount = async (req) => {
  const b = req.body
  const account = await AccountModel.patch({
    id: req.params.id,
    ownerId: req.user.id,
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
  })
  if (!account) {
    const error = new Error('Рахунок не знайдено')
    error.status = 404
    throw error
  }
  return account
}

export default patchAccount
