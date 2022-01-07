<template>
  <div id="app">
    <input type="file" @change="handleFileChange">
    <el-button @click="handleUpload">上传</el-button>
  </div>
</template>

<script>
const SIZE = 10 * 1024 * 1024 // 分片大小

export default {
  name: 'App',
  data() {
    return {
      container: {
        file: null
      },
      data: []
    }
  },
  methods: {
    request({
      url,
      method = 'post',
      data,
      headers = {},
      // requestList
    }) {
      return new Promise(resolve => {
        const xhr = new XMLHttpRequest()
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
        .map(({ chunk, hash }) => {
          // 处理formData
          const formData = new FormData()
          formData.append('chunk', chunk)
          formData.append('hash', hash)
          formData.append('filename', this.container.file.name)
          return { formData }
        })
        .map(async ({ formData }) => {
          // 分片上传
          this.request({
            url: 'http://localhost:3001',
            data: formData
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
          filename: this.container.file.name
        })
      })
      this.$message.success('上传成功')
    },
    async handleUpload() {
      if (!this.container.file) return
      const fileChunkList = this.createFileChunk(this.container.file)
      this.data = fileChunkList.map(({ file }, index) => ({
        chunk: file,
        hash: this.container.file.name + '-' + index // 文件名 + 数组下标
      }))
      await this.uploadChunks()
    }
  }
}
</script>

<style>
#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: center;
  color: #2c3e50;
  margin-top: 60px;
}
</style>
