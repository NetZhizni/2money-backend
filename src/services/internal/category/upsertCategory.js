import CategoryModel from '#sql/CategoryModel'
import { uuidv7 } from '#util/uuid'

/** POST /api/categories — створення/ідемпотентний replay з outbox. */
const upsertCategory = async (req) => {
  const b = req.body
  const category = await CategoryModel.upsert({
    id: b.id || uuidv7(),
    ownerId: req.user.id,
    name: b.name,
    kind: b.kind,
    icon: b.icon,
    color: b.color,
    parentId: b.parentId ?? null,
    archived: b.archived,
    order: b.order,
    isDefault: b.isDefault,
  })
  if (!category) {
    const error = new Error('Категорія з таким id вже належить іншому користувачу')
    error.status = 409
    throw error
  }
  return category
}

export default upsertCategory
