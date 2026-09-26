// A hand-rolled scheduler rather than node-cron, on purpose: a couple of
// daily jobs didn't justify a dependency, and the parts that matter here —
// the catch-up run at startup, and never overlapping a run still going —
// would have to be written around node-cron anyway.
//
// TODO: switch to node-cron once jobs need more than "daily at HH:MM" (weekly,
// monthly, every N minutes) or there are many more of them. Keep
// scheduleDaily's startup run and overlap guard as the wrapper, replace the
// setTimeout chain inside it with cron.schedule(expression, execute,
// { timezone: 'UTC' }), and have jobs/index.js pass cron expressions
// ('20 0,12 * * *') instead of `times`. nextRunAt and its tests go with it.

const DAY_MS = 24 * 60 * 60 * 1000

/** The first moment strictly after `now` that falls on one of `times` ('HH:MM', UTC). */
export function nextRunAt(times, now = Date.now()) {
  const today = new Date(now)
  return Math.min(
    ...times.map((time) => {
      const [hours, minutes] = time.split(':').map(Number)
      const at = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), hours, minutes)
      return at > now ? at : at + DAY_MS
    }),
  )
}

/**
 * A minimal cron: runs `run` every day at each of `times` (UTC, 'HH:MM'),
 * and once `startupDelayMs` after start — so a server that was down at the
 * scheduled time (a deploy, a restart) catches up straight away instead of a
 * day later. Every job here is idempotent, so the extra run costs nothing
 * when there was nothing to catch up on.
 *
 * A run still going when the next one comes due isn't doubled up: that one
 * is skipped. Failures are logged and never stop the schedule.
 */
export function scheduleDaily({ name, times, startupDelayMs = 60_000, run }) {
  let running = false
  let timer = null

  const execute = async () => {
    if (running) return
    running = true
    const startedAt = Date.now()
    try {
      const summary = await run()
      console.log(`[jobs] ${name} done in ${Date.now() - startedAt} ms`, summary ?? '')
    } catch (error) {
      console.error(`[jobs] ${name} failed`, error)
    } finally {
      running = false
    }
  }

  const scheduleNext = () => {
    timer = setTimeout(async () => {
      await execute()
      scheduleNext()
    }, nextRunAt(times) - Date.now())
  }

  const startup = setTimeout(execute, startupDelayMs)
  scheduleNext()

  return {
    stop() {
      clearTimeout(startup)
      clearTimeout(timer)
    },
  }
}
