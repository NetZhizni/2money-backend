import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'

/**
 * A throwaway Postgres for one test file: PGlite (real Postgres compiled to
 * WASM, in-process) behind a TCP socket, migrated with the real migrations/
 * — so tests exercise the app's own `pg` pool and SQL with no Docker and no
 * external database.
 *
 * Must run before anything imports #util/pg: the pool reads its connection
 * settings from process.env once, at import time.
 *
 * PGlite is a single session under the hood (the socket server multiplexes
 * connections onto it), so tests must not rely on two transactions truly
 * running side by side.
 */
export async function startTestDatabase() {
  const db = await PGlite.create()
  const server = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0, maxConnections: 10 })
  await server.start()
  const [host, port] = server.getServerConn().split(':')
  Object.assign(process.env, {
    POSTGRES_HOST: host,
    POSTGRES_PORT: port,
    POSTGRES_USER: 'postgres',
    POSTGRES_PASSWORD: 'postgres',
    POSTGRES_DB: 'postgres',
    POSTGRES_SSL: 'false',
  })

  const { runner } = await import('node-pg-migrate')
  const { default: dbConfig } = await import('../../src/constants/dbConfig.js')
  await runner({
    databaseUrl: dbConfig,
    dir: fileURLToPath(new URL('../../migrations', import.meta.url)),
    direction: 'up',
    migrationsTable: 'pgmigrations',
    count: Infinity,
    log: () => {},
  })
  // dbConfig's `-c search_path=...` startup option doesn't reach PGlite's
  // one shared session, so it's set on that session directly instead.
  await db.exec('SET search_path TO fin, public')

  return {
    async stop() {
      const { default: pg } = await import('#util/pg')
      await pg.end()
      await server.stop()
      await db.close()
    },
  }
}
