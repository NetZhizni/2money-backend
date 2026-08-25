import UserModel from '#sql/UserModel'
import { uuidv7 } from '#util/uuid'
import { colorForEmail } from '#util/color'

/**
 * POST /api/admin/users — власник заздалегідь заводить email члена сім'ї;
 * displayName — заглушка (email), підхопить справжнє ім'я/фото з Google
 * при першому вході (authGoogle оновлює профіль щоразу, див. middleware/auth.js).
 */
const createUser = async (req) => {
  const email = req.body.email?.trim().toLowerCase()
  if (!email) {
    const error = new Error('Email обов’язковий')
    error.status = 400
    throw error
  }

  const existing = await UserModel.getByEmail({ email })
  if (existing) {
    const error = new Error('Користувач з таким email вже існує')
    error.status = 409
    throw error
  }

  return UserModel.create({
    id: uuidv7(),
    email,
    displayName: email,
    color: colorForEmail(email),
    role: req.body.role === 'owner' ? 'owner' : 'member',
    isActive: true,
  })
}

export default createUser
