import pg from '#util/pg'

class RateSnapshotModel {
  /**
   * Stored snapshots for any of `dates` (YYYY-MM-DD strings, already validated).
   * @returns {Promise<{ date: string, rates: Record<string, number> }[]>}
   */
  static async getMany({ dates }) {
    if (!dates.length) return []
    const query = `SELECT date::text AS date, rates FROM rate_snapshots WHERE date = ANY($1::date[])`
    const result = await pg.query(query, [dates])
    return result.rows
  }

  /**
   * The most recent stored snapshot — what "latest" falls back to when the
   * rates API itself can't be reached.
   * @returns {Promise<{ date: string, rates: Record<string, number> } | undefined>}
   */
  static async newest() {
    const query = `SELECT date::text AS date, rates FROM rate_snapshots ORDER BY date DESC LIMIT 1`
    const result = await pg.query(query)
    return result.rows[0]
  }

  /**
   * Stores a day's snapshot unless one is already there — a past day's rates
   * never change, so whichever copy landed first (another request, another
   * worker) is kept as is.
   */
  static async insert({ date, rates }) {
    const query = `INSERT INTO rate_snapshots (date, rates) VALUES ($1, $2) ON CONFLICT (date) DO NOTHING`
    await pg.query(query, [date, JSON.stringify(rates)])
  }
}

export default RateSnapshotModel
