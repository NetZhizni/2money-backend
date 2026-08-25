import { Router } from 'express'
import authGoogle from '#middleware/auth'
import authRouter from './auth.js'
import accountsRouter from './accounts.js'
import categoriesRouter from './categories.js'
import transactionsRouter from './transactions.js'
import recurringTemplatesRouter from './recurringTemplates.js'
import budgetsRouter from './budgets.js'
import settingsRouter from './settings.js'
import usersRouter from './users.js'
import adminRouter from './admin.js'

const internalRouter = Router()
internalRouter.use(authGoogle)
internalRouter.use('/auth', authRouter)
internalRouter.use('/accounts', accountsRouter)
internalRouter.use('/categories', categoriesRouter)
internalRouter.use('/transactions', transactionsRouter)
internalRouter.use('/recurring-templates', recurringTemplatesRouter)
internalRouter.use('/budgets', budgetsRouter)
internalRouter.use('/settings', settingsRouter)
internalRouter.use('/users', usersRouter)
internalRouter.use('/admin', adminRouter)

const errorRouter = Router()
errorRouter.all(/(.*)/, (req, res) => {
  throw new Error(`API не існує ${req.headers.host}${req.originalUrl}`)
})

export default { internalRouter, errorRouter }
