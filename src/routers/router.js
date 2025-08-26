import { Router } from 'express'
import authGoogle from '../middleware/auth.js'
import services from '../services/internal/index.js'

const internalRouter = Router()
internalRouter.use(authGoogle)
internalRouter.all('/', async (req, res) => {
  try {
    const method = req?.body?.method || req?.query?.m
    const result = await services[method](req, res)
    res.status(200).json(result)
  } catch (error) {
    const err = {
      name: `${error?.name}`,
      message: `${error?.message}`,
      stack: `${error?.stack}`,
    }
    res.status(500).json(err)
  }
})

const errorRouter = Router()
errorRouter.all('/', (req, res) => {
  const error = new Error(`API не існує ${req.headers.host}${req.originalUrl}`)
  const err = {
    name: `${error?.name}`,
    message: `${error?.message}`,
    stack: `${error?.stack}`,
  }
  res.status(404).json(err)
})

export default { internalRouter, errorRouter }
