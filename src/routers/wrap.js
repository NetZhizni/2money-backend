import { camelizeKeys } from '#util/caseConvert'
import { notifySync } from '../sockets/notify.js'

/**
 * Wraps a `service(req)` handler into an Express route handler: awaits it,
 * camelizes the result (Postgres row shape -> the frontend's TS model
 * shape), and forwards thrown errors to the error middleware instead of
 * needing try/catch in every route.
 *
 * `notifyEntity` is only passed by routers for the mutating verbs (POST/
 * PATCH/DELETE) — once the response for one of those is on its way, every
 * connected client gets poked over Socket.IO to pull that entity's delta
 * right away (see src/sockets/notify.js).
 */
const wrap = (service, notifyEntity) => async (req, res, next) => {
  try {
    const result = await service(req)
    res.status(200).json(camelizeKeys(result))
    if (notifyEntity) notifySync(notifyEntity)
  } catch (error) {
    next(error)
  }
}

export default wrap
