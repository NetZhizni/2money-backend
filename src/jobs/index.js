import { scheduleDaily } from './scheduler.js'
import { fetchRates } from './fetchRates.js'
import { purgeDeleted } from './purgeDeleted.js'

/**
 * The server's scheduled jobs — started once, by the cluster's primary
 * process (see cluster.js), so however many HTTP workers there are, each job
 * runs once per server. Times are UTC; each also runs shortly after start
 * (see scheduleDaily). Several servers on one database would each run them
 * too, which is harmless: both jobs are idempotent.
 */
export function startJobs() {
  // The rates API publishes a new day once a day, at no fixed hour — twice a
  // day means the stored "latest" is never more than half a day behind it.
  scheduleDaily({ name: 'fetch-rates', times: ['00:20', '12:20'], startupDelayMs: 30_000, run: () => fetchRates() })
  scheduleDaily({ name: 'purge-deleted', times: ['03:00'], startupDelayMs: 120_000, run: () => purgeDeleted() })
}
