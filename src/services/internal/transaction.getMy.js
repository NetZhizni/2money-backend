import TransactionRepository from '../../sql/transaction.repository.js'

const transactionGetMy = async ({ body }) => {
  const { id: ownerId } = body.user
  const res = await TransactionRepository.findTransactions({ ownerId })
  return res
}

export default transactionGetMy
