import AppSettingsModel from '#sql/AppSettingsModel'

/** GET /api/settings — власні налаштування (базова валюта, тема, onboarded). */
const getSettings = async (req) => {
  return AppSettingsModel.getByUserId({ userId: req.user.id })
}

export default getSettings
