import { Router } from 'express'
import wrap from './wrap.js'
import getSettings from '#services/settings/getSettings'
import updateSettings from '#services/settings/updateSettings'

const router = Router()

router.get('/', wrap(getSettings))
router.patch('/', wrap(updateSettings))

export default router
