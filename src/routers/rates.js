import { Router } from 'express'
import wrap from './wrap.js'
import getRateSnapshots from '#services/rates/getRateSnapshots'

const router = Router()

// POST, not GET: a year of dates doesn't fit comfortably in a query string.
router.post('/snapshots', wrap(getRateSnapshots))

export default router
