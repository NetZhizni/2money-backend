import AccountRepository from '../../sql/account.repository.js'

const accountGetMyWallets = async ({ body }) => {
  const { id: ownerId } = body.user

  const res = await AccountRepository.findAccount({
    owner_id: ownerId,
    account_type_id: [1, 2, 3],
  })
  return res
}

export default accountGetMyWallets
