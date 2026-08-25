import pg from '#util/pg'
import { buildPatchSet, listOwned, softDelete } from './syncable.js'

class AccountModel {
  /**
   * Створення/перезапис рахунку. id завжди приходить з клієнта (UUIDv7,
   * згенерований офлайн) — ON CONFLICT DO UPDATE робить повтор запиту з
   * outbox (після втрати мережі) безпечним (ідемпотентним).
   * @returns {Promise<Object>}
   */
  static async upsert({
    id,
    ownerId,
    name,
    type,
    currency,
    icon,
    color,
    initialBalance = 0,
    loanDirection = null,
    includeInTotal = true,
    archived = false,
    order = 0,
    note = null,
  }) {
    const query = `
      INSERT INTO accounts (
        id, owner_id, name, type, currency, icon, color,
        initial_balance, loan_direction, include_in_total, archived, "order", note
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        type = EXCLUDED.type,
        currency = EXCLUDED.currency,
        icon = EXCLUDED.icon,
        color = EXCLUDED.color,
        initial_balance = EXCLUDED.initial_balance,
        loan_direction = EXCLUDED.loan_direction,
        include_in_total = EXCLUDED.include_in_total,
        archived = EXCLUDED.archived,
        "order" = EXCLUDED."order",
        note = EXCLUDED.note,
        updated_at = CURRENT_TIMESTAMP,
        deleted_at = NULL
      WHERE accounts.owner_id = EXCLUDED.owner_id
      RETURNING *
    `
    const values = [
      id, ownerId, name, type, currency, icon, color,
      initialBalance, loanDirection, includeInTotal, archived, order, note,
    ]
    const result = await pg.query(query, values)
    return result.rows[0]
  }

  /** Власні рахунки (за замовчуванням) — активні, або дельта за `since`. */
  static async listForOwner({ ownerId, since }) {
    return listOwned('accounts', ownerId, since)
  }

  /** Власник рахунку — потрібен, щоб серверно (не довіряючи клієнту) визначити
   * учасників міжпрофільного переказу (див. transaction/upsertTransaction.js). */
  static async getOwnerId({ id }) {
    const result = await pg.query(`SELECT owner_id FROM accounts WHERE id = $1`, [id])
    return result.rows[0]?.owner_id
  }

  /** Активні рахунки всієї родини (`?scope=all`) — для пікера переказів і сукупного балансу. */
  static async listAllActive() {
    const result = await pg.query(`SELECT * FROM accounts WHERE deleted_at IS NULL ORDER BY created_at`)
    return result.rows
  }

  static async patch({ id, ownerId, ...fields }) {
    const { setClauses, values } = buildPatchSet(fields, 3)
    if (!setClauses.length) {
      const result = await pg.query(
        `SELECT * FROM accounts WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
        [id, ownerId],
      )
      return result.rows[0]
    }
    const query = `
      UPDATE accounts
      SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL
      RETURNING *
    `
    const result = await pg.query(query, [id, ownerId, ...values])
    return result.rows[0]
  }

  static async remove({ id, ownerId }) {
    return softDelete('accounts', id, ownerId)
  }
}

export default AccountModel
