<template>
  <div id="app">
    <h1>文件上传demo</h1>

    <section class="upload-file">
      <h2>上传文件</h2>
      <input type="file" @change="handleFileChange">
      <el-button @click="handleUpload">上传</el-button>
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
const SIZE = 10 * 1024 * 1024 // 分片大小

export default {
  name: 'App',
  data() {
    return {
      container: {
        worker: null,
        file: null,
        hash: ''
      },
      data: [],
      fakeUploadPercentage: 0,
      hashPercentage: 0
    }
  },
  filters: {
    transformByte(val) {
      return Number((val / 1024).toFixed(0))
    }
  },
  computed: {
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
    request({
      url,
      method = 'post',
      data,
      headers = {},
      onProgress = p => p,
      // requestList
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
          resolve({
            data: e.target.response
          })
        }
      })
    },
    handleFileChange(e) {
      const [file] = e.target.files
      if (!file) return
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
    async uploadChunks() {
      const requestList = this.data
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
            url: 'http://localhost:3001',
            data: formData,
            onProgress: this.createProgressHandler(this.data[index])
          })
        })
      await Promise.all(requestList)
      await this.mergeRequest() // 合并切片
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
    },
    async handleUpload() {
      if (!this.container.file) {
        return this.$message.warning('未选择文件！')
      }
      const fileChunkList = this.createFileChunk(this.container.file)
      this.container.hash = await this.calculateHash(fileChunkList)
      this.data = fileChunkList.map(({ file }, index) => ({
        fileHash: this.container.hash,
        index,
        percentage: 0,
        size: file.size,
        chunk: file,
        hash: this.container.hash + '-' + index // 文件hash + 数组下标
      }))
      await this.uploadChunks()
    },
    createProgressHandler(item) {
      return p => {
        item.percentage = parseInt(String((p.loaded / p.total) * 100))
      }
    },
    // 生成文件hash （web-worker）
    calculateHash(fileChunkList) {
      return new Promise((resolve) => {
        // 添加worker属性
        this.container.worker = new Worker('/hash.js')
        this.container.worker.postMessage({ fileChunkList })
        this.container.worker.onmessage = (e) => {
          const { percentage, hash } = e.data
          this.hashPercentage = percentage
          if (hash) {
            resolve(hash)
          }
        }
      })
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
