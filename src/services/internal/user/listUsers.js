import UserModel from '#sql/UserModel'

/** GET /api/admin/users — requireAdmin гейтить доступ у роутері. */
const listUsers = async () => {
  return UserModel.getAll()
}

export default listUsers
