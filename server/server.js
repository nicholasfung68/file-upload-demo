const http = require('http')
const FileUploadController =  require('./controller')

const server = http.createServer()
const fileUploadController = new FileUploadController()

server.on('request', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*') // 允许跨域
  res.setHeader('Access-Control-Allow-Headers', '*') // 允许跨域

  if (req.method === 'OPTIONS') { // 如果是预检请求
    res.status = 200
    res.end()
    return
  }

  if (req.url === '/upload') {
    await fileUploadController.handleFormData(req, res)
  }

  if (req.url === '/merge') {
    await fileUploadController.handleMerge(req, res)
    return
  }

  if (req.url === '/verify') {
    await fileUploadController.handleVerifyUpload(req, res)
    return
  }
})

server.listen(3001, () => console.log('start to listen port 3001 ...'))
