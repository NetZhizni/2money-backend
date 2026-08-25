import AppSettingsModel from '#sql/AppSettingsModel'

/** PATCH /api/settings */
const updateSettings = async (req) => {
  const b = req.body
  return AppSettingsModel.update({
    userId: req.user.id,
    baseCurrency: b.baseCurrency,
    theme: b.theme,
    onboarded: b.onboarded,
  })
}

export default updateSettings
