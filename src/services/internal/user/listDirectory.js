import UserModel from '#sql/UserModel'

/** GET /api/users — публічний (для будь-якого автентифікованого) довідник родини. */
const listDirectory = async () => {
  return UserModel.listActiveDirectory()
}

export default listDirectory
