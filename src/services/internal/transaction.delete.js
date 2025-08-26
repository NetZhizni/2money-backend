import TransactionRepository from '../../sql/transaction.repository.js'

const transactionDelete = async ({ body }) => {
  const { id } = body.params
  const res = await TransactionRepository.deleteTransaction(id)
  return res
}

export default transactionDelete
