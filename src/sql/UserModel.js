import pg from '#util/pg'

class UserModel {
  /**
   * Чи існує хоч один користувач. Порожня таблиця means "нікого ще не
   * запровадили" — саме цей момент дозволяє authGoogle авто-створити
   * першого власника (див. src/middleware/auth.js).
   * @returns {Promise<boolean>}
   */
  static async anyExists() {
    const result = await pg.query('SELECT EXISTS(SELECT 1 FROM users) AS exists')
    return result.rows[0].exists
  }

  /**
   * Отримання користувача за Email (ключовий пошук для логіну).
   * @returns {Promise<Object|undefined>}
   */
  static async getByEmail({ email }) {
    const query = `SELECT * FROM users WHERE email = $1`
    const result = await pg.query(query, [email])
    return result.rows[0]
  }

  static async getById({ id }) {
    const query = `SELECT * FROM users WHERE id = $1`
    const result = await pg.query(query, [id])
    return result.rows[0]
  }

  /**
   * Всі користувачі (для адмінки), новіші — першими.
   * @returns {Promise<Object[]>}
   */
  static async getAll() {
    const query = `SELECT * FROM users ORDER BY created_at DESC`
    const result = await pg.query(query)
    return result.rows
  }

  /**
   * Мінімальний публічний довідник родини (для будь-якого автентифікованого
   * користувача, не тільки адміна) — підписи контрагента переказу, аватарки
   * в пікерах тощо. Без email/role — це не для адмінки.
   * @returns {Promise<Object[]>}
   */
  static async listActiveDirectory() {
    const query = `
      SELECT id, display_name, photo_url, color
      FROM users
      WHERE is_active = true
      ORDER BY created_at
    `
    const result = await pg.query(query)
    return result.rows
  }

  /**
   * Створення користувача — або bootstrap першого власника з authGoogle
   * (id/email/display_name/photo_url/color з Google-токена), або
   * pre-provision адміном (тільки email, решта — заглушки, до першого
   * логіну цієї людини). Разом створює рядок app_settings (1:1, дефолти) —
   * єдиним запитом, щоб не лишити користувача без налаштувань.
   * @returns {Promise<Object>}
   */
  static async create({ id, email, displayName, photoUrl = null, color, role = 'member', isActive = true }) {
    const query = `
      WITH new_user AS (
        INSERT INTO users (id, email, display_name, photo_url, color, role, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      ), new_settings AS (
        INSERT INTO app_settings (user_id) SELECT id FROM new_user
      )
      SELECT * FROM new_user
    `
    const values = [id, email, displayName, photoUrl, color, role, isActive]
    const result = await pg.query(query, values)
    return result.rows[0]
  }

  /**
   * Оновлення профільних полів (наприклад, підхопити нове фото/ім'я з Google
   * при черговому вході).
   * @returns {Promise<Object|undefined>}
   */
  static async update({ id, displayName, photoUrl, color }) {
    const query = `
      UPDATE users
      SET
        display_name = COALESCE($2, display_name),
        photo_url = COALESCE($3, photo_url),
        color = COALESCE($4, color),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `
    const result = await pg.query(query, [id, displayName, photoUrl, color])
    return result.rows[0]
  }

  /**
   * Адмінське керування: роль і активність (доступ вимикається без видалення
   * даних користувача).
   * @returns {Promise<Object|undefined>}
   */
  static async setRoleAndActive({ id, role, isActive }) {
    const query = `
      UPDATE users
      SET
        role = COALESCE($2, role),
        is_active = COALESCE($3, is_active),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `
    const result = await pg.query(query, [id, role, isActive])
    return result.rows[0]
  }
}

export default UserModel
