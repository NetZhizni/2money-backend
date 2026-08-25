import pg from '#util/pg'
import { buildPatchSet, listOwned, softDelete } from './syncable.js'

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
      WHERE categories.owner_id = EXCLUDED.owner_id
      RETURNING *
    `
    const values = [id, ownerId, name, kind, icon, color, parentId, archived, order, isDefault]
    const result = await pg.query(query, values)
    return result.rows[0]
  }

  static async listForOwner({ ownerId, since }) {
    return listOwned('categories', ownerId, since)
  }

  static async patch({ id, ownerId, ...fields }) {
    const { setClauses, values } = buildPatchSet(fields, 3)
    if (!setClauses.length) {
      const result = await pg.query(
        `SELECT * FROM categories WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
        [id, ownerId],
      )
      return result.rows[0]
    }
    const query = `
      UPDATE categories
      SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL
      RETURNING *
    `
    const result = await pg.query(query, [id, ownerId, ...values])
    return result.rows[0]
  }

  static async remove({ id, ownerId }) {
    return softDelete('categories', id, ownerId)
  }
}

export default CategoryModel
