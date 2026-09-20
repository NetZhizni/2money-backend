import { Router } from 'express'
import wrap from './wrap.js'
import listTags from '#services/tag/listTags'
import upsertTag from '#services/tag/upsertTag'
import patchTag from '#services/tag/patchTag'
import removeTag from '#services/tag/removeTag'

const router = Router()

router.get('/', wrap(listTags))
router.post('/', wrap(upsertTag, 'tags'))
router.patch('/:id', wrap(patchTag, 'tags'))
router.delete('/:id', wrap(removeTag, 'tags'))

export default router
