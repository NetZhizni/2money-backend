import { Router } from 'express'
import wrap from './wrap.js'
import scanReceipt from '#services/receipt/scanReceipt'
import listReceipts from '#services/receipt/listReceipts'
import upsertReceipt from '#services/receipt/upsertReceipt'
import patchReceipt from '#services/receipt/patchReceipt'
import removeReceipt from '#services/receipt/removeReceipt'

const router = Router()

router.post('/scan', wrap(scanReceipt))
router.get('/', wrap(listReceipts))
router.post('/', wrap(upsertReceipt, 'receipts'))
router.patch('/:id', wrap(patchReceipt, 'receipts'))
router.delete('/:id', wrap(removeReceipt, 'receipts'))

export default router
