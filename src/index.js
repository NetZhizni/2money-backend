import http from 'http'
import express from 'express'
import cors from './middleware/cors.js'
import router from './routers/router.js'

const app = express()
app.use(cors)
app.use(express.json({ limit: '1mb' }))

const startServer = () => {
  app.use('/api', router.internalRouter)
  app.use('/', router.errorRouter)

  const isFirstWorker = process.env.FORK_ID === '0'
  const port = isFirstWorker ? process.env.PORT_ADMIN : process.env.PORT
  app.set('port', port)

  const server = http.createServer(app)
  server.listen(port, () => {
    console.log(`\u001b[1;44mHTTP - [OK] - localhost:${port}\u001b[0m`)
  })
}

export default startServer
