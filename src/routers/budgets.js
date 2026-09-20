import { Router } from 'express'
import wrap from './wrap.js'
import listBudgets from '#services/budget/listBudgets'
import upsertBudget from '#services/budget/upsertBudget'
import patchBudget from '#services/budget/patchBudget'
import removeBudget from '#services/budget/removeBudget'

const router = Router()

router.get('/', wrap(listBudgets))
router.post('/', wrap(upsertBudget, 'budgets'))
router.patch('/:id', wrap(patchBudget, 'budgets'))
router.delete('/:id', wrap(removeBudget, 'budgets'))

export default router
