import { Router } from 'express'
import wrap from './wrap.js'
import listBudgets from '#services/budget/listBudgets'
import upsertBudget from '#services/budget/upsertBudget'
import patchBudget from '#services/budget/patchBudget'
import removeBudget from '#services/budget/removeBudget'

const router = Router()

router.get('/', wrap(listBudgets))
router.post('/', wrap(upsertBudget))
router.patch('/:id', wrap(patchBudget))
router.delete('/:id', wrap(removeBudget))

export default router
