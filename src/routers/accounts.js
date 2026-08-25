import { Router } from 'express'
import wrap from './wrap.js'
import listAccounts from '#services/account/listAccounts'
import upsertAccount from '#services/account/upsertAccount'
import patchAccount from '#services/account/patchAccount'
import removeAccount from '#services/account/removeAccount'

const router = Router()

router.get('/', wrap(listAccounts))
router.post('/', wrap(upsertAccount))
router.patch('/:id', wrap(patchAccount))
router.delete('/:id', wrap(removeAccount))

export default router
