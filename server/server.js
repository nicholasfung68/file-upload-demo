const http = require('http')
const path = require('path')
const fse = require('fs-extra')
const multiparty = require('multiparty') // 使用multiparty包处理前端传来的FormData

const server = http.createServer()
const UPLOAD_DIR = path.resolve(__dirname, '..', 'target') // 上传文件存储目录

const resolvePost = (req) => {
  return new Promise((resolve) => {
    let chunk = ''
    req.on('data', data => {
      chunk += data
    })
    req.on('end', () => {
      resolve(JSON.parse(chunk))
    })
  })
}

const pipeStream = (path, writeStream) => {
  return new Promise((resolve) => {
    // createReadStream 创建可读流，其返回值是一个 ReadStream 对象
    const readStream = fse.createReadStream(path)
    readStream.on('end', () => {
      // unlinkSync 同步删除文件
      fse.unlinkSync(path)
      resolve()
    })
    // stream.pipe 方法将可读流转换成可写流 https://nodejs.org/en/knowledge/advanced/streams/how-to-use-stream-pipe/
    readStream.pipe(writeStream)
  })
}

// 合并切片
const mergeFileChunk = async (filePath, filename, size) => {
  const chunkDir = path.resolve(UPLOAD_DIR)
  // 暂时不知道为啥，使用setTimeout才能读取到目录内的文件，否则读取到的是空的……待解决
  setTimeout(async () => {
    const chunkPaths = await fse.readdir(chunkDir)
    // 根据切片下标进行排序，否则直接读取目录获得的顺序可能会错乱
    chunkPaths.sort((a, b) => a.split('-')[1] - b.split('-')[1])
    await Promise.all(
      chunkPaths.map((chunkPath, index) => {
        pipeStream(
          path.resolve(chunkDir, chunkPath),
          // 指定位置创建可写流
          fse.createWriteStream(filePath, {
            start: index * size,
            end: (index + 1) * size
          })
        )
      })
    )
    // // rmdirSync 方法 删除文件夹
    // fse.rmdirSync(chunkDir) // 合并后删除保存切片的目录
  }, 1000)
}

// 处理分片文件上传 form-data
const handleFormData = async (req, res) => {
  const multipart = new multiparty.Form()
  // 在multiparty.parse的回调中，files参数保存了FormData中的文件，fields参数保存了FormData中非文件的字段
  multipart.parse(req, async (err, fields, files) => {
    if (err) {
      console.error('handle formdata error: ', err)
      res.status = 500
      res.end(err)
      return
    }

    const [chunk] = files.chunk
    const [hash] = fields.hash
    // const [filename] = fields.filename
    const chunkDir = path.resolve(UPLOAD_DIR)

    // 切片目录不存在则创建切片目录
    // existsSync 同步检查给定路径中是​​否已存在文件，返回值是布尔值
    if (!fse.existsSync(chunkDir)) {
      // mkdirs 确保文件夹存在(文件夹目录结构没有会新建)
      await fse.mkdirs(chunkDir)
    }

    // fs-extra 专用方法，类似 fs.name 并且跨平台
    // fs-extra 的 rename 方法，window平台会有权限问题
    // https://github.com/meteor/meteor/issues/7852#issuecomment-255767835
    await fse.move(chunk.path, `${chunkDir}/${hash}`)
    res.end('received file chunk')
  })
}

// 处理合并切片
const handleMerge = async (req, res) => {
  const data = await resolvePost(req)
  const { filename, size } = data
  const filePath = path.resolve(UPLOAD_DIR, `${filename}`)
  await mergeFileChunk(filePath, filename, size)
  res.end(
    JSON.stringify({
      code: 0,
      message: 'file merged success'
    })
  )
}

server.on('request', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*') // 允许跨域
  res.setHeader('Access-Control-Allow-Headers', '*') // 允许跨域

  if (req.method === 'OPTIONS') { // 如果是预检请求
    res.status = 200
    res.end()
    return
  }

  if (req.url === '/') {
    await handleFormData(req, res)
  }

  if (req.url === '/merge') {
    await handleMerge(req, res)
  }
})

server.listen(3001, () => console.log('start to listen port 3001 ...'))
