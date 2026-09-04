import AppSettingsModel from '#sql/AppSettingsModel'

/**
 * GET /api/settings — власні налаштування: базова валюта, тема, onboarded,
 * а також бекап пристрій-локальних мови/формату чисел/дат/валюти (SELECT *,
 * тож нове поле в таблиці підхоплюється тут само собою).
 */
const getSettings = async (req) => {
  return AppSettingsModel.getByUserId({ userId: req.user.id })
}

export default getSettings
