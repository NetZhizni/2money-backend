import { camelizeKeys } from '#util/caseConvert'

/**
 * Wraps a `service(req)` handler into an Express route handler: awaits it,
 * camelizes the result (Postgres row shape -> the frontend's TS model
 * shape), and forwards thrown errors to the error middleware instead of
 * needing try/catch in every route.
 */
const wrap = (service) => async (req, res, next) => {
  try {
    const result = await service(req)
    res.status(200).json(camelizeKeys(result))
  } catch (error) {
    next(error)
  }
}

export default wrap
