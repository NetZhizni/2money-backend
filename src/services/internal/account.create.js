import AccountRepository from '../../sql/account.repository.js'

const accountCreate = async ({ body }) => {
  const { id: ownerId } = body.user
  const { name, currency, account_type_id, initial_balance, icon, color } = body.params

  const res = await AccountRepository.createAccount({
    name,
    currency,
    owner_id: ownerId,
    account_type_id,
    initial_balance,
    icon,
    color,
  })
  return res
}

export default accountCreate
