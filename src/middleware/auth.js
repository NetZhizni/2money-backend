import UserModel from '#sql/UserModel'
import firebaseAdmin from '#util/firebaseAdmin'
import { uuidv7 } from '#util/uuid'
import { colorForEmail } from '#util/color'

/**
 * Перевіряє Google ID token (Firebase Auth) і прив'язує рядок `users` до
 * запиту. Firestore більше не бере участі — уся авторизація йде через
 * таблицю `users` у PG:
 *  - email вже є в users, активний → пускаємо, підхоплюємо свіже ім'я/фото.
 *  - email вже є, але is_active = false → 403 (доступ вимкнув адмін).
 *  - email відсутній, users порожня → bootstrap: цей вхід стає першим
 *    власником (role='owner').
 *  - email відсутній, users НЕ порожня → 403: чекає на pre-provision через
 *    /api/admin/users (див. services/internal/user/createUser.js).
 */
const authGoogle = async (req, res, next) => {
  try {
    const authorization = req.headers?.authorization
    const token = authorization?.replace('Bearer ', '')
    if (!token) {
      const error = new Error('Відсутній токен авторизації')
      error.status = 401
      throw error
    }

    const decodedToken = await firebaseAdmin.auth().verifyIdToken(token).catch((cause) => {
      const error = new Error('Недійсний або прострочений токен авторизації')
      error.status = 401
      error.cause = cause
      throw error
    })
    const email = decodedToken?.email
    const displayName = decodedToken.name || email
    const photoUrl = decodedToken.picture || null

    let user = await UserModel.getByEmail({ email })

    if (!user) {
      const isFirstEver = !(await UserModel.anyExists())
      if (!isFirstEver) {
        const error = new Error('Доступ не надано. Зверніться до адміністратора родини.')
        error.status = 403
        throw error
      }
      user = await UserModel.create({
        id: uuidv7(),
        email,
        displayName,
        photoUrl,
        color: colorForEmail(email),
        role: 'owner',
        isActive: true,
      })
    } else if (!user.is_active) {
      const error = new Error('Доступ вимкнено адміністратором родини.')
      error.status = 403
      throw error
    } else if (user.display_name !== displayName || user.photo_url !== photoUrl) {
      user = (await UserModel.update({ id: user.id, displayName, photoUrl })) || user
    }

    req.user = user
    return next()
  } catch (error) {
    return next(error)
  }
}

export default authGoogle
