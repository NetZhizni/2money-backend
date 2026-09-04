import AppSettingsModel from '#sql/AppSettingsModel'

/**
 * PATCH /api/settings — часткове оновлення. Кожне поле окреме й необов'язкове
 * (COALESCE у AppSettingsModel.update пропускає ті, що не прийшли), тож і
 * settings-store (baseCurrency/theme) на фронтенді, і незалежні
 * localStorage-налаштування (utils/format.ts, i18n/locale.ts) можуть слати
 * власний PATCH з лише "своїм" полем, не зачіпаючи решту.
 */
const updateSettings = async (req) => {
  const b = req.body
  return AppSettingsModel.update({
    userId: req.user.id,
    baseCurrency: b.baseCurrency,
    theme: b.theme,
    onboarded: b.onboarded,
    language: b.language,
    numberFormat: b.numberFormat,
    dateFormat: b.dateFormat,
    currencyDisplay: b.currencyDisplay,
  })
}

export default updateSettings
