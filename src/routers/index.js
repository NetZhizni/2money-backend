import { Router } from 'express'
import authGoogle from '#middleware/auth'
import { mountSyncRoutes } from '#sync/router'
import authRouter from './auth.js'
import settingsRouter from './settings.js'
import usersRouter from './users.js'
import adminRouter from './admin.js'
import receiptsRouter from './receipts.js'

const internalRouter = Router()
internalRouter.use(authGoogle)
internalRouter.use('/auth', authRouter)
internalRouter.use('/receipts', receiptsRouter)
mountSyncRoutes(internalRouter)
internalRouter.use('/settings', settingsRouter)
internalRouter.use('/users', usersRouter)
internalRouter.use('/admin', adminRouter)

const errorRouter = Router()
errorRouter.all(/(.*)/, (req, res) => {
  throw new Error(`API не існує ${req.headers.host}${req.originalUrl}`)
})

export default { internalRouter, errorRouter }
