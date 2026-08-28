import CategoryModel from '#sql/CategoryModel'
import { parseSince } from '#util/time'

/**
 * GET /api/categories — categories are shared across the whole family (see
 * CategoryModel), so there's no more "own vs ?scope=all" distinction: both
 * resolve to the same unscoped list. `?scope=all` is still accepted (older
 * cached frontend builds may send it) but no longer changes anything.
 * Active-only on first load, delta (incl. tombstones) with `?since=`.
 */
const listCategories = async (req) => {
  const syncedAt = Date.now()
  const since = parseSince(req.query.since)
  const items = await CategoryModel.listAll({ since })
  return { items, syncedAt }
}

export default listCategories
