import AccountRepository from '../../sql/account.repository.js'

const accountGetIncome = async ({ body }) => {
  const { id: ownerId } = body.user
  const res = await AccountRepository.accountGetIncome({ ownerId })
  return res
}

export default accountGetIncome
