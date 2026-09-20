// @ts-nocheck
import cluster from 'node:cluster'
import startServer from './index.js'

const isPrimary = cluster.isPrimary

if (isPrimary) {
  console.log(`Primary ${process.pid} is running`)

  cluster.fork()

  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker died! Pid: ${worker.process.pid}. Code ${code}`)
    cluster.fork()
  })
} else {
  console.log(`Worker ${process.pid} started`)
  startServer()
}
