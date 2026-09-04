import pg from '#util/pg'
import { buildPatchSet, listAll as listAllRows } from './syncable.js'

class TransactionModel {
  /** @returns {Promise<Object>} */
  static async upsert({
    id,
    ownerId,
    participantIds,
    type,
    date,
    accountId,
    toAccountId = null,
    categoryId = null,
    subcategoryId = null,
    amount,
    toAmount = null,
    currency,
    note = null,
    templateId = null,
    receiptId = null,
  }) {
    const query = `
      INSERT INTO transactions (
        id, owner_id, participant_ids, type, date, account_id, to_account_id,
        category_id, subcategory_id, amount, to_amount, currency,
        note, template_id, receipt_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT (id) DO UPDATE SET
        participant_ids = EXCLUDED.participant_ids,
        type = EXCLUDED.type,
        date = EXCLUDED.date,
        account_id = EXCLUDED.account_id,
        to_account_id = EXCLUDED.to_account_id,
        category_id = EXCLUDED.category_id,
        subcategory_id = EXCLUDED.subcategory_id,
        amount = EXCLUDED.amount,
        to_amount = EXCLUDED.to_amount,
        currency = EXCLUDED.currency,
        note = EXCLUDED.note,
        template_id = EXCLUDED.template_id,
        receipt_id = EXCLUDED.receipt_id,
        updated_at = CURRENT_TIMESTAMP,
        deleted_at = NULL
      WHERE transactions.owner_id = EXCLUDED.owner_id
      RETURNING *
    `
    const values = [
      id, ownerId, participantIds, type, date, accountId, toAccountId,
      categoryId, subcategoryId, amount, toAmount, currency,
      note, templateId, receiptId,
    ]
    const result = await pg.query(query, values)
    return result.rows[0]
  }

  /** Чи існує (активна) транзакція, що торкається цього рахунку — блокує зміну його валюти. */
  static async existsForAccount({ accountId }) {
    const result = await pg.query(
      `SELECT 1 FROM transactions
       WHERE (account_id = $1 OR to_account_id = $1) AND deleted_at IS NULL
       LIMIT 1`,
      [accountId],
    )
    return result.rowCount > 0
  }

  /** Чи існує (активна) транзакція проти цієї категорії (чи як підкатегорії) — блокує зміну її валюти. */
  static async existsForCategory({ categoryId }) {
    const result = await pg.query(
      `SELECT 1 FROM transactions
       WHERE (category_id = $1 OR subcategory_id = $1) AND deleted_at IS NULL
       LIMIT 1`,
      [categoryId],
    )
    return result.rowCount > 0
  }

  /**
   * Найпоширеніша валюта серед УСІХ (усієї родини) операцій, уже заведених
   * проти цієї (верхньорівневої) категорії — використовується, щоб дати їй
   * розумну валюту замість сліпого фолбеку на базову валюту власника (див.
   * upsertCategory.js): категорія, по якій завжди були лише операції в USD,
   * не повинна мовчки стати "базовою валютою".
   * @returns {Promise<string|undefined>}
   */
  static async getDominantCurrencyForCategory({ categoryId }) {
    const result = await pg.query(
      `SELECT currency FROM transactions
       WHERE category_id = $1 AND deleted_at IS NULL
       GROUP BY currency
       ORDER BY COUNT(*) DESC
       LIMIT 1`,
      [categoryId],
    )
    return result.rows[0]?.currency
  }

  /**
   * Видимі користувачу транзакції — свої, і ті, де він контрагент переказу
   * (`participant_ids` покриває обидва випадки). Без `since` — тільки активні.
   * @returns {Promise<Object[]>}
   */
  static async listForParticipant({ userId, since }) {
    if (since) {
      const result = await pg.query(
        `SELECT * FROM transactions WHERE $1 = ANY(participant_ids) AND updated_at > $2 ORDER BY updated_at`,
        [userId, since],
      )
      return result.rows
    }
    const result = await pg.query(
      `SELECT * FROM transactions WHERE $1 = ANY(participant_ids) AND deleted_at IS NULL ORDER BY date DESC, created_at DESC`,
      [userId],
    )
    return result.rows
  }

  /**
   * Transactions across the WHOLE family (`?scope=all`) — combined-balance
   * breakdown (TotalBalanceView). Active-only on first load, delta (incl.
   * tombstones) with `since`, same contract as `listForParticipant`.
   */
  static async listAll({ since } = {}) {
    return listAllRows('transactions', since)
  }

  static async patch({ id, ownerId, ...fields }) {
    const { setClauses, values } = buildPatchSet(fields, 3)
    if (!setClauses.length) {
      const result = await pg.query(
        `SELECT * FROM transactions WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
        [id, ownerId],
      )
      return result.rows[0]
    }
    const query = `
      UPDATE transactions
      SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL
      RETURNING *
    `
    const result = await pg.query(query, [id, ownerId, ...values])
    return result.rows[0]
  }

  static async remove({ id, ownerId }) {
    const result = await pg.query(
      `UPDATE transactions
       SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
      [id, ownerId],
    )
    return result.rowCount > 0
  }

  /** Каскад при видаленні рахунку: ховає всі транзакції, що його торкались. */
  static async removeByAccount({ ownerId, accountId }) {
    const result = await pg.query(
      `UPDATE transactions
       SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE owner_id = $1 AND deleted_at IS NULL AND (account_id = $2 OR to_account_id = $2)`,
      [ownerId, accountId],
    )
    return result.rowCount
  }
}

export default TransactionModel
