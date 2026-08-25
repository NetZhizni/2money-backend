import { Router } from 'express'
import wrap from './wrap.js'
import getMe from '#services/auth/getMe'

const router = Router()

router.get('/me', wrap(getMe))

export default router
