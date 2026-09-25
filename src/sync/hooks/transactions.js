import pg from '#util/pg'
import { isUuid } from '#util/uuid'

/** account id -> owner id, for every one of `accountIds` that exists — one query for a whole batch. */
async function accountOwners(accountIds) {
  const ids = [...new Set(accountIds.filter(isUuid).map((id) => id.toLowerCase()))]
  if (!ids.length) return new Map()
  const { rows } = await pg.query(`SELECT id, owner_id FROM accounts WHERE id = ANY($1::uuid[])`, [ids])
  return new Map(rows.map((row) => [row.id, row.owner_id]))
}

/**
 * Whose own list this transaction belongs in: always its owner's, plus the
 * other profile's when it's a transfer INTO an account that profile owns (see
 * the frontend's Transaction.participantIds and registry.js's 'participant'
 * filter). Not an access control — every member can read every transaction
 * anyway (see registry.js) — but it decides what shows up as "yours", so it's
 * derived server-side from the destination account's real owner and never
 * taken from the request body: participantIds is a serverOnly column, so
 * engine.js has already stripped whatever the client sent before any of this
 * runs. Otherwise a client could file its transaction under someone else's
 * profile.
 */
function participantIds(ownerId, toAccountId, owners) {
  const ids = [ownerId]
  const toOwnerId = isUuid(toAccountId) ? owners.get(toAccountId.toLowerCase()) : undefined
  if (toOwnerId && toOwnerId !== ownerId) ids.push(toOwnerId)
  return ids
}

export default {
  async prepare({ items }) {
    return { owners: await accountOwners(items.map((body) => body.toAccountId)) }
  },

  beforeCreate({ body, ownerId, ctx }) {
    return { ...body, participantIds: participantIds(ownerId, body.toAccountId, ctx.owners) }
  },
}
