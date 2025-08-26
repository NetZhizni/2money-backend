import { Client } from 'pg'

const pgConfig = {
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PWD,
  port: 5433,
}

const pg = new Client(pgConfig)

pg.connect()

export default pg