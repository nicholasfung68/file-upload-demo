<template>
  <div id="app">
    <h1>文件上传demo</h1>

    <section class="upload-file">
      <h2>上传文件</h2>
      <input type="file" :disabled="status !== Status.wait" @change="handleFileChange">
      <el-button :disabled="uploadDisabled" @click="handleUpload">上传</el-button>
      <el-button v-if="status === Status.pause" @click="handleResume">恢复</el-button>
      <el-button
        v-else
        :disabled="status !== Status.uploading || !container.hash"
        @click="handlePause"
      >暂停</el-button>
    </section>

    <section class="file-hash-progress">
      <h2>计算文件hash</h2>
      <el-progress :percentage="hashPercentage"></el-progress>
    </section>

    <section class="total-upload-progress">
      <h2>上传总进度</h2>
      <el-progress :percentage="fakeUploadPercentage"></el-progress>
    </section>

    <section class="slice-upload-progress">
      <h2>切片上传进度</h2>
      <el-table :data="data">
        <el-table-column prop="hash" label="切片hash" align="center"></el-table-column>
        <el-table-column label="大小(KB)" align="center" width="120">
          <template v-slot="{ row }">
            {{ row.size | transformByte }}
          </template>
        </el-table-column>
        <el-table-column label="进度" align="center">
          <template v-slot="{ row }">
            <el-progress :percentage="row.percentage" color="#909399"></el-progress>
          </template>
        </el-table-column>
      </el-table>
    </section>
  </div>
</template>

<script>
const SIZE = 10 * 1024 * 1024 // 分片大小 10MB

const Status = {
  wait: 'wait',
  pause: 'pause',
  uploading: 'uploading'
}

export default {
  name: 'App',
  data() {
    return {
      Status,
      container: {
        worker: null,
        file: null,
        hash: ''
      },
      data: [],
      // 当暂停时会取消 xhr 导致进度条后退
      // 为了避免这种情况，需要定义一个假的进度条
      fakeUploadPercentage: 0,
      hashPercentage: 0,
      requestList: [],
      status: Status.wait
    }
  },
  filters: {
    transformByte(val) {
      return Number((val / 1024).toFixed(0))
    }
  },
  computed: {
    uploadDisabled() {
      return  (
        !this.container.file ||
        [Status.pause, Status.uploading].includes(this.status)
      )
    },
    uploadPercentage() {
      if (!this.container.file || !this.data.length) {
        return 0
      }
      const loaded = this.data.map(item => item.size * item.percentage).reduce((acc, curt) => acc + curt)
      return parseInt((loaded / this.container.file.size).toFixed(2))
    }
  },
  watch: {
    uploadPercentage(now) {
      if (now > this.fakeUploadPercentage) {
        this.fakeUploadPercentage = now
      }
    }
  },
  methods: {
    resetData() {
      this.requestList.forEach(xhr => xhr?.abort())
      this.requestList.splice(0)
      if (this.container.worker) {
        this.container.worker.onmessage = null
      }
    },
    request({
      url,
      method = 'post',
      data,
      headers = {},
      onProgress = p => p,
      requestList
    }) {
      return new Promise(resolve => {
        const xhr = new XMLHttpRequest()
        xhr.upload.onprogress = onProgress // XMLHttpRequest原生支持上传进度条监听，只需要监听upload.progress即可
        xhr.open(method, url)
        Object.keys(headers).forEach(key => {
          xhr.setRequestHeader(key, headers[key])
        })
        xhr.send(data)
        xhr.onload = e => {
          // 将请求成功的xhr从列表中删除
          if (requestList) {
            const xhrIndex = requestList.findIndex(i => i === xhr)
            requestList.splice(xhrIndex, 1)
          }
          resolve({
            data: e.target.response
          })
        }
        requestList?.push(xhr) // 暴露当前xhr给外部
      })
    },
    handleFileChange(e) {
      const [file] = e.target.files
      if (!file) return
      this.resetData()
      Object.assign(this.$data, this.$options.data()) // 恢复初始化的数据
      this.container.file = file
    },
    // 生成文件切片
    createFileChunk(file, size = SIZE) {
      const fileChunkList = [] // 用于存放分片
      let curt = 0
      while (curt < file.size) {
        fileChunkList.push({ file: file.slice(curt, curt + size) }) // 大文件分片的原理
        curt += size
      }
      return fileChunkList
    },
    // 上传切片，同时过滤已上传的切片
    async uploadChunks(uploadedList = []) {
      const requestList = this.data
        .filter(({ hash }) => !uploadedList.includes(hash))
        .map(({ chunk, hash, index }) => {
          // 处理formData
          const formData = new FormData()
          formData.append('chunk', chunk)
          formData.append('hash', hash)
          formData.append('filename', this.container.file.name)
          formData.append('fileHash', this.container.hash)
          return { formData, index }
        })
        .map(async ({ formData, index }) => {
          // 分片上传
          this.request({
            url: 'http://localhost:3001/upload',
            data: formData,
            onProgress: this.createProgressHandler(this.data[index]),
            requestList: this.requestList
          })
        })
      await Promise.all(requestList)
      // 之前上传的切片数量 + 本次上传的切片数量 = 所有的切片数量时， 合并切片
      if (uploadedList.length + requestList.length === this.data.length) {
        await this.mergeRequest() // 合并切片
      }
    },
    async mergeRequest() {
      await this.request({
        url: 'http://localhost:3001/merge',
        headers: {
          'content-type': 'application/json'
        },
        data: JSON.stringify({
          size: SIZE,
          filename: this.container.file.name,
          fileHash: this.container.hash
        })
      })
      this.$message.success('上传成功')
      this.status = Status.wait
    },
    async handleUpload() {
      if (!this.container.file) {
        return this.$message.warning('未选择文件！')
      }
      this.status = Status.uploading
      const fileChunkList = this.createFileChunk(this.container.file)
      this.container.hash = await this.calculateHash(fileChunkList)

      const { shouldUpload, uploadedList } = await this.verifyUpload(
        this.container.file.name,
        this.container.hash
      )

      if (!shouldUpload) {
        this.status = Status.wait
        this.$message.success('秒传：上传成功')
        return
      }

      this.data = fileChunkList.map(({ file }, index) => ({
        fileHash: this.container.hash,
        index,
        percentage: 0,
        size: file.size,
        chunk: file,
        hash: this.container.hash + '-' + index // 文件hash + 数组下标
      }))
      await this.uploadChunks(uploadedList)
    },
    // 暂停上传，原理是使用 XMLHttpRequest 的 abort 方法，可以取消一个 xhr 请求的发送
    handlePause() {
      this.status = Status.pause
      this.resetData()
    },
    async handleResume() {
      this.status = Status.uploading
      const { uploadedList } = await this.verifyUpload(
        this.container.file.name,
        this.container.hash
      )
      await this.uploadChunks(uploadedList)
    },
    // 用闭包保存每个 chunk 的进度数据
    createProgressHandler(item) {
      return p => {
        item.percentage = parseInt(String((p.loaded / p.total) * 100))
      }
    },
    // 生成文件hash （web-worker）
    calculateHash(fileChunkList) {
      return new Promise((resolve) => {
        console.time('生成文件hash耗时：')
        this.container.worker = new Worker('/hash.js')
        this.container.worker.postMessage({ fileChunkList })
        this.container.worker.onmessage = (e) => {
          const { percentage, hash } = e.data
          this.hashPercentage = percentage
          if (hash) {
            console.timeEnd('生成文件hash耗时：')
            resolve(hash)
          }
        }
      })
    },
    async verifyUpload(filename, fileHash) {
      const { data } = await this.request({
        url: 'http://localhost:3001/verify',
        headers: {
          'content-type': 'application/json'
        },
        data: JSON.stringify({
          filename,
          fileHash
        })
      })
      return JSON.parse(data)
    }
  }
}
</script>

<style>
#app {
  padding: 20px;
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  color: #2c3e50;
}

.file-hash-progres,
.total-upload-progress,
.slice-upload-progress {
  padding-top: 20px;
}
</style>
