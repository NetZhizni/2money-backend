import pg from '../util/pg.js'

class TransactionRepository {
  /**
   * Знаходить операції по одному або кількох параметрах
   * @param {Object} filters
   * @param {number} [filters.id]
   * @param {string} [filters.date] - формат YYYY-MM-DD або ISO (для `::date`)
   * @param {number} [filters.operation_type_id]
   * @param {number} [filters.from_account_id]
   * @param {number} [filters.to_account_id]
   * @returns {Promise<Object[]>}
   */
  static async findTransactions({ ownerId }) {
    const result = await pg.query(
      `
      SELECT 
        t.*,
        froma.name as from_account_name,
        froma.icon as from_account_icon,
        froma.color as from_account_color,
        froma.currency as from_account_currency,
        froma.account_type_id as from_account_type_id,
        froma.owner_id as from_owner_id,
        toa.name as to_account_name,
        toa.icon as to_account_icon,
        toa.color as to_account_color,
        toa.currency as to_account_currency,
        toa.account_type_id as to_account_type_id,
        toa.owner_id as to_owner_id
      FROM transactions t
      join accounts froma on froma.id = t.from_account_id
      join accounts toa on toa.id = t.to_account_id
      WHERE
      (toa.owner_id = $1 AND t.operation_type_id = 1)
      OR
      (froma.owner_id = $1 AND t.operation_type_id = 2)
      OR
      (froma.owner_id = $1 AND t.operation_type_id = 3)
      OR
      (toa.owner_id = $1 AND t.operation_type_id = 3)
      ORDER BY id DESC
      `,
      [ownerId],
    )

    return result.rows
  }

  /**
   * Додає нову операцію
   * @param {Object} tx
   * @param {string} tx.date
   * @param {number} tx.operation_type_id
   * @param {number} tx.from_account_id
   * @param {number} tx.from_amount
   * @param {number} tx.to_account_id
   * @param {number} tx.to_amount
   * @param {string} tx.comment
   * @returns {Promise<Object>}
   */
  static async createTransaction(tx) {
    const {
      date = null,
      operation_type_id,
      from_account_id,
      from_amount,
      to_account_id,
      to_amount,
      comment = null,
    } = tx

    const result = await pg.query(
      `
      INSERT INTO transactions
        (date, operation_type_id, from_account_id, from_amount, to_account_id, to_amount, comment)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
      `,
      [date, operation_type_id, from_account_id, from_amount, to_account_id, to_amount, comment],
    )

    return result.rows[0]
  }

  /**
   * Оновлює операцію по id
   * @param {number} id
   * @param {Object} updates
   * @param {string} updates.date
   * @param {number} updates.operation_type_id
   * @param {number} updates.from_account_id
   * @param {number} updates.from_amount
   * @param {number} updates.to_account_id
   * @param {number} updates.to_amount
   * @param {string} updates.comment
   * @returns {Promise<Object>}
   */
  static async updateTransaction(id, updates) {
    const fields = []
    const values = []
    let i = 1

    for (const [key, val] of Object.entries(updates)) {
      fields.push(`${key} = $${i}`)
      values.push(val)
      i++
    }

    if (fields.length === 0) {
      throw new Error('Немає полів для оновлення')
    }

    values.push(id) // $i — id

    const result = await pg.query(
      `
      UPDATE transactions
      SET ${fields.join(', ')}
      WHERE id = $${i}
      RETURNING *
      `,
      values,
    )

    return result.rows[0]
  }

  /**
   * Видаляє операцію по id
   * @param {number} id
   * @returns {Promise<void>}
   */
  static async deleteTransaction(id) {
    await pg.query('DELETE FROM transactions WHERE id = $1', [id])
  }
}

export default TransactionRepository
