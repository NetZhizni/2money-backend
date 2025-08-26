import pg from '../util/pg.js'

class AccountRepository {
  static async accountGetExpenses({ ownerId }) {
    const result = await pg.query(
      `
      SELECT
      a.id,
      a.name,
      a.currency,
      a.icon,
      a.color,
      a.owner_id,
      a.account_type_id,
      a.is_archive,
      COALESCE(SUM(
        CASE 
          WHEN t.from_account_id = a.id AND a2.owner_id = $1 THEN -t.from_amount
          WHEN t.to_account_id = a.id AND a2.owner_id = $1 THEN t.to_amount
          ELSE 0
        END
      ), 0) AS balance
      FROM accounts a
      LEFT JOIN transactions t ON t.to_account_id = a.id
      LEFT JOIN accounts a2 ON t.from_account_id = a2.id
      WHERE a.account_type_id = 5
      GROUP BY 
      a.id,
      a.name,
      a.currency,
      a.icon,
      a.color,
      a.owner_id,
      a.account_type_id,
      a.is_archive
      ORDER BY id DESC
      `,
      [ownerId],
    )

    return result.rows
  }

  static async accountGetIncome({ ownerId }) {
    const result = await pg.query(
      `
      SELECT
      a.id,
      a.name,
      a.currency,
      a.icon,
      a.color,
      a.owner_id,
      a.account_type_id,
      a.is_archive,
      COALESCE(SUM(
        CASE 
          WHEN t.from_account_id = a.id AND a2.owner_id = $1 THEN -t.from_amount
          WHEN t.to_account_id = a.id AND a2.owner_id = $1 THEN t.to_amount
          ELSE 0
        END
      ), 0) AS balance
      FROM accounts a
      LEFT JOIN transactions t ON t.from_account_id = a.id
      LEFT JOIN accounts a2 ON t.to_account_id = a2.id
      WHERE a.account_type_id = 4
      GROUP BY 
      a.id,
      a.name,
      a.currency,
      a.icon,
      a.color,
      a.owner_id,
      a.account_type_id,
      a.is_archive
      ORDER BY id DESC
      `,
      [ownerId],
    )

    return result.rows
  }

  static async accountGetNotMyWallets({ ownerId, accountTypeId }) {
    const result = await pg.query(
      `
      SELECT
      us.last_name,
      us.first_name,
      a.id,
      a.name,
      a.currency,
      a.icon,
      a.color,
      a.owner_id,
      a.account_type_id,
      a.is_archive,
      COALESCE(SUM(
        CASE 
          WHEN t.from_account_id = a.id AND a.owner_id != $2 THEN -t.from_amount
          WHEN t.to_account_id = a.id AND a.owner_id != $2 THEN t.to_amount
          ELSE 0
        END
      ), 0) AS balance
      FROM accounts a
      LEFT JOIN transactions t ON t.from_account_id = a.id or t.to_account_id = a.id
      JOIN users us ON us.id = a.owner_id
      WHERE 1=1
      AND a.owner_id != $2
      AND a.account_type_id = ANY ($1)
      GROUP BY 
      us.last_name,
      us.first_name,
      a.id,
      a.name,
      a.currency,
      a.icon,
      a.color,
      a.owner_id,
      a.account_type_id,
      a.is_archive
      ORDER BY id DESC
    `,
      [accountTypeId, ownerId],
    )
    return result.rows
  }

  /**
   * Знаходить рахунок по одному або кількох параметрах
   * @param {Object} filters
   * @param {number} [filters.id]
   * @param {string} [filters.date] - формат YYYY-MM-DD або ISO (для `::date`)
   * @param {number} [filters.owner_id]
   * @param {string} [filters.currency]
   * @param {number} [filters.account_type_id]
   * @param {boolean} [filters.is_archive]
   * @returns {Promise<Object[]>}
   */
  static async findAccount(filters = {}) {
    const account_type_id = filters.account_type_id
    const owner_id = filters.owner_id

    const result = await pg.query(
      `
      SELECT
      a.id,
      a.name,
      a.currency,
      a.icon,
      a.color,
      a.owner_id,
      a.account_type_id,
      a.is_archive,
      COALESCE(SUM(
        CASE 
          WHEN t.from_account_id = a.id AND a.owner_id = $2 THEN -t.from_amount
          WHEN t.to_account_id = a.id AND a.owner_id = $2 THEN t.to_amount
          ELSE 0
        END
      ), 0) AS balance
      FROM accounts a
      LEFT JOIN transactions t ON t.from_account_id = a.id or t.to_account_id = a.id
      WHERE 1=1
      AND a.owner_id = $2
      AND a.account_type_id = ANY ($1)
      GROUP BY 
      a.id,
      a.name,
      a.currency,
      a.icon,
      a.color,
      a.owner_id,
      a.account_type_id,
      a.is_archive
      ORDER BY id DESC
      `,
      [account_type_id, owner_id],
    )

    return result.rows
  }

  /**
   * Додає новий рахунок
   * @param {Object} account
   * @param {string} account.name
   * @param {string} account.currency - код валюти (наприклад 'UAH')
   * @param {number} account.owner_id
   * @param {number} account.account_type_id
   * @param {number} [account.initial_balance]
   * @param {string} [account.icon]
   * @param {string} [account.color]
   * @param {boolean} [account.is_archive]
   * @returns {Promise<Object>}
   */
  static async createAccount(account) {
    const {
      name,
      currency,
      owner_id,
      account_type_id,
      initial_balance = 0,
      icon = null,
      color = null,
    } = account

    const result = await pg.query(
      `
      INSERT INTO accounts
        (name, currency, initial_balance, icon, color, owner_id, account_type_id)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
      `,
      [name, currency, initial_balance, icon, color, owner_id, account_type_id],
    )

    return result.rows[0]
  }

  /**
   * Оновлює рахунок
   * @param {number} id - ID рахунку
   * @param {number} ownerId - ID власника (для безпеки)
   * @param {Object} updates - поля, які треба оновити
   * @returns {Promise<Object>}
   */
  static async updateAccount(id, ownerId, updates) {
    const fields = []
    const values = []
    let i = 1

    for (const key in updates) {
      fields.push(`${key} = $${i}`)
      values.push(updates[key])
      i++
    }

    if (fields.length === 0) {
      throw new Error('Немає полів для оновлення')
    }

    values.push(id) // $i → id
    values.push(ownerId) // $i+1 → owner_id

    const result = await pg.query(
      `
      UPDATE accounts
      SET ${fields.join(', ')}
      WHERE id = $${i} AND owner_id = $${i + 1}
      RETURNING *
      `,
      values,
    )

    return result.rows[0]
  }
}

export default AccountRepository
