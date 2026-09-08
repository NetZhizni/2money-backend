import { Router } from 'express'
import wrap from './wrap.js'
import getPublicConfig from '#services/config/getPublicConfig'

// Навмисно окремий роутер, змонтований в index.js ДО authGoogle (не через
// routers/index.js, чий internalRouter вішає authGoogle на geть усе одним
// `.use()`) — GET /config/public мусить бути читним без токена: саме звідси
// фронтенд, який ще навіть не знає, який це Firebase-проєкт, дізнається
// конфіг, щоб потім тим Firebase-проєктом авторизуватись.
const router = Router()

router.get('/public', wrap(getPublicConfig))

export default router
