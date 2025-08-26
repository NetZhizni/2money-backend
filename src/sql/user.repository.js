import pg from '../util/pg.js'
import axios from 'axios'

const BASE_CURRENCY = process.env.BASE_CURRENCY

class UserRepository {
  static async updatePhoto({ picture }) {
    try {
      if (picture) {
        const response = await axios({
          method: 'GET',
          url: picture,
          responseType: 'arraybuffer', // Завантажуємо дані як "сирий" буфер
        })
        const base64Image = Buffer.from(response.data, 'binary').toString('base64')
        return base64Image
      }
    } catch (error) {
      console.log('error', error)
    }
  }

  /**
   * Знаходить користувача за email
   * @param {string} email
   * @returns {Promise<Object|null>}
   */
  static async findByEmail(email) {
    const result = await pg.query(
      `
      SELECT us.*,
      (CURRENT_DATE - updated_at::date) > 21 AS isNeedUpdatePhoto
      FROM users us
      WHERE us.email = $1
      LIMIT 1`,
      [email],
    )
    return result.rows[0] || null
  }

  /**
   * Додає нового користувача
   * @param {Object} user
   * @param {string} user.first_name
   * @param {string} user.last_name
   * @param {string} user.email
   * @param {string} [user.photo]
   * @param {string} [user.base_currency] - код валюти, напр. "UAH"
   * @returns {Promise<Object>} - створений користувач
   */
  static async createUser({ first_name, last_name, email, base_currency }, picture) {
    const photo = await UserRepository.updatePhoto({ picture, isNeedUpdatePhoto: true })
    const result = await pg.query(
      `
      INSERT INTO users (first_name, last_name, email, photo, base_currency)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
      `,
      [first_name, last_name, email, photo || null, base_currency || BASE_CURRENCY],
    )
    return result.rows[0]
  }

  /**
   * Оновлює користувача
   * @param {number} id - ID користувача
   * @param {Object} updates - поля, які треба оновити
   * @returns {Promise<Object>} - оновлений користувач
   */
  static async updateUser(id, updates) {
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

    fields.push(`updated_at = NOW()`)

    values.push(id) // для WHERE
    const result = await pg.query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
      values,
    )

    return result.rows[0]
  }
}

export default UserRepository
