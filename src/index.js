import http from 'http'
import express from 'express'
import cors from './middleware/cors.js'
import error from './middleware/error.js'
import router from './routers/index.js'
import configRouter from './routers/config.js'

const app = express()
app.use(cors)
// 32mb: покриває і base64-фото чека (роздувається ~37% проти бінарного
// розміру — POST /api/receipts/scan, див. receipt/scanReceipt.js), і
// найбільше тіло в застосунку — POST /api/admin/restore, повний бекап усієї
// родини (усі рахунки/категорії/операції/бюджети/шаблони/чеки, див.
// services/internal/admin/restoreFamilyBackup.js) за один запит.
app.use(express.json({ limit: '32mb' }))

const startServer = () => {
  // До router.internalRouter навмисно: той вішає authGoogle на весь себе
  // одним `.use()` (див. routers/index.js), а /api/config/public мусить
  // лишатись доступним без токена — фронтенд читає його ще до того, як у
  // нього є з чим авторизуватись (див. src/routers/config.js).
  app.use('/api/config', configRouter)
  app.use('/api', router.internalRouter)
  app.use(/(.*)/, router.errorRouter)
  app.use(error)

  // PORT
  // PORT_ADMIN вимкнено: роутинг однаковий на всіх воркерах (admin-роути теж
  // висіли на internalRouter, див. routers/index.js), тож окремий порт для
  // FORK_ID=0 нічого не ізолював — лише забирав одного воркера з пулу, що
  // балансує PORT, і не давав жодної резервності самому admin-порту.
  // const isFirstWorker = process.env.FORK_ID === '0'
  // const port = isFirstWorker ? process.env.PORT_ADMIN : process.env.PORT
  const port = process.env.PORT
  app.set('port', port)

  const server = http.createServer(app)
  server.listen(port, () => {
    console.log(`\u001b[1;44mHTTP - [OK] - localhost:${port}\u001b[0m`)
  })
}

export default startServer
