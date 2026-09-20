import TagModel from '#sql/TagModel'
import { uuidv7 } from '#util/uuid'

/** POST /api/tags — create/idempotent replay from the outbox (see frontend src/db/sync.ts). */
const upsertTag = async (req) => {
  const b = req.body
  const ownerId = req.user.id
  const id = b.id || uuidv7()

  const tag = await TagModel.upsert({ id, ownerId, name: b.name, color: b.color })
  return tag
}

export default upsertTag
