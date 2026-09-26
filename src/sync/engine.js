import pg from '#util/pg'
import { uuidv7, isUuid } from '#util/uuid'
import { msToDate } from '#util/time'
import { httpStatusFor } from '#util/httpStatus'
import dbConfig from '../constants/dbConfig.js'
import { registry, quoteCol } from './registry.js'
import hooks from './hooks/index.js'

/**
 * Generic list/upsert/remove for every entity in registry.js — the one place
 * that talks SQL for synced data, replacing the seven near-identical
 * per-entity model+service stacks this used to be.
 *
 * Table and column names come only from the registry (never from the request),
 * and every value is parameterized — see registry.js's own doc comment for why
 * that's what makes the generic query building safe.
 *
 * Deletes are soft (deleted_at), never DELETE: a client that's been offline
 * needs to learn that a row is gone, and it only ever asks "what changed since
 * <cursor>" — a hard delete would simply be invisible to it (see listRows()'s
 * `since` branch, which deliberately drops the `deleted_at IS NULL` filter).
 * Only once a tombstone is old enough does jobs/purgeDeleted.js remove it for
 * good — and from then on, a client whose cursor predates it gets the full
 * list instead of a delta (see cursorExpired), and an edit of a record it no
 * longer exists for is refused rather than re-creating it (see refuseVanished).
 *
 * Two devices writing the same record are settled by WHEN each change was
 * made, not by which request arrived last: every write carries the client's
 * own edit time (`editedAt`, stored as client_updated_at), and a write older
 * than the one already stored is refused as stale — see upsertStatement. And
 * a delete is final: nothing brings a tombstoned row back, because an
 * offline edit landing after its record was deleted elsewhere (an account
 * whose recurring templates the delete already cascaded away, say) would
 * otherwise resurrect it half-empty. Nor can anything new be filed under a deleted
 * record — a transaction into a deleted account, a subcategory under a
 * deleted parent — see refuseDeletedRefs. Every refusal is reported per item,
 * with a reason the client shows its user — see classifyRefused.
 *
 * Entity-specific behaviour lives in hooks/ rather than here; see hooks/index.js.
 */
function businessError(message, status, reason) {
  const error = new Error(message)
  error.status = status
  error.reason = reason
  return error
}

function notFound(entity) {
  return businessError(registry[entity].messages.notFound, 404, 'notFound')
}

function invalidId(id) {
  return businessError(`Невалідний id: ${String(id)}`, 400, 'invalid')
}

const refusal = {
  owner: (entity) => businessError(registry[entity].messages.conflict, 409, 'owner'),
  stale: () => businessError('Запис змінено пізніше на іншому пристрої', 409, 'stale'),
  staleDelete: () => businessError('Запис змінено на іншому пристрої вже після цього видалення', 409, 'stale'),
  deleted: () => businessError('Запис уже видалено', 410, 'deleted'),
  parentDeleted: () => businessError('Рахунок або категорію, до яких належить запис, уже видалено', 409, 'parentDeleted'),
}

function createValue(field, body) {
  const raw = body[field.name]
  if (field.date) return msToDate(raw === undefined ? field.default : raw)
  return raw === undefined ? field.default : raw
}

/** A client body with every serverOnly field removed — see registry.js's col(). */
function clientBody(def, body) {
  const result = { ...body }
  for (const field of def.columns) if (field.serverOnly) delete result[field.name]
  return result
}

/**
 * When the client made this change: `editedAt` (epoch ms), which the outbox
 * stamps on every entry it sends. A client that predates it has only the
 * record's own `updatedAt`, which it bumps on every local edit — close
 * enough. Neither at all (the admin restore) means "now". The SQL clamps it
 * to the database clock either way (see upsertStatement), so a device whose
 * clock runs fast can't pre-date every edit that comes after it.
 */
function editedAtOf(value) {
  if (value == null) return null
  const ms = Number(value)
  return Number.isFinite(ms) ? new Date(ms) : null
}

// LEAST ignores NULL, so a write with no edit time at all is simply "now".
const clampedEditTime = (placeholder) => `LEAST(${placeholder}::timestamptz, CURRENT_TIMESTAMP)`

/**
 * One INSERT ... ON CONFLICT DO UPDATE for any number of rows. An existing
 * row is only overwritten when all of these hold — otherwise it's left
 * untouched and simply missing from RETURNING, which the caller then
 * classifies (see classifyRefused):
 *   - it isn't tombstoned (a delete is final);
 *   - this write was made no earlier than the one already stored
 *     (`>=`, so replaying the same write after a lost response is a no-op
 *     success rather than a conflict);
 *   - with `ownerGuarded`, it belongs to the caller.
 */
function upsertStatement(def, rows) {
  const dataColumns = def.columns.map((f) => f.column)
  const columns = ['id', 'owner_id', ...dataColumns, 'client_updated_at']
  const params = []
  const tuples = rows.map(({ id, ownerId, body }) => {
    const offset = params.length
    params.push(id, ownerId, ...def.columns.map((f) => createValue(f, body)), editedAtOf(body.editedAt ?? body.updatedAt))
    const placeholders = columns.map((_, i) => `$${offset + i + 1}`)
    placeholders[placeholders.length - 1] = clampedEditTime(placeholders.at(-1))
    return `(${placeholders.join(', ')})`
  })
  const setClauses = [...dataColumns, 'client_updated_at'].map((column) => `${quoteCol(column)} = EXCLUDED.${quoteCol(column)}`)
  const guards = [
    `${def.table}.deleted_at IS NULL`,
    `EXCLUDED.client_updated_at >= ${def.table}.client_updated_at`,
    ...(def.ownerGuarded ? [`${def.table}.owner_id = EXCLUDED.owner_id`] : []),
  ]

  const text = `
    INSERT INTO ${def.table} (${columns.map(quoteCol).join(', ')})
    VALUES ${tuples.join(',\n           ')}
    ON CONFLICT (id) DO UPDATE SET
      ${setClauses.join(',\n      ')},
      updated_at = CURRENT_TIMESTAMP
    WHERE ${guards.join(' AND ')}
    RETURNING *
  `
  return { text, params }
}

/**
 * Writes prepared rows (each `{ id, ownerId, body }`), setting `.row` on
 * every one that landed and `.error` on every one the database refused.
 * A row the upsert's guard turned away gets neither — see classifyRefused.
 *
 * All rows go out as ONE statement — the database is usually across a
 * network, so a batch costs one round trip instead of one per row. Sorted by
 * id there, so two devices pushing overlapping batches lock rows in the same
 * order instead of deadlocking. Only when that statement is refused for bad
 * data (see util/httpStatus.js) does this fall back to one statement per
 * row, in the caller's original order (a parent category before the child
 * that references it), which pins the failure on the row(s) that caused it.
 *
 * Anything that isn't bad data (a lost connection, a deadlock) is thrown:
 * the whole request fails with a 500 and the client retries it as a unit,
 * which is safe because every write here is an idempotent upsert.
 */
async function writeRows(def, rows) {
  if (!rows.length) return
  try {
    const sorted = [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    const { text, params } = upsertStatement(def, sorted)
    const { rows: written } = await pg.query(text, params)
    const byId = new Map(written.map((row) => [row.id, row]))
    for (const row of rows) row.row = byId.get(row.id) ?? null
    return
  } catch (error) {
    if (httpStatusFor(error) >= 500) throw error
    if (rows.length === 1) {
      rows[0].error = error
      return
    }
  }

  for (const row of rows) {
    try {
      const { text, params } = upsertStatement(def, [row])
      row.row = (await pg.query(text, params)).rows[0] ?? null
    } catch (error) {
      if (httpStatusFor(error) >= 500) throw error
      row.error = error
    }
  }
}

/**
 * Sets `.error` on every prepared row that newly points one of its `ref`
 * fields (see registry.js's col()) at a deleted record — a transaction into
 * an account deleted on another device while this one was offline, say.
 * The foreign key lets that through (the tombstone still exists), and the
 * result would be an orphan every device shows without its account.
 *
 * Only a reference the write CHANGES counts: a row that already pointed there
 * before the delete (data from before a record still in use was refused
 * deletion — see hooks/lookups.js's inUseError) can still be edited.
 *
 * One query per referenced entity, plus one for the stored rows only when
 * something does point at a deleted record — whatever the batch size.
 */
async function refuseDeletedRefs(def, rows) {
  const refs = def.columns.filter((field) => field.ref)
  if (!refs.length || !rows.length) return

  const refValue = (row, field) => {
    const value = row.body[field.name]
    return isUuid(value) ? value.toLowerCase() : null
  }

  const wanted = new Map()
  for (const row of rows) {
    for (const field of refs) {
      const value = refValue(row, field)
      if (!value) continue
      if (!wanted.has(field.ref)) wanted.set(field.ref, new Set())
      wanted.get(field.ref).add(value)
    }
  }
  const deleted = new Set()
  for (const [entity, ids] of wanted) {
    const { rows: found } = await pg.query(
      `SELECT id FROM ${registry[entity].table} WHERE id = ANY($1::uuid[]) AND deleted_at IS NOT NULL`,
      [[...ids]],
    )
    for (const { id } of found) deleted.add(`${entity}:${id}`)
  }
  if (!deleted.size) return

  const columns = refs.map((field) => quoteCol(field.column)).join(', ')
  const { rows: stored } = await pg.query(`SELECT id, ${columns} FROM ${def.table} WHERE id = ANY($1::uuid[])`, [
    rows.map((row) => row.id),
  ])
  const storedById = new Map(stored.map((row) => [row.id, row]))
  for (const row of rows) {
    const before = storedById.get(row.id)
    const orphaned = refs.some((field) => {
      const value = refValue(row, field)
      return value && deleted.has(`${field.ref}:${value}`) && before?.[field.column] !== value
    })
    if (orphaned) row.error = refusal.parentDeleted()
  }
}

/** id -> { owner_id, deleted } for whichever of `ids` exist, tombstones included. */
async function currentState(def, ids) {
  const { rows } = await pg.query(
    `SELECT id, owner_id, deleted_at IS NOT NULL AS deleted FROM ${def.table} WHERE id = ANY($1::uuid[])`,
    [ids],
  )
  return new Map(rows.map((row) => [row.id, row]))
}

/**
 * Sets `.error` on every prepared row sent as an edit of a record the client
 * already had (`mustExist` — see the frontend's db/sync/outbox.ts) that the
 * server doesn't have at all: one deleted so long ago that its tombstone has
 * since been purged (see jobs/purgeDeleted.js). Without this the upsert
 * would quietly create it again, from a device that was offline for months —
 * exactly the resurrection a tombstone refuses (see upsertStatement's guard).
 * A row sent without the flag (a new record, or a client from before it) is
 * written as always.
 */
async function refuseVanished(def, rows) {
  const expected = rows.filter((row) => row.mustExist)
  if (!expected.length) return
  const state = await currentState(def, expected.map((row) => row.id))
  for (const row of expected) if (!state.has(row.id)) row.error = refusal.deleted()
}

/**
 * Sets `.error` on every prepared row the upsert's guard turned away, saying
 * which of its conditions failed — the client can't do anything useful with
 * a bare "conflict", but "someone deleted this" or "someone changed this
 * after you did" is something its user can act on.
 */
async function classifyRefused(entity, rows, ownerId) {
  if (!rows.length) return
  const def = registry[entity]
  const state = await currentState(def, rows.map((row) => row.id))
  for (const row of rows) {
    const existing = state.get(row.id)
    if (existing && def.ownerGuarded && existing.owner_id !== ownerId) row.error = refusal.owner(entity)
    else if (existing?.deleted) row.error = refusal.deleted()
    else row.error = refusal.stale()
  }
}

// Subtracted from every cursor on top of the open-transaction horizon below:
// covers the few milliseconds between reading that horizon and the list
// query's own snapshot. Re-sending a few seconds of rows costs nothing — the
// client applies them idempotently.
const CURSOR_SLACK_MS = 5_000

/**
 * The database's clock, read once per pull. `serverNow` is that clock as is —
 * what a client measures its own clock's error against, so the `editedAt` it
 * stamps on every change is in the same time as the client_updated_at the
 * change is compared with (see upsertStatement, and the frontend's
 * db/sync/clock.ts). Without it, a device whose clock runs a few minutes
 * behind would have its newer edits refused as stale.
 *
 * `syncedAt` is what a list response hands back as the client's next cursor.
 * "Just use the current time" is wrong twice over. The clock: the cursor is
 * compared against updated_at, which Postgres stamps with ITS clock, so the
 * app server's Date.now() is off by however far the two machines drift
 * apart. And visibility: updated_at = CURRENT_TIMESTAMP is the *start* of the
 * writing transaction, so a write still uncommitted while this runs can land
 * later with an updated_at already behind a cursor taken now — and no delta
 * pull would ever see it (a whole-family restore, one long transaction, is
 * exactly that).
 *
 * So the cursor is the database's own "now", pulled back to the start of the
 * oldest transaction still open in THIS app (application_name — see
 * constants/dbConfig.js): anything it could still commit is guaranteed an
 * updated_at at or after that. Only this app's own connections write synced
 * rows, so an unrelated session (a pg_dump, a forgotten SQL console) is no
 * reason to hold every client's cursor back. And a transaction open for over
 * an hour is treated as stuck rather than waited for — otherwise one leaked
 * connection would have every client re-download everything since it opened,
 * on every pull. Must be read BEFORE the rows themselves, so every write it
 * doesn't cover is either already visible to that later query or still ahead
 * of the cursor.
 *
 * Telling this app's connections apart relies on the application_name it
 * connects with actually reaching Postgres — a connection pooler in between
 * (PgBouncer, Supavisor) may drop or replace it. So it's checked on this very
 * connection: if its name isn't the configured one, every session on the
 * database counts. That errs towards re-sending rows rather than skipping
 * them — a cursor held back too far only costs a larger delta.
 *
 * `purgedThrough` rides along in the same query (entity -> epoch ms, see
 * cursorExpired) rather than costing every pull a round trip of its own.
 */
async function readClock() {
  const { rows } = await pg.query(
    `
    SELECT now() AS now, LEAST(now(), COALESCE((
      SELECT min(xact_start) FROM pg_stat_activity
      WHERE datname = current_database()
        AND backend_type = 'client backend'
        AND pid <> pg_backend_pid()
        AND (application_name = $1 OR current_setting('application_name') IS DISTINCT FROM $1)
        AND xact_start > now() - interval '1 hour'
    ), now())) AS horizon,
    (SELECT json_object_agg(entity, ceil(extract(epoch FROM purged_through) * 1000)) FROM sync_purges) AS purges
  `,
    [dbConfig.application_name],
  )
  // Rounded UP to the millisecond: cursors are whole milliseconds, while the
  // watermark keeps Postgres' microseconds, and a cursor in the same
  // millisecond as the last purged row can still be behind it.
  const purgedThrough = {}
  for (const [entity, at] of Object.entries(rows[0].purges ?? {})) purgedThrough[entity] = Number(at)
  return {
    syncedAt: new Date(rows[0].horizon).getTime() - CURSOR_SLACK_MS,
    serverNow: new Date(rows[0].now).getTime(),
    purgedThrough,
  }
}

/**
 * Whether a delta since `since` could be missing deletions: the entity's
 * tombstones have been purged (see jobs/purgeDeleted.js) past that cursor,
 * so a row deleted after it may now be gone without a trace — a client that
 * has been away longer than tombstones are kept. Such a pull is answered
 * with the full list instead, flagged `full`, and the client drops whatever
 * it still holds that the list doesn't have (see the frontend's
 * db/sync/pull.ts).
 */
function cursorExpired(since, purgedThrough) {
  return Boolean(since) && purgedThrough != null && since.getTime() < purgedThrough
}

/** A growing parameter list, and a function that adds a value to it and returns its placeholder. */
function parameters() {
  const params = []
  const param = (value) => {
    params.push(value)
    return `$${params.length}`
  }
  return { params, param }
}

/**
 * What a pull of `def` asks for, as WHERE conditions: active rows on a first
 * load, and the delta since `since` (tombstones included) afterwards.
 * `scope: 'all'` is the family-wide view — see registry.js's
 * listDefaultFilter. Shared by listRows and changedEntities, so the quick
 * "anything new?" check can never disagree with the rows it stands in for.
 */
function deltaFilter(def, { ownerId, since, scope }, param) {
  const where = []
  if (scope !== 'all' && def.listDefaultFilter !== 'none') {
    where.push(def.listDefaultFilter === 'participant' ? `${param(ownerId)} = ANY(participant_ids)` : `owner_id = ${param(ownerId)}`)
  }
  where.push(since ? `updated_at > ${param(since)}` : 'deleted_at IS NULL')
  return where
}

class SyncEngine {
  /**
   * Rows visible to `ownerId`: active-only on a first load, and the delta
   * since `since` (tombstones included) afterwards. `scope: 'all'` is the
   * family-wide view — see registry.js's listDefaultFilter.
   *
   * Always in id order, so a caller can page through with `after` (the last
   * id it got) and `limit`. Paging by id rather than by updated_at is what
   * keeps pages from overlapping or skipping as rows change mid-way: a row
   * written while a client is paging either lands on a later page or — if its
   * id is behind the page boundary — has an updated_at past the cursor that
   * client was given with its first page, so its next delta picks it up.
   * That only holds if the client keeps THAT first cursor until it has every
   * page (see the frontend's db/sync/pull.ts).
   */
  async listRows({ entity, ownerId, since, scope, after, limit }) {
    const def = registry[entity]
    const { params, param } = parameters()
    const where = deltaFilter(def, { ownerId, since, scope }, param)
    if (after) where.push(`id > ${param(after)}::uuid`)
    const limitClause = limit ? `LIMIT ${param(limit)}` : ''

    return (await pg.query(`SELECT * FROM ${def.table} WHERE ${where.join(' AND ')} ORDER BY id ${limitClause}`, params)).rows
  }

  /** One page of listRows — `next` is the `after` to ask for the rest with, or null once there's no more. Without a `limit`, everything at once. */
  async page({ limit, ...query }) {
    if (!limit) return { items: await this.listRows(query), next: null }
    const rows = await this.listRows({ ...query, limit: limit + 1 })
    return rows.length > limit ? { items: rows.slice(0, limit), next: rows[limit - 1].id } : { items: rows, next: null }
  }

  async list({ entity, ownerId, since, scope, after, limit }) {
    const { purgedThrough, ...clock } = await readClock()
    const full = cursorExpired(since, purgedThrough[entity])
    const { items, next } = await this.page({ entity, ownerId, since: full ? undefined : since, scope, after, limit })
    return { items, ...clock, next, ...(full ? { full: true } : {}) }
  }

  /**
   * Every requested entity's delta in one round trip — what the client's
   * periodic sync asks for instead of one GET per entity. `cursors` maps an
   * entity name to its own `since` (undefined = full load), `after` an
   * entity name to where its previous page left off. Unknown names are
   * left out of the answer rather than rejected, so a client newer than this
   * server just sees them missing and doesn't advance those cursors.
   * `next` only lists the entities that have more to page through, and
   * `full` (only when non-empty) the ones answered with their full list
   * because their cursor has expired — see cursorExpired.
   */
  async changes({ ownerId, cursors, scope, after = {}, limit }) {
    const { purgedThrough, ...clock } = await readClock()
    const names = Object.keys(cursors).filter((name) => Object.hasOwn(registry, name))
    const full = names.filter((name) => cursorExpired(cursors[name], purgedThrough[name]))
    const since = Object.fromEntries(names.map((name) => [name, full.includes(name) ? undefined : cursors[name]]))
    // Most periodic syncs find nothing new anywhere — one query answers that
    // for every delta at once, and only the entities that do have changes
    // get a list query of their own.
    const deltas = names.filter((name) => since[name] && !after[name])
    const changed = deltas.length ? await this.changedEntities({ ownerId, cursors: since, scope, entities: deltas }) : new Set()
    const pages = await Promise.all(
      names.map((entity) =>
        deltas.includes(entity) && !changed.has(entity)
          ? { items: [], next: null }
          : this.page({ entity, ownerId, since: since[entity], scope, after: after[entity], limit }),
      ),
    )
    const next = {}
    names.forEach((name, i) => {
      if (pages[i].next) next[name] = pages[i].next
    })
    return {
      ...clock,
      entities: Object.fromEntries(names.map((name, i) => [name, pages[i].items])),
      next,
      ...(full.length ? { full } : {}),
    }
  }

  /**
   * Which of `entities` have anything past their own cursor, in one
   * statement. Read after readClock, like the rows it stands in for, so the
   * same reasoning covers it: whatever it can't see yet is ahead of the
   * cursor handed back, and the next pull brings it.
   */
  async changedEntities({ ownerId, cursors, scope, entities }) {
    const { params, param } = parameters()
    const checks = entities.map((entity) => {
      const def = registry[entity]
      const where = deltaFilter(def, { ownerId, since: cursors[entity], scope }, param)
      return `SELECT ${param(entity)}::text AS entity WHERE EXISTS (SELECT 1 FROM ${def.table} WHERE ${where.join(' AND ')})`
    })
    const { rows } = await pg.query(checks.join('\nUNION ALL\n'), params)
    return new Set(rows.map((row) => row.entity))
  }

  /**
   * Specific rows by id, tombstones included and regardless of owner (the
   * same visibility as `scope=all` — see registry.js on why that's the
   * family's trust model rather than a leak). Lets a client re-read the
   * server's copy of records whose write it just had refused — see the
   * frontend's db/sync/outbox.ts.
   */
  async getByIds({ entity, ids }) {
    const def = registry[entity]
    const valid = ids.filter(isUuid)
    if (!valid.length) return []
    return (await pg.query(`SELECT * FROM ${def.table} WHERE id = ANY($1::uuid[])`, [valid])).rows
  }

  /**
   * The raw write: no serverOnly stripping, no hooks, just the upsert (with
   * the same guard as any other — see upsertStatement). Returns the row, or
   * null when the guard refused it. For the admin restore, which writes
   * records on other members' behalf.
   */
  async rawUpsert({ entity, id, ownerId, body }) {
    const { text, params } = upsertStatement(registry[entity], [{ id, ownerId, body }])
    const { rows } = await pg.query(text, params)
    return rows[0] ?? null
  }

  /**
   * Applies a batch of client writes (the outbox's bulk push, or one POST)
   * and reports on every item separately — one bad row never costs the
   * others their write. Returns one `{ id, ok, row?, error? }` per input
   * item, in input order.
   *
   * Stays a handful of round trips however large the batch: a hook's lookups
   * are made once for all of it (see hooks/index.js's `prepare`) and the rows
   * go out in one statement (see writeRows).
   *
   * The same id twice in one batch (a record edited twice while offline) is
   * written once, with the later body — a single INSERT ... ON CONFLICT can't
   * touch one row twice, and the end state is the same either way. It keeps
   * the earlier position, which is what matters for ordering against the
   * batch's other rows.
   *
   * Not for use inside pg.transaction(): writeRows' fallback relies on a
   * failed statement not aborting the ones after it.
   */
  async upsertMany({ entity, ownerId, items }) {
    const def = registry[entity]
    const hook = hooks[entity]
    const results = new Array(items.length)
    const pending = new Map()

    items.forEach((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        results[index] = { id: null, ok: false, error: businessError('Запис має бути об’єктом', 400, 'invalid') }
        return
      }
      if (item.id != null && !isUuid(item.id)) {
        results[index] = { id: item.id, ok: false, error: invalidId(item.id) }
        return
      }
      const id = item.id ? item.id.toLowerCase() : uuidv7()
      const { mustExist: flag, ...fields } = item
      const body = { ...clientBody(def, fields), id }
      // Twice in one batch, the record only has to exist already if every
      // write of it says so — its creation followed by an edit is still a creation.
      const mustExist = flag === true
      const existing = pending.get(id)
      if (existing) {
        existing.body = body
        existing.mustExist &&= mustExist
        existing.indexes.push(index)
      } else {
        pending.set(id, { id, ownerId, providedId: Boolean(item.id), body, mustExist, indexes: [index] })
      }
    })

    const batch = [...pending.values()]
    await refuseVanished(def, batch)
    await refuseDeletedRefs(def, batch.filter((p) => !p.error))
    const candidates = batch.filter((p) => !p.error)
    const ctx = hook?.prepare ? await hook.prepare({ items: candidates.map((p) => p.body), ownerId }) : undefined
    const writable = []
    for (const p of candidates) {
      try {
        if (hook?.beforeCreate) p.body = await hook.beforeCreate({ id: p.id, body: p.body, ownerId, providedId: p.providedId, ctx })
        writable.push(p)
      } catch (error) {
        p.error = error
      }
    }

    await writeRows(def, writable)
    await classifyRefused(
      entity,
      writable.filter((p) => !p.row && !p.error),
      ownerId,
    )

    for (const p of batch) {
      const error = p.row ? null : p.error
      for (const index of p.indexes) {
        const id = items[index].id ?? p.id
        results[index] = error ? { id, ok: false, error } : { id, ok: true, row: p.row }
      }
    }
    return results
  }

  async create({ entity, ownerId, body }) {
    const [result] = await this.upsertMany({ entity, ownerId, items: [body ?? {}] })
    if (!result.ok) throw result.error
    return result.row
  }

  /**
   * Soft-deletes a batch as one transaction: the tombstones and a hook's
   * cascade (deleting an account tombstones its recurring templates) commit
   * together or not at all, so a failure can't leave an account gone while
   * its templates linger — the client just retries the whole batch.
   *
   * A hook's beforeRemove can hold some ids back (an account or category
   * that still has operations — see hooks/lookups.js's inUseError); those
   * are refused with its error, but only once they're known to be the
   * caller's to delete at all, so the refusal never says anything about
   * someone else's record that a plain "not found" wouldn't.
   *
   * `items` are `{ id, editedAt? }`: a delete is a change like any other, so
   * one made before the record's latest edit is refused as stale instead of
   * wiping out that edit (no `editedAt` means "now", so it always goes
   * through). Deleting something that's already deleted counts as success: a
   * retry after a lost response must not come back as a 404 that makes the
   * client give up. Only an id that was never there (or isn't the caller's)
   * is reported as not found. Returns one `{ id, ok, error? }` per input item.
   */
  async removeMany({ entity, ownerId, items }) {
    const def = registry[entity]
    const hook = hooks[entity]

    // The same id twice counts once, with the latest edit time asked for
    // (none at all means "now", the latest there is).
    const requested = new Map()
    for (const item of items) {
      if (!isUuid(item?.id)) continue
      const id = item.id.toLowerCase()
      const at = editedAtOf(item.editedAt)?.getTime() ?? Infinity
      requested.set(id, Math.max(requested.get(id) ?? -Infinity, at))
    }
    const ids = [...requested.keys()]
    const editTimes = ids.map((id) => (requested.get(id) === Infinity ? null : new Date(requested.get(id))))

    const outcome = !ids.length
      ? new Map()
      : await pg.transaction(async () => {
          const heldBack = hook?.beforeRemove ? await hook.beforeRemove({ ids, ownerId }) : new Map()
          const removable = ids.map((id, index) => [id, editTimes[index]]).filter(([id]) => !heldBack.has(id))
          let removedIds = []
          if (removable.length) {
            const params = [removable.map(([id]) => id), removable.map(([, at]) => at), ...(def.ownerGuarded ? [ownerId] : [])]
            const { rows: removed } = await pg.query(
              `UPDATE ${def.table} AS t
               SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
               FROM unnest($1::uuid[], $2::timestamptz[]) AS req(id, edited_at)
               WHERE t.id = req.id AND t.deleted_at IS NULL
                 AND ${clampedEditTime('req.edited_at')} >= t.client_updated_at
                 ${def.ownerGuarded ? 'AND t.owner_id = $3' : ''}
               RETURNING t.id`,
              params,
            )
            removedIds = removed.map((row) => row.id)
          }
          if (removedIds.length && hook?.afterRemove) await hook.afterRemove({ ids: removedIds, ownerId })

          const result = new Map(removedIds.map((id) => [id, null]))
          if (result.size === ids.length) return result
          const state = await currentState(def, ids.filter((id) => !result.has(id)))
          for (const id of ids) {
            if (result.has(id)) continue
            const existing = state.get(id)
            if (!existing || (def.ownerGuarded && existing.owner_id !== ownerId)) result.set(id, notFound(entity))
            else if (existing.deleted) result.set(id, null)
            else result.set(id, heldBack.get(id) ?? refusal.staleDelete())
          }
          return result
        })

    return items.map((item) => {
      const id = item?.id
      if (!isUuid(id)) return { id, ok: false, error: invalidId(id) }
      const error = outcome.get(id.toLowerCase())
      return error ? { id, ok: false, error } : { id, ok: true }
    })
  }

  async remove({ entity, id, ownerId }) {
    const [result] = await this.removeMany({ entity, ownerId, items: [{ id }] })
    if (!result.ok) throw result.error.status === 400 ? notFound(entity) : result.error
    return { removed: true }
  }
}

export default new SyncEngine()
