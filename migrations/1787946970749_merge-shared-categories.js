/**
 * Categories become a shared family resource (see #services/category/*):
 * `owner_id` stops gating reads/writes there — every active member sees and
 * edits the same list. This one-time data migration consolidates what
 * per-owner scoping already produced: every new member got their own private
 * copy of the default category set on first login (see db/seed.ts), so a
 * 3-member family currently has 3 near-identical "Продукти" rows etc.
 *
 * Only rows flagged `is_default = true` (the seeded set, exact duplicates by
 * construction) are auto-merged, matched by (kind, name) — a custom category
 * someone made that happens to share a name is left untouched rather than
 * risk merging two unrelated things; it simply becomes visible/editable to
 * the whole family going forward under the new shared model, as-is.
 *
 * For each (kind, name) group, the unarchived-preferred, earliest-created row
 * survives; every other row in the group is a "duplicate": its subcategories
 * are reparented to the survivor, every transaction/budget pointing at it is
 * repointed to the survivor, and the now-unreferenced duplicate is SOFT-
 * deleted (`deleted_at`, same as CategoryModel's normal remove) rather than
 * hard-deleted. That matters here specifically: a hard delete only "vanishes"
 * cleanly for a device doing a full resync (no `?since=` cursor yet) — any
 * device that already has one would never see it, since the delta query
 * (`WHERE updated_at > $1`) can't return a row that no longer exists at all.
 * A tombstone rides the normal incremental sync instead, so every
 * already-synced device picks up the merge on its next regular sync, no
 * manual "Оновити дані із сервера" required.
 * Runs inside node-pg-migrate's implicit per-migration transaction, so it's
 * all-or-nothing.
 */

const schema = 'fin'

/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.sql(`
    CREATE TEMP TABLE category_merge_map AS
    SELECT
      id AS dup_id,
      first_value(id) OVER (
        PARTITION BY kind, name
        ORDER BY archived ASC, created_at ASC, id ASC
      ) AS survivor_id
    FROM ${schema}.categories
    WHERE is_default = true AND parent_id IS NULL AND deleted_at IS NULL;

    DELETE FROM category_merge_map WHERE dup_id = survivor_id;

    -- Reparent subcategories that belonged to a duplicate top-level category.
    UPDATE ${schema}.categories c
    SET parent_id = m.survivor_id, updated_at = current_timestamp
    FROM category_merge_map m
    WHERE c.parent_id = m.dup_id;

    -- Repoint every transaction referencing a duplicate (as category or subcategory).
    UPDATE ${schema}.transactions t
    SET category_id = m.survivor_id, updated_at = current_timestamp
    FROM category_merge_map m
    WHERE t.category_id = m.dup_id;

    UPDATE ${schema}.transactions t
    SET subcategory_id = m.survivor_id, updated_at = current_timestamp
    FROM category_merge_map m
    WHERE t.subcategory_id = m.dup_id;

    -- Repoint personal budgets (budgets stay per-owner; each owner had at
    -- most one duplicate per (kind, name) group, so this can't collide two
    -- of the same owner's budgets onto one category_id).
    UPDATE ${schema}.budgets b
    SET category_id = m.survivor_id, updated_at = current_timestamp
    FROM category_merge_map m
    WHERE b.category_id = m.dup_id;

    -- Nothing references the duplicates anymore — tombstone them (soft
    -- delete) so already-synced devices pick up the removal through their
    -- normal incremental sync instead of only on a full resync.
    UPDATE ${schema}.categories c
    SET deleted_at = current_timestamp, updated_at = current_timestamp
    FROM category_merge_map m
    WHERE c.id = m.dup_id;

    DROP TABLE category_merge_map;
  `)
}

// Not meaningfully reversible: the duplicate category rows themselves are
// only soft-deleted (recoverable in principle), but which transaction/budget
// used to point at which duplicate isn't tracked anywhere, and the
// frontend/backend permission model this migration accompanies no longer
// supports per-owner categories anyway.
export const down = (pgm) => {}
