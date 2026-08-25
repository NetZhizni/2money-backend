import CategoryModel from '#sql/CategoryModel'

/** DELETE /api/categories/:id — soft delete. */
const removeCategory = async (req) => {
  const removed = await CategoryModel.remove({ id: req.params.id, ownerId: req.user.id })
  if (!removed) {
    const error = new Error('Категорію не знайдено')
    error.status = 404
    throw error
  }
  return { removed: true }
}

export default removeCategory
