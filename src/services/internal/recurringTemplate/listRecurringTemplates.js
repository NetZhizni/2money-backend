import RecurringTemplateModel from '#sql/RecurringTemplateModel'
import { parseSince } from '#util/time'

const listRecurringTemplates = async (req) => {
  const syncedAt = Date.now()
  const items = await RecurringTemplateModel.listForOwner({ ownerId: req.user.id, since: parseSince(req.query.since) })
  return { items, syncedAt }
}

export default listRecurringTemplates
