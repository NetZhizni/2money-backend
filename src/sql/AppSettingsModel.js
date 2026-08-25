import pg from '#util/pg'

class AppSettingsModel {
  /**
   * @returns {Promise<Object|undefined>}
   */
  static async getByUserId({ userId }) {
    const query = `SELECT * FROM app_settings WHERE user_id = $1`
    const result = await pg.query(query, [userId])
    return result.rows[0]
  }

  /**
   * Частковий апдейт налаштувань профілю. Рядок завжди вже існує (створений
   * разом з users у UserModel.create), тому тут лише COALESCE-оновлення.
   * @returns {Promise<Object|undefined>}
   */
  static async update({ userId, baseCurrency, theme, onboarded }) {
    const query = `
      UPDATE app_settings
      SET
        base_currency = COALESCE($2, base_currency),
        theme = COALESCE($3, theme),
        onboarded = COALESCE($4, onboarded),
        updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
      RETURNING *
    `
    const result = await pg.query(query, [userId, baseCurrency, theme, onboarded])
    return result.rows[0]
  }
}

export default AppSettingsModel
