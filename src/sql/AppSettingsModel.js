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
   *
   * language/numberFormat/dateFormat/currencyDisplay — той самий
   * best-effort бекап пристрій-локальних налаштувань фронтенду
   * (utils/format.ts, i18n/locale.ts), що й baseCurrency/theme вище; сам
   * застосунок завжди рендериться зі свого localStorage, це лише те, що
   * підхоплюється на новому пристрої без власного вибору.
   * @returns {Promise<Object|undefined>}
   */
  static async update({ userId, baseCurrency, theme, onboarded, language, numberFormat, dateFormat, currencyDisplay }) {
    const query = `
      UPDATE app_settings
      SET
        base_currency = COALESCE($2, base_currency),
        theme = COALESCE($3, theme),
        onboarded = COALESCE($4, onboarded),
        language = COALESCE($5, language),
        number_format = COALESCE($6, number_format),
        date_format = COALESCE($7, date_format),
        currency_display = COALESCE($8, currency_display),
        updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
      RETURNING *
    `
    const result = await pg.query(query, [
      userId, baseCurrency, theme, onboarded, language, numberFormat, dateFormat, currencyDisplay,
    ])
    return result.rows[0]
  }
}

export default AppSettingsModel
