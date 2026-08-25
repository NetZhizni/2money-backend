import { Router } from 'express'
import wrap from './wrap.js'
import listRecurringTemplates from '#services/recurringTemplate/listRecurringTemplates'
import upsertRecurringTemplate from '#services/recurringTemplate/upsertRecurringTemplate'
import patchRecurringTemplate from '#services/recurringTemplate/patchRecurringTemplate'
import removeRecurringTemplate from '#services/recurringTemplate/removeRecurringTemplate'

const router = Router()

router.get('/', wrap(listRecurringTemplates))
router.post('/', wrap(upsertRecurringTemplate))
router.patch('/:id', wrap(patchRecurringTemplate))
router.delete('/:id', wrap(removeRecurringTemplate))

export default router
