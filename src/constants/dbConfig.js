const pgConfig = {
  user: process.env.POSTGRES_USER,
  host: process.env.POSTGRES_HOST,
  database: process.env.POSTGRES_DB,
  password: process.env.POSTGRES_PASSWORD,
  port: process.env.POSTGRES_PORT || 5432,
  // Таблиці застосунку живуть у схемі fin; public лишається запасним варіантом
  options: '-c search_path=fin,public',
  // Керований Postgres (Neon, Supabase тощо) вимагає TLS, локальний у Docker —
  // ні, тож вмикається лише прапорцем. rejectUnauthorized: false — бо такі
  // провайдери часто віддають сертифікат, підписаний власним CA.
  ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false,
  // Позначає з’єднання цього застосунку в pg_stat_activity — курсор синку
  // (див. sync/engine.js readClock) зважає лише на власні відкриті
  // транзакції, а не на будь-яку сторонню сесію на тій самій базі (pg_dump,
  // забутий DBeaver у стані "idle in transaction").
  application_name: 'stork-api',
}

export default pgConfig