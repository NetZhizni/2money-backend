import { Router } from 'express'
import wrap from './wrap.js'
import requireAdmin from '#middleware/requireAdmin'
import listUsers from '#services/user/listUsers'
import createUser from '#services/user/createUser'
import updateUser from '#services/user/updateUser'

const router = Router()
router.use(requireAdmin)

router.get('/users', wrap(listUsers))
router.post('/users', wrap(createUser))
router.patch('/users/:id', wrap(updateUser))

export default router
