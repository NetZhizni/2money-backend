import pg from '#util/pg'
import { buildPatchSet, listAll as listAllRows, listOwned, softDelete } from './syncable.js'

/**
 * A receipt is purely a grouping label for the transactions saved from one
 * scanned photo (see #services/receipt/scanReceipt, which itself writes
 * nothing) — `merchant`/`date`/`currency` here are the same fields Gemini
 * extracted, just persisted once the user actually keeps at least one
 * operation from the scan, instead of living only in the scan response.
 */
class ReceiptModel {
  /** @returns {Promise<Object>} */
  static async upsert({ id, ownerId, merchant = null, date = null, currency = null, note = null, accountId = null }) {
    const query = `
      INSERT INTO receipts (id, owner_id, merchant, date, currency, note, account_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO UPDATE SET
        merchant = EXCLUDED.merchant,
        date = EXCLUDED.date,
        currency = EXCLUDED.currency,
        note = EXCLUDED.note,
        account_id = EXCLUDED.account_id,
        updated_at = CURRENT_TIMESTAMP,
        deleted_at = NULL
      WHERE receipts.owner_id = EXCLUDED.owner_id
      RETURNING *
    `
    const values = [id, ownerId, merchant, date, currency, note, accountId]
    const result = await pg.query(query, values)
    return result.rows[0]
  }

  static async listForOwner({ ownerId, since }) {
    return listOwned('receipts', ownerId, since)
  }

  /** Усі чеки родини (`?scope=all`) — так само, як TransactionModel.listAll: чек видно всім, кому видно транзакції, що на нього посилаються. */
  static async listAll({ since } = {}) {
    return listAllRows('receipts', since)
  }

  static async patch({ id, ownerId, ...fields }) {
    const { setClauses, values } = buildPatchSet(fields, 3)
    if (!setClauses.length) {
      const result = await pg.query(
        `SELECT * FROM receipts WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
        [id, ownerId],
      )
      return result.rows[0]
    }
    const query = `
      UPDATE receipts
      SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL
      RETURNING *
    `
    const result = await pg.query(query, [id, ownerId, ...values])
    return result.rows[0]
  }

  static async remove({ id, ownerId }) {
    return softDelete('receipts', id, ownerId)
  }
}

export default ReceiptModel
