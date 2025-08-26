import TransactionRepository from '../../sql/transaction.repository.js'

const transactionUpdate = async ({ body }) => {
  const {
    id,
    date,
    from_account_id,
    from_amount,
    to_account_id,
    to_amount,
    comment,
    operation_type_id,
  } = body.params
  const res = await TransactionRepository.updateTransaction(id, {
    date,
    operation_type_id,
    from_account_id,
    from_amount,
    to_account_id,
    to_amount,
    comment,
  })
  return res
}

export default transactionUpdate
