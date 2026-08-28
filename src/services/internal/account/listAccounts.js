import AccountModel from '#sql/AccountModel'
import { parseSince } from '#util/time'

/**
 * GET /api/accounts
 * За замовчуванням — власні рахунки (активні, або дельта за `?since=`).
 * `?scope=all` — рахунки всієї родини (пікер переказів, сукупний баланс),
 * так само активні-тільки або дельта за `?since=` — свій курсор, окремий
 * від курсора власних рахунків.
 */
const listAccounts = async (req) => {
  const { scope } = req.query
  const syncedAt = Date.now()
  const since = parseSince(req.query.since)
  const items = scope === 'all' ? await AccountModel.listAll({ since }) : await AccountModel.listForOwner({ ownerId: req.user.id, since })
  return { items, syncedAt }
}

export default listAccounts
