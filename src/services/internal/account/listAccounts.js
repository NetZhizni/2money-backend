import AccountModel from '#sql/AccountModel'
import { parseSince } from '#util/time'

/**
 * GET /api/accounts
 * За замовчуванням — власні рахунки (активні, або дельта за `?since=`).
 * `?scope=all` — активні рахунки всієї родини (пікер переказів, сукупний баланс).
 */
const listAccounts = async (req) => {
  const { scope } = req.query
  if (scope === 'all') return AccountModel.listAllActive()
  const syncedAt = Date.now()
  const items = await AccountModel.listForOwner({ ownerId: req.user.id, since: parseSince(req.query.since) })
  return { items, syncedAt }
}

export default listAccounts
