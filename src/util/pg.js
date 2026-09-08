import { Pool, types } from 'pg'
import { AsyncLocalStorage } from 'node:async_hooks'
import dbConfig from '../constants/dbConfig.js'

// numeric (OID 1700) comes back from `pg` as a string by default (it can't
// know a money value won't blow past float precision) — this app treats
// amounts as plain JS numbers everywhere (matches the ported FinTrack model
// types), so parse it eagerly instead of pushing Number(...) onto every caller.
types.setTypeParser(1700, (value) => (value === null ? null : parseFloat(value)))

const dbPool = new Pool(dbConfig)

// Lets `pg.transaction()` below make every `pg.query()` call issued during
// its callback run on the SAME dedicated client (and inside the same
// BEGIN/COMMIT) — including ones made transitively through any of the
// `#sql/*Model` classes' own `pg.query()` calls — without any of them
// needing to accept/thread a client parameter through. Only ever holds a
// client while a `transaction()` callback is actually running; every plain
// `pg.query()` call outside of one keeps hitting the pool directly, exactly
// as before this existed.
const activeClient = new AsyncLocalStorage()

class pg {
  /**
   * Виконує запит до бази даних
   * @param {string} querySql - SQL запит
   * @param {any[]} [queryParams] - Параметри запиту
   * @returns {Promise<dbQueryResult>} - Результат запиту
   */
  static async query(querySql, queryParams) {
    const client = activeClient.getStore()
    const result = await (client ?? dbPool).query(querySql, queryParams)
    return result
  }

  /**
   * Runs `callback` inside one BEGIN ... COMMIT (ROLLBACK on throw) on a
   * single dedicated client — for a logical operation that spans more than
   * one statement across more than one table and must be all-or-nothing
   * (see services/internal/admin/restoreFamilyBackup.js, the first real
   * user of this: a bulk multi-table import). Every `pg.query()` call made
   * anywhere during `callback` — directly, or transitively through any
   * `#sql/*Model` — transparently joins this same transaction (see
   * `activeClient` above), so none of them need to change to support this.
   * @template T
   * @param {(client: import('pg').PoolClient) => Promise<T>} callback
   * @returns {Promise<T>}
   */
  static async transaction(callback) {
    const client = await dbPool.connect()
    try {
      await client.query('BEGIN')
      const result = await activeClient.run(client, () => callback(client))
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
}

export default pg