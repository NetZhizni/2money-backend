import AccountRepository from '../../sql/account.repository.js'

const accountUpdate = async ({ body }) => {
  const { id: ownerId } = body.user
  const { id, name, currency, account_type_id, initial_balance, icon, color, is_archive } = body.params

  const res = await AccountRepository.updateAccount(id, ownerId, {
    name,
    currency,
    account_type_id,
    initial_balance,
    icon,
    color,
    is_archive
  })
  return res
}

export default accountUpdate
