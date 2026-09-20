import { Router } from 'express'
import wrap from './wrap.js'
import listCategories from '#services/category/listCategories'
import upsertCategory from '#services/category/upsertCategory'
import patchCategory from '#services/category/patchCategory'
import removeCategory from '#services/category/removeCategory'

const router = Router()

router.get('/', wrap(listCategories))
router.post('/', wrap(upsertCategory, 'categories'))
router.patch('/:id', wrap(patchCategory, 'categories'))
router.delete('/:id', wrap(removeCategory, 'categories'))

export default router
