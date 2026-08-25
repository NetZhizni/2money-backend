import TransactionModel from '#sql/TransactionModel'
import { parseSince } from '#util/time'

/**
 * GET /api/transactions
 * За замовчуванням — транзакції, де користувач учасник (owner або контрагент
 * переказу), активні або дельта за `?since=`.
 * `?scope=all` — активні транзакції всієї родини (сукупний баланс на TotalBalanceView,
 * той самий рівень довіри, що й `accounts?scope=all` — рахунки й так видно всім).
 */
const listTransactions = async (req) => {
  if (req.query.scope === 'all') return TransactionModel.listAllActive()
  const syncedAt = Date.now()
  const items = await TransactionModel.listForParticipant({ userId: req.user.id, since: parseSince(req.query.since) })
  return { items, syncedAt }
}

export default listTransactions
