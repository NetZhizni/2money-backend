import { Router } from 'express'
import wrap from './wrap.js'
import scanReceipt from '#services/receipt/scanReceipt'

/**
 * Receipt endpoints that aren't plain synced CRUD — the CRUD half of
 * /receipts is mounted by sync/router.js. Mounted before it (see
 * routers/index.js), though the two never compete for a path.
 */
const router = Router()

router.post('/scan', wrap(scanReceipt))

export default router
