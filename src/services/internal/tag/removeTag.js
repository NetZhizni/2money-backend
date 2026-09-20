import TagModel from '#sql/TagModel'

/** DELETE /api/tags/:id — soft delete. Detaching the tag from operations that reference it is the frontend's job (see stores/tags.ts's remove()), same as a removed category leaves other members' historic transactions pointing at a vanished id. */
const removeTag = async (req) => {
  const removed = await TagModel.remove({ id: req.params.id })
  if (!removed) {
    const error = new Error('Тег не знайдено')
    error.status = 404
    throw error
  }
  return { removed: true }
}

export default removeTag
