import { Router } from 'express'
import { camelizeKeys } from '#util/caseConvert'
import { parseSince } from '#util/time'
import { httpStatusFor, reasonFor } from '#util/httpStatus'
import { isUuid } from '#util/uuid'
import listDirectory from '#services/user/listDirectory'
import { registry } from './registry.js'
import engine from './engine.js'

// A drained offline outbox can be large, but one request must stay bounded
// (the whole body has to fit express.json's limit — see src/index.js). The
// client chunks to well under this.
const MAX_BULK_ITEMS = 1000

// The most rows one entity may return per page. A client asks for its own
// page size (see the frontend's db/sync/pull.ts); this only caps it.
const MAX_PAGE_SIZE = 5000

function badRequest(message) {
  const error = new Error(message)
  error.status = 400
  return error
}

function requireList(value, name) {
  if (!Array.isArray(value) || value.length === 0) throw badRequest(`${name} має бути непорожнім масивом`)
  if (value.length > MAX_BULK_ITEMS) throw badRequest(`${name} не може перевищувати ${MAX_BULK_ITEMS}`)
  return value
}

/**
 * `limit` for a paged list. Absent means "everything at once" — what a
 * client from before paging existed expects: it would take a first page for
 * the whole answer, store the cursor, and never learn about the rest.
 */
function parseLimit(value) {
  if (value == null || value === '') return undefined
  const limit = Number(value)
  if (!Number.isInteger(limit) || limit < 1) throw badRequest('limit має бути додатним цілим числом')
  return Math.min(limit, MAX_PAGE_SIZE)
}

function parseAfter(value) {
  if (value == null || value === '') return undefined
  if (!isUuid(value)) throw badRequest('after має бути uuid')
  return value.toLowerCase()
}

/** A bulk delete's body as engine.removeMany's `{ id, editedAt }` items — an item without `editedAt` means "now". */
function deleteItems(body) {
  return requireList(body?.items, 'items').map((item) => ({ id: item?.id, editedAt: item?.editedAt }))
}

function handle(action) {
  return async (req, res, next) => {
    try {
      const result = await action(req)
      res.status(200).json(camelizeKeys(result))
    } catch (error) {
      next(error)
    }
  }
}

/**
 * One engine per-item result in the shape the outbox reads (see the
 * frontend's db/sync/outbox.ts): its per-item `status` follows the same
 * "4xx is terminal, 5xx is worth retrying" rule the single-record endpoints
 * give through the HTTP status itself, and `reason` says why in a form the
 * client can put in front of its user (see util/httpStatus.js's reasonFor).
 */
function itemResult({ id, ok, row, error }) {
  if (ok) return row ? { id, ok, data: row } : { id, ok }
  return { id, ok, status: httpStatusFor(error), reason: reasonFor(error), message: error.message }
}

/**
 * Mounts one REST resource per registry.js entry onto the (already
 * auth-guarded — see routers/index.js) internal router: a paged list, the
 * bulk endpoints the offline outbox drains through, and by-ids for
 * re-reading refused writes — plus POST /sync/pull for the periodic sync.
 */
export function mountSyncRoutes(app) {
  // Every entity's delta — and, on request, the family directory — in one
  // round trip. Body: { cursors: { <entity>: <since epoch-ms | null> },
  // after?: { <entity>: <last id of the previous page> }, limit?, scope?, users? }.
  // Answers with the database's clock alongside (see engine.js readClock).
  app.post(
    '/sync/pull',
    handle(async (req) => {
      const { cursors, after, limit, scope, users } = req.body ?? {}
      if (!cursors || typeof cursors !== 'object' || Array.isArray(cursors)) throw badRequest('cursors має бути об’єктом')
      if (after != null && (typeof after !== 'object' || Array.isArray(after))) throw badRequest('after має бути об’єктом')
      const since = Object.fromEntries(Object.entries(cursors).map(([name, value]) => [name, parseSince(value)]))
      const from = Object.fromEntries(Object.entries(after ?? {}).map(([name, value]) => [name, parseAfter(value)]))
      const [changes, directory] = await Promise.all([
        engine.changes({ ownerId: req.user.id, cursors: since, after: from, limit: parseLimit(limit), scope }),
        users ? listDirectory() : undefined,
      ])
      return directory ? { ...changes, users: directory } : changes
    }),
  )

  for (const [entity, def] of Object.entries(registry)) {
    const router = Router()

    router.get(
      '/',
      handle((req) =>
        engine.list({
          entity,
          ownerId: req.user.id,
          since: parseSince(req.query.since),
          scope: req.query.scope,
          after: parseAfter(req.query.after),
          limit: parseLimit(req.query.limit),
        }),
      ),
    )
    // Bulk counterpart of POST /, for a client draining its outbox. Each item
    // is applied and reported on independently — one bad row must not abort
    // the rest of the batch, or a single poisoned entry would block that
    // client's queue forever.
    router.post(
      '/bulk',
      handle(async (req) => {
        const results = await engine.upsertMany({ entity, ownerId: req.user.id, items: requireList(req.body?.items, 'items') })
        return { items: results.map(itemResult) }
      }),
    )
    // Bulk delete as a POST: a DELETE with a body is legal HTTP, but some
    // proxies and CDNs drop that body on the way, which would turn every
    // queued delete into a 400.
    router.post(
      '/bulk-delete',
      handle(async (req) => {
        const results = await engine.removeMany({ entity, ownerId: req.user.id, items: deleteItems(req.body) })
        return { items: results.map(itemResult) }
      }),
    )
    // The server's copy of specific records, tombstones included — what a
    // client re-reads after a write of its own was refused (see engine.getByIds).
    router.post(
      '/by-ids',
      handle(async (req) => ({ items: await engine.getByIds({ entity, ids: requireList(req.body?.ids, 'ids') }) })),
    )
    // One record at a time — what the outbox of a frontend from before the
    // bulk endpoints still replays with. An installed PWA keeps running its
    // cached build until it picks up the new one, so these stay for as long
    // as such a device might still have writes queued.
    router.post(
      '/',
      handle((req) => engine.create({ entity, ownerId: req.user.id, body: req.body })),
    )
    router.delete(
      '/:id',
      handle((req) => engine.remove({ entity, id: req.params.id, ownerId: req.user.id })),
    )

    app.use(`/${def.path}`, router)
  }
}
