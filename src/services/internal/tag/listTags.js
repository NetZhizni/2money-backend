import TagModel from '#sql/TagModel'
import { parseSince } from '#util/time'

/**
 * GET /api/tags — tags are shared across the whole family (see TagModel),
 * same as categories: no "own vs ?scope=all" distinction. Active-only on
 * first load, delta (incl. tombstones) with `?since=`.
 */
const listTags = async (req) => {
  const syncedAt = Date.now()
  const since = parseSince(req.query.since)
  const items = await TagModel.listAll({ since })
  return { items, syncedAt }
}

export default listTags
