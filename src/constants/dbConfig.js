const pgConfig = {
  user: process.env.POSTGRES_USER,
  host: process.env.POSTGRES_HOST,
  database: process.env.POSTGRES_DB,
  password: process.env.POSTGRES_PASSWORD,
  port: process.env.POSTGRES_PORT || 5432,
  // Таблиці застосунку живуть у схемі fin; public лишається запасним варіантом
  options: '-c search_path=fin,public',
}

export default pgConfig