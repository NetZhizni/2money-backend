import CategoryModel from '#sql/CategoryModel'
import { parseSince } from '#util/time'

/** GET /api/categories?since= — власні категорії, активні або дельта. */
const listCategories = async (req) => {
  const syncedAt = Date.now()
  const items = await CategoryModel.listForOwner({ ownerId: req.user.id, since: parseSince(req.query.since) })
  return { items, syncedAt }
}

export default listCategories
