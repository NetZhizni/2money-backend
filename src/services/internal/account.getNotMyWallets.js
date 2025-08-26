import AccountRepository from '../../sql/account.repository.js'

const accountGetNotMyWallets = async ({ body }) => {
  const { id: ownerId } = body.user

  const res = await AccountRepository.accountGetNotMyWallets({
    ownerId,
    accountTypeId: [1, 2, 3],
  })
  return res
}

export default accountGetNotMyWallets
