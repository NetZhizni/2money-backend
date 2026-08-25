import UserModel from '#sql/UserModel'

/**
 * PATCH /api/admin/users/:id — роль/активність. Власник не може сам себе
 * деактивувати чи розжалувати, якщо він лишається єдиним owner (інакше
 * родина втратить доступ до адмінки без ручного втручання в БД).
 */
const updateUser = async (req) => {
  const targetId = req.params.id
  const { role, isActive } = req.body

  if (targetId === req.user.id) {
    const demoting = role != null && role !== 'owner'
    const deactivating = isActive === false
    if (demoting || deactivating) {
      const owners = await UserModel.getAll()
      const otherActiveOwners = owners.some((u) => u.id !== targetId && u.role === 'owner' && u.is_active)
      if (!otherActiveOwners) {
        const error = new Error('Не можна прибрати останнього активного власника')
        error.status = 409
        throw error
      }
    }
  }

  const user = await UserModel.setRoleAndActive({ id: targetId, role, isActive })
  if (!user) {
    const error = new Error('Користувача не знайдено')
    error.status = 404
    throw error
  }
  return user
}

export default updateUser
