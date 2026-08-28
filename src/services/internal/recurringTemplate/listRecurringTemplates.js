import RecurringTemplateModel from '#sql/RecurringTemplateModel'
import { parseSince } from '#util/time'

/**
 * GET /api/recurring-templates
 * За замовчуванням — власні шаблони (активні, або дельта за `?since=`).
 * `?scope=all` — шаблони всієї родини (перегляд витрат іншого користувача),
 * так само активні-тільки або дельта за `?since=` — свій курсор, окремий
 * від курсора власних шаблонів.
 */
const listRecurringTemplates = async (req) => {
  const { scope } = req.query
  const syncedAt = Date.now()
  const since = parseSince(req.query.since)
  const items =
    scope === 'all'
      ? await RecurringTemplateModel.listAll({ since })
      : await RecurringTemplateModel.listForOwner({ ownerId: req.user.id, since })
  return { items, syncedAt }
}

export default listRecurringTemplates
