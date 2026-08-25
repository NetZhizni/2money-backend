import CategoryModel from '#sql/CategoryModel'

/** PATCH /api/categories/:id */
const patchCategory = async (req) => {
  const b = req.body
  const category = await CategoryModel.patch({
    id: req.params.id,
    ownerId: req.user.id,
    name: b.name,
    kind: b.kind,
    icon: b.icon,
    color: b.color,
    parent_id: b.parentId,
    archived: b.archived,
    order: b.order,
    is_default: b.isDefault,
  })
  if (!category) {
    const error = new Error('Категорію не знайдено')
    error.status = 404
    throw error
  }
  return category
}

export default patchCategory
