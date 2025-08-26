import AccountRepository from '../../sql/account.repository.js'

const accountGetExpenses = async ({ body }) => {
  const { id: ownerId } = body.user
  const res = await AccountRepository.accountGetExpenses({ ownerId })
  return res
}

export default accountGetExpenses
