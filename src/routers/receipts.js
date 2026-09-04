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
router.post('/', wrap(upsertReceipt))
router.patch('/:id', wrap(patchReceipt))
router.delete('/:id', wrap(removeReceipt))

export default router
