import pg from '#util/pg'
import { buildPatchSet, listAll as listAllRows, softDeleteAny } from './syncable.js'

/**
 * Categories are a shared family resource, unlike every other syncable
 * entity (accounts/transactions/recurring_templates/budgets stay per-owner)
 * — any active member sees and can create/edit/archive the same list, so
 * `owner_id` here is create-time provenance only, never an access filter
 * (see the merge-shared-categories migration for how the old per-owner
 * copies were consolidated into this model).
 */
class CategoryModel {
  /** @returns {Promise<Object>} */
  static async upsert({
    id,
    ownerId,
    name,
    kind,
    icon,
    color,
    parentId = null,
    archived = false,
    order = 0,
    isDefault = false,
  }) {
    const query = `
      INSERT INTO categories (
        id, owner_id, name, kind, icon, color, parent_id, archived, "order", is_default
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        kind = EXCLUDED.kind,
        icon = EXCLUDED.icon,
        color = EXCLUDED.color,
        parent_id = EXCLUDED.parent_id,
        archived = EXCLUDED.archived,
        "order" = EXCLUDED."order",
        is_default = EXCLUDED.is_default,
        updated_at = CURRENT_TIMESTAMP,
        deleted_at = NULL
      RETURNING *
    `
    const values = [id, ownerId, name, kind, icon, color, parentId, archived, order, isDefault]
    const result = await pg.query(query, values)
    return result.rows[0]
  }

  /**
   * The whole family's categories, no owner filter — both the plain pull and
   * the legacy `?scope=all` pull resolve here now (see listCategories.js).
   * Active-only on first load, delta (incl. tombstones) with `since`.
   */
  static async listAll({ since } = {}) {
    return listAllRows('categories', since)
  }

  static async patch({ id, ownerId: _ownerId, ...fields }) {
    const { setClauses, values } = buildPatchSet(fields, 2)
    if (!setClauses.length) {
      const result = await pg.query(`SELECT * FROM categories WHERE id = $1 AND deleted_at IS NULL`, [id])
      return result.rows[0]
    }
    const query = `
      UPDATE categories
      SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING *
    `
    const result = await pg.query(query, [id, ...values])
    return result.rows[0]
  }

  static async remove({ id }) {
    return softDeleteAny('categories', id)
  }
}

export default CategoryModel
