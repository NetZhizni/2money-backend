import pg from '#util/pg'
import { buildPatchSet, listAll as listAllRows, listOwned, softDelete } from './syncable.js'

class RecurringTemplateModel {
  /** @returns {Promise<Object>} */
  static async upsert({
    id,
    ownerId,
    type,
    accountId,
    toAccountId = null,
    categoryId = null,
    subcategoryId = null,
    amount,
    currency,
    note = null,
    frequency,
    interval = 1,
    startDate,
    endDate = null,
    nextDate,
    active = true,
  }) {
    const query = `
      INSERT INTO recurring_templates (
        id, owner_id, type, account_id, to_account_id, category_id, subcategory_id,
        amount, currency, note, frequency, interval, start_date, end_date, next_date, active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      ON CONFLICT (id) DO UPDATE SET
        type = EXCLUDED.type,
        account_id = EXCLUDED.account_id,
        to_account_id = EXCLUDED.to_account_id,
        category_id = EXCLUDED.category_id,
        subcategory_id = EXCLUDED.subcategory_id,
        amount = EXCLUDED.amount,
        currency = EXCLUDED.currency,
        note = EXCLUDED.note,
        frequency = EXCLUDED.frequency,
        interval = EXCLUDED.interval,
        start_date = EXCLUDED.start_date,
        end_date = EXCLUDED.end_date,
        next_date = EXCLUDED.next_date,
        active = EXCLUDED.active,
        updated_at = CURRENT_TIMESTAMP,
        deleted_at = NULL
      WHERE recurring_templates.owner_id = EXCLUDED.owner_id
      RETURNING *
    `
    const values = [
      id, ownerId, type, accountId, toAccountId, categoryId, subcategoryId,
      amount, currency, note, frequency, interval, startDate, endDate, nextDate, active,
    ]
    const result = await pg.query(query, values)
    return result.rows[0]
  }

  static async listForOwner({ ownerId, since }) {
    return listOwned('recurring_templates', ownerId, since)
  }

  /**
   * Шаблони всієї родини (`?scope=all`) — щоб перегляд "витрат іншого
   * користувача" міг показати і його регулярні платежі, не лише вже
   * згенеровані транзакції. Активні-тільки при першому завантаженні,
   * дельта (разом із tombstone-записами) за `since`.
   */
  static async listAll({ since } = {}) {
    return listAllRows('recurring_templates', since)
  }

  static async patch({ id, ownerId, ...fields }) {
    const { setClauses, values } = buildPatchSet(fields, 3)
    if (!setClauses.length) {
      const result = await pg.query(
        `SELECT * FROM recurring_templates WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
        [id, ownerId],
      )
      return result.rows[0]
    }
    const query = `
      UPDATE recurring_templates
      SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL
      RETURNING *
    `
    const result = await pg.query(query, [id, ownerId, ...values])
    return result.rows[0]
  }

  static async remove({ id, ownerId }) {
    return softDelete('recurring_templates', id, ownerId)
  }
}

export default RecurringTemplateModel
