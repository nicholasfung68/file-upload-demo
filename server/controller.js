const path = require('path')
const fse = require('fs-extra')
const multiparty = require('multiparty') // 使用multiparty包处理前端传来的FormData

const UPLOAD_DIR = path.resolve(__dirname, '..', 'target') // 上传文件存储目录

const extractExt = (filename) => filename.slice(filename.lastIndexOf('.'), filename.length) // 提取后缀名

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
    const readStream = fse.createReadStream(path)
    readStream.on('end', () => {
      fse.unlinkSync(path)
      resolve()
    })
    readStream.pipe(writeStream)
  })
}

// 合并切片
const mergeFileChunk = async (filePath, fileHash, size) => {
  const chunkDir = path.resolve(UPLOAD_DIR, fileHash)
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
  fse.rmdir(chunkDir) // 合并后删除保存切片的目录
}

// 返回已经上传切片名
const createUploadedList = async (fileHash) => {
  return fse.existsSync(path.resolve(UPLOAD_DIR, fileHash)) ? await fse.readdir(path.resolve(UPLOAD_DIR, fileHash)) : []
}

module.exports = class {
  // 处理分片文件上传 form-data
  async handleFormData(req, res) {
    const multipart = new multiparty.Form()
    // 在multiparty.parse的回调中，files参数保存了FormData中的文件，fields参数保存了FormData中非文件的字段
    multipart.parse(req, async (err, fields, files) => {
      if (err) {
        console.error('handle formdata error: ', err)
        res.status = 500
        res.end('出错了……')
        return
      }

      const [chunk] = files.chunk
      const [hash] = fields.hash
      const [fileHash] = fields.fileHash
      const [filename] = fields.filename
      const filePath = path.resolve(UPLOAD_DIR, `${fileHash}${extractExt(filename)}`)
      const chunkDir = path.resolve(UPLOAD_DIR, fileHash)

      // 文件存在直接返回
      if (fse.existsSync(filePath)) {
        res.end('file exist')
        return
      }

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
  async handleMerge(req, res) {
    const data = await resolvePost(req)
    const { fileHash, filename, size } = data
    const ext = extractExt(filename)
    const filePath = path.resolve(UPLOAD_DIR, `${fileHash}${ext}`)
    await mergeFileChunk(filePath, fileHash, size)
    res.end(
      JSON.stringify({
        code: 0,
        message: 'file merged success'
      })
    )
  }
  
  // 验证是否已上传/已上传切片下标
  async handleVerifyUpload(req, res) {
    const data = await resolvePost(req)
    const { fileHash, filename } = data
    const ext = extractExt(filename)
    const filePath = path.resolve(UPLOAD_DIR, `${fileHash}${ext}`)
    if (fse.existsSync(filePath)) {
      res.end(
        JSON.stringify({
          shouldUpload: false
        })
      )
    } else {
      res.end(
        JSON.stringify({
          shouldUpload: true,
          uploadedList: await createUploadedList(fileHash)
        })
      )
    }
  }
}
