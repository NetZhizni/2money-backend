import { Server } from 'socket.io'
import firebaseAdmin from '#util/firebaseAdmin'
import UserModel from '#sql/UserModel'
import { setIo } from './notify.js'

/**
 * Same identity check as middleware/auth.js's authGoogle, minus the
 * first-user bootstrap branch — a socket is only ever opened by a client
 * that already went through the REST login flow once, so there's always an
 * existing `users` row to check by the time this runs.
 */
async function authenticateSocket(socket, next) {
  try {
    const token = socket.handshake.auth?.token
    if (!token) {
      const error = new Error('Відсутній токен авторизації')
      throw error
    }

    const decodedToken = await firebaseAdmin
      .auth()
      .verifyIdToken(token)
      .catch((cause) => {
        const error = new Error('Недійсний або прострочений токен авторизації')
        error.cause = cause
        throw error
      })

    const user = await UserModel.getByEmail({ email: decodedToken.email })
    if (!user || !user.is_active) {
      throw new Error('Доступ вимкнено адміністратором родини.')
    }

    socket.data.userId = user.id
    return next()
  } catch (error) {
    return next(error)
  }
}

/**
 * Push half of the sync story (see #db/sync.ts's poll-based pull for the
 * other half, which this only ever supplements, never replaces): every
 * connected device gets poked the moment another device's write lands, via
 * notifySync (src/routers/wrap.js calls it after every mutating request).
 *
 * src/cluster.js runs a single Express worker (respawned by the primary if
 * it dies) — no cross-process fan-out needed, so this uses Socket.IO's
 * default in-memory adapter and `io.emit()` alone reaches every connected
 * client. `transports: ['websocket']` is just a perf/simplicity choice
 * (skips Engine.IO's HTTP-long-polling handshake), not a correctness
 * requirement here.
 */
export function setupSocketIO(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: true },
    transports: ['websocket'],
  })
  io.use(authenticateSocket)

  setIo(io)
  return io
}
