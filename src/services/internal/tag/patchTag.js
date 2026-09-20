import TagModel from '#sql/TagModel'

/** PATCH /api/tags/:id. Not used by the frontend today (see patchCategory.js's own doc comment for why) — kept for a consistent API. */
const patchTag = async (req) => {
  const b = req.body
  const tag = await TagModel.patch({ id: req.params.id, name: b.name, color: b.color })
  if (!tag) {
    const error = new Error('Тег не знайдено')
    error.status = 404
    throw error
  }
  return tag
}

export default patchTag
