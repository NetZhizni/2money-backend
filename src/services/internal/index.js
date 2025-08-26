import accountGetMy from './account.getMy.js'
import accountGetMyWallets from './account.getMyWallets.js'
import accountGetIncome from './account.getIncome.js'
import accountGetExpenses from './account.getExpenses.js'
import accountGetNotMyWallets from './account.getNotMyWallets.js'
import accountCreate from './account.create.js'
import accountUpdate from './account.update.js'

import transactionGetMy from './transaction.getMy.js'
import transactionUpdate from './transaction.update.js'
import transactionCreate from './transaction.create.js'
import transactionDelete from './transaction.delete.js'

import userGetInfo from './userGetInfo.js'



const services = {
  accountGetMy,
  accountGetMyWallets,
  accountGetIncome,
  accountGetExpenses,
  accountGetNotMyWallets,
  accountCreate,
  accountUpdate,
  //
  transactionGetMy,
  transactionUpdate,
  transactionCreate,
  transactionDelete,

  //
  userGetInfo,
}

export default services
