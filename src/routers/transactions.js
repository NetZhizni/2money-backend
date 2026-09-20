import { Router } from 'express'
import wrap from './wrap.js'
import listTransactions from '#services/transaction/listTransactions'
import upsertTransaction from '#services/transaction/upsertTransaction'
import patchTransaction from '#services/transaction/patchTransaction'
import removeTransaction from '#services/transaction/removeTransaction'

const router = Router()

router.get('/', wrap(listTransactions))
router.post('/', wrap(upsertTransaction, 'transactions'))
router.patch('/:id', wrap(patchTransaction, 'transactions'))
router.delete('/:id', wrap(removeTransaction, 'transactions'))

export default router
