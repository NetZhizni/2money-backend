// @ts-nocheck
import cluster from 'node:cluster'
import os from 'node:os'
import startServer from './index.js'

const isPrimary = cluster.isPrimary
const numCPUs = os.availableParallelism()
const workersForkIds = new Map()

if (isPrimary) {
  console.log(`Primary ${process.pid} is running`)

  for (let i = 0; i < numCPUs; i++) {
    const worker = cluster.fork({ FORK_ID: i })
    workersForkIds.set(worker.id, i)
  }

  cluster.on('exit', (worker, code, signal) => {
    const forkId = workersForkIds.get(worker.id)
    console.log(`Worker died! Pid: ${worker.process.pid}. Code ${code}`)
    workersForkIds.delete(worker.id)
    const newWorker = cluster.fork({ FORK_ID: forkId })
    workersForkIds.set(newWorker.id, forkId)
  })
} else {
  console.log(`Worker ${process.pid} with id ${process.env.FORK_ID} started`)
  startServer()
}
