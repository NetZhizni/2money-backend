let io = null

/** Called once by src/sockets/index.js's setupSocketIO after the Server is created. */
export function setIo(instance) {
  io = instance
}

/**
 * Pokes every connected client that a given syncable resource changed on the
 * server, so they can pull the delta right away instead of waiting for their
 * next 1min poll (see frontend src/db/sync.ts). Deliberately carries no data
 * beyond the entity name — the client already has a battle-tested, cursor-
 * based delta-pull for every resource; re-sending the row here would just be
 * a second, easier-to-drift copy of that same logic. A client that caused
 * the change gets poked too (cheap no-op: its pull cursor already covers it).
 */
export function notifySync(entity) {
  io?.emit('sync:changed', { entity })
}
