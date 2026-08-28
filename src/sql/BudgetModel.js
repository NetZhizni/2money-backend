import pg from '#util/pg'
import { buildPatchSet, listAll as listAllRows, listOwned, softDelete } from './syncable.js'

class BudgetModel {
  /** @returns {Promise<Object>} */
  static async upsert({ id, ownerId, categoryId, amount, currency, period = 'monthly' }) {
    const query = `
      INSERT INTO budgets (id, owner_id, category_id, amount, currency, period)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (id) DO UPDATE SET
        category_id = EXCLUDED.category_id,
        amount = EXCLUDED.amount,
        currency = EXCLUDED.currency,
        period = EXCLUDED.period,
        updated_at = CURRENT_TIMESTAMP,
        deleted_at = NULL
      WHERE budgets.owner_id = EXCLUDED.owner_id
      RETURNING *
    `
    const values = [id, ownerId, categoryId, amount, currency, period]
    const result = await pg.query(query, values)
    return result.rows[0]
  }

  static async listForOwner({ ownerId, since }) {
    return listOwned('budgets', ownerId, since)
  }

  /**
   * Бюджети всієї родини (`?scope=all`) — для сімейного бюджету (сума
   * бюджетів по категорії з усіх профілів). Активні-тільки при першому
   * завантаженні, дельта (разом із tombstone-записами) за `since`.
   */
  static async listAll({ since } = {}) {
    return listAllRows('budgets', since)
  }

  static async patch({ id, ownerId, ...fields }) {
    const { setClauses, values } = buildPatchSet(fields, 3)
    if (!setClauses.length) {
      const result = await pg.query(
        `SELECT * FROM budgets WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
        [id, ownerId],
      )
      return result.rows[0]
    }
    const query = `
      UPDATE budgets
      SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL
      RETURNING *
    `
    const result = await pg.query(query, [id, ownerId, ...values])
    return result.rows[0]
  }

  static async remove({ id, ownerId }) {
    return softDelete('budgets', id, ownerId)
  }
}

export default BudgetModel
