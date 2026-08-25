import RecurringTemplateModel from '#sql/RecurringTemplateModel'

const removeRecurringTemplate = async (req) => {
  const removed = await RecurringTemplateModel.remove({ id: req.params.id, ownerId: req.user.id })
  if (!removed) {
    const error = new Error('Шаблон не знайдено')
    error.status = 404
    throw error
  }
  return { removed: true }
}

export default removeRecurringTemplate
