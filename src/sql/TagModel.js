import pg from '#util/pg'
import { buildPatchSet, listAll as listAllRows, softDeleteAny } from './syncable.js'

/**
 * Tags are a shared family resource, exactly like categories (see
 * CategoryModel's own doc comment) — any active member sees and can
 * create/edit/delete the same list, so `owner_id` here is create-time
 * provenance only, never an access filter.
 */
class TagModel {
  /** @returns {Promise<Object>} */
  static async upsert({ id, ownerId, name, color }) {
    const query = `
      INSERT INTO tags (id, owner_id, name, color)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        color = EXCLUDED.color,
        updated_at = CURRENT_TIMESTAMP,
        deleted_at = NULL
      RETURNING *
    `
    const result = await pg.query(query, [id, ownerId, name, color])
    return result.rows[0]
  }

  /** The whole family's tags, no owner filter — active-only on first load, delta (incl. tombstones) with `since`. */
  static async listAll({ since } = {}) {
    return listAllRows('tags', since)
  }

  static async patch({ id, ownerId: _ownerId, ...fields }) {
    const { setClauses, values } = buildPatchSet(fields, 2)
    if (!setClauses.length) {
      const result = await pg.query(`SELECT * FROM tags WHERE id = $1 AND deleted_at IS NULL`, [id])
      return result.rows[0]
    }
    const query = `
      UPDATE tags
      SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING *
    `
    const result = await pg.query(query, [id, ...values])
    return result.rows[0]
  }

  static async remove({ id }) {
    return softDeleteAny('tags', id)
  }
}

export default TagModel
