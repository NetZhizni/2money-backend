import { parseArgs } from 'node:util'
import { runner } from 'node-pg-migrate'
import dbConfig from './constants/dbConfig.js'

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    action: { type: 'string' },
  },
  strict: false, // false дозволяє ігнорувати інші параметри
})
const direction = values.action
if (!['up', 'down'].includes(direction)) {
  console.error(`
❌ Помилка: Параметр --action може приймати лише значення 'up' або 'down'.
Ви передали: '${direction}'
`)
  process.exit(1)
}
const count = direction === 'down' ? 1 : Infinity
const runMigrations = async () => {
  try {
    console.log('🚀 Починаємо міграції...')
    await runner({
      databaseUrl: dbConfig,
      dir: 'migrations',
      direction,
      createSchema: true,
      migrationsTable: 'pgmigrations',
      count,
    })
    console.log('✅ Міграції успішно завершені!')
  } catch (error) {
    console.error('❌ Помилка міграцій:', error)
    process.exit(1)
  }
}

runMigrations()
