import TransactionModel from '#sql/TransactionModel'
import { parseSince } from '#util/time'

/**
 * GET /api/transactions
 * За замовчуванням — транзакції, де користувач учасник (owner або контрагент
 * переказу), активні або дельта за `?since=`.
 * `?scope=all` — транзакції всієї родини (сукупний баланс на TotalBalanceView,
 * той самий рівень довіри, що й `accounts?scope=all` — рахунки й так видно
 * всім), так само активні-тільки або дельта за `?since=` — свій курсор,
 * окремий від курсора власних/учасницьких транзакцій.
 */
const listTransactions = async (req) => {
  const syncedAt = Date.now()
  const since = parseSince(req.query.since)
  const items =
    req.query.scope === 'all'
      ? await TransactionModel.listAll({ since })
      : await TransactionModel.listForParticipant({ userId: req.user.id, since })
  return { items, syncedAt }
}

export default listTransactions
