import { Router } from 'express'
import wrap from './wrap.js'
import requireAdmin from '#middleware/requireAdmin'
import listUsers from '#services/user/listUsers'
import createUser from '#services/user/createUser'
import updateUser from '#services/user/updateUser'
import restoreFamilyBackup from '#services/admin/restoreFamilyBackup'

const router = Router()
router.use(requireAdmin)

router.get('/users', wrap(listUsers))
router.post('/users', wrap(createUser))
router.patch('/users/:id', wrap(updateUser))
router.post('/restore', wrap(restoreFamilyBackup))

export default router
