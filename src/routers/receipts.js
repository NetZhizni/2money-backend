import { Router } from 'express'
import wrap from './wrap.js'
import scanReceipt from '#services/receipt/scanReceipt'

const router = Router()

router.post('/scan', wrap(scanReceipt))

export default router
