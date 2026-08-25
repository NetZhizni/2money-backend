import { Router } from 'express'
import wrap from './wrap.js'
import listDirectory from '#services/user/listDirectory'

const router = Router()

router.get('/', wrap(listDirectory))

export default router
