import AppSettingsModel from '#sql/AppSettingsModel'

/**
 * GET /api/auth/me — req.user вже наповнений authGoogle (створений/знайдений,
 * bootstrap першого власника теж уже відбувся там). Тут лишається тільки
 * підтягнути налаштування профілю.
 */
const getMe = async (req) => {
  const settings = await AppSettingsModel.getByUserId({ userId: req.user.id })
  return { user: req.user, settings }
}

export default getMe
