import { Pool, types } from 'pg'
import dbConfig from '../constants/dbConfig.js'

// numeric (OID 1700) comes back from `pg` as a string by default (it can't
// know a money value won't blow past float precision) — this app treats
// amounts as plain JS numbers everywhere (matches the ported FinTrack model
// types), so parse it eagerly instead of pushing Number(...) onto every caller.
types.setTypeParser(1700, (value) => (value === null ? null : parseFloat(value)))

const dbPool = new Pool(dbConfig)

class pg {
  /**
   * Виконує запит до бази даних
   * @param {string} querySql - SQL запит
   * @param {any[]} [queryParams] - Параметри запиту
   * @returns {Promise<dbQueryResult>} - Результат запиту
   */
  static async query(querySql, queryParams) {
    const result = await dbPool.query(querySql, queryParams)
    return result
  }
}

export default pg