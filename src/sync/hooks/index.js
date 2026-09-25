/**
 * Per-entity escape hatches from engine.js's generic CRUD. All optional:
 *   - prepare({ items, ownerId }) — runs once per write batch, before any
 *     beforeCreate, and returns a `ctx` they all share. It's where a hook
 *     makes its database lookups, so a batch of 200 rows costs a few queries
 *     rather than a few per row. Must not throw over one row's bad data
 *     (that would fail the whole batch) — leave that to beforeCreate.
 *   - beforeCreate({ id, body, ownerId, providedId, ctx }) — may rewrite one
 *     row's body, or throw to reject just that row. Every write goes through
 *     here (the outbox only ever sends full records), so this is the one
 *     place a rule like the currency lock has to live.
 *   - beforeRemove({ ids, ownerId }) — runs inside the soft-delete's own
 *     transaction, before it, and returns a Map of id -> error for the ids
 *     that must not go (an account or category still in use — see
 *     lookups.js's inUseError); the rest are removed as usual.
 *   - afterRemove({ ids, ownerId }) — runs inside the soft-delete's own
 *     transaction, with the ids that were actually removed.
 * Only the three entities below need any — the rest of the registry is plain
 * owner-scoped CRUD the engine already handles, so they deliberately have no
 * entry here.
 */
import accounts from './accounts.js'
import categories from './categories.js'
import transactions from './transactions.js'

export default { accounts, categories, transactions }
