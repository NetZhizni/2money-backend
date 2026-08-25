/** Гейт для /api/admin/* — тільки role='owner'. Монтується після authGoogle. */
const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'owner') {
    const error = new Error('Потрібні права власника')
    error.status = 403
    return next(error)
  }
  return next()
}

export default requireAdmin
