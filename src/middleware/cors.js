const ACMA = (60 * 60 * 24).toString()
// const ACAO = [
//   // Access-Control-Allow-Origin
//   'http://192.168.1.191:8088',
//   'http://localhost:8088',
//   'https://localhost:8088',
//   'https://sed.dev.npu.np.work',
//   'https://sed.npu.np.work',
//   'https://sed.nova-digital.net',
//   'https://sed.novapost.work',
// ]

const cors = (req, res, next) => {
  // let origin = ''
  // if (ACAO.includes(req.headers.origin)) {
  // origin = req.headers.origin
  // }

  const origin = req.headers.origin
  res.header('Access-Control-Allow-Origin', origin)
  res.header('Access-Control-Allow-Headers', 'authorization,content-type')
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
  res.header('Access-Control-Max-Age', ACMA)
  if (req.method === 'OPTIONS') {
    res.status(200).json({})
    return
  }
  next()
}

export default cors
