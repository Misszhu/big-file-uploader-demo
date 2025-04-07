class BigFileUploader {
  constructor(options) {
    this.file = options.file;
    this.url = options.url;
    this.chunkSize = options.chunkSize || 5 * 1024 * 1024; // 默认5MB
    this.concurrent = options.concurrent || 3;

    this.chunks = [];
    this.uploadedChunks = [];
    this.activeConnections = 0;
    this.paused = false;
    this.uploadId = null;
    this.fileHash = null;
    this.abortController = null; // 添加 AbortController

    this.onProgress = options.onProgress || (() => { });
    this.onSuccess = options.onSuccess || (() => { });
    this.onError = options.onError || (() => { });

    this._prepareChunks();
  }

  _prepareChunks() {
    const fileSize = this.file.size;
    let start = 0;
    let index = 0;

    while (start < fileSize) {
      const end = Math.min(start + this.chunkSize, fileSize);
      this.chunks.push({
        index,
        start,
        end,
        blob: this.file.slice(start, end)
      });
      start = end;
      index++;
    }
  }

  async calculateFileHash() {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const buffer = e.target.result;
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        resolve(hashHex);
      };
      reader.readAsArrayBuffer(this.file);
    });
  }

  async start() {
    if (this.paused) {
      this.paused = false;
      // 只有在没有 uploadId 时才初始化
      if (!this.uploadId) {
        await this._initUploadSession();
      }
      this._uploadChunks();
      return;
    }

    await this._initUploadSession();
  }

  // 新增方法，处理初始化逻辑
  async _initUploadSession() {
    // 计算文件hash作为唯一标识
    if (!this.fileHash) {
      this.fileHash = await this.calculateFileHash();
    }

    try {
      const response = await this._initUpload();
      this.uploadId = response.uploadId;

      // 处理重复上传
      if (!this.uploadId && response.message === '文件已存在，无需重复上传') {
        this.uploadedChunks = response.uploadedChunks || [];
        this._updateProgress();
        this.onSuccess(response);
        return;
      }

      // 检查已上传的分片
      const progressResponse = await this._checkProgress();
      this.uploadedChunks = progressResponse.uploadedChunks || [];

      this._uploadChunks();
    } catch (error) {
      this.onError(error);
    }
  }

  pause() {
    this.paused = true;
    // 取消当前进行中的请求
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  async _initUpload() {
    const response = await fetch(`${this.url}/init`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fileName: this.file.name,
        fileSize: this.file.size,
        chunkSize: this.chunkSize,
        fileHash: this.fileHash
      })
    });

    if (!response.ok) {
      throw new Error('初始化上传失败');
    }

    return response.json();
  }

  async _checkProgress() {
    const response = await fetch(`${this.url}/progress?uploadId=${this.uploadId}`);

    if (!response.ok) {
      throw new Error('获取上传进度失败');
    }

    return response.json();
  }

  async _uploadChunks() {
    if (this.paused) return;

    const chunksToUpload = this.chunks.filter(
      chunk => !this.uploadedChunks.includes(chunk.index)
    );

    if (chunksToUpload.length === 0) {
      await this._mergeFile();
      return;
    }

    while (this.activeConnections < this.concurrent && chunksToUpload.length > 0) {
      if (this.paused) return; // 添加暂停检查

      const chunk = chunksToUpload.shift();
      this.activeConnections++;

      try {
        await this._uploadChunk(chunk);
        if (!this.uploadedChunks.includes(chunk.index)) {
          this.uploadedChunks.push(chunk.index);
        }
        this._updateProgress();
      } catch (error) {
        if (error.name === 'AbortError') {
          // 处理取消请求的情况
          console.log(`分片 ${chunk.index} 上传已取消`);
          return;
        }
        this.onError(error);
        return;
      } finally {
        this.activeConnections--;
      }

      // 如果没有暂停，继续上传
      if (!this.paused) {
        this._uploadChunks();
      }
    }
  }

  async _uploadChunk(chunk) {
    // 创建新的 AbortController
    this.abortController = new AbortController();
    const formData = new FormData();
    formData.append('file', chunk.blob);
    formData.append('chunkIndex', chunk.index);
    formData.append('uploadId', this.uploadId);
    formData.append('fileHash', this.fileHash);

    const response = await fetch(this.url, {
      method: 'POST',
      body: formData,
      signal: this.abortController.signal // 添加 signal
    });

    if (!response.ok) {
      throw new Error(`分片 ${chunk.index} 上传失败`);
    }
  }

  async _mergeFile() {
    const response = await fetch(`${this.url}/merge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        uploadId: this.uploadId,
        fileName: this.file.name,
        fileHash: this.fileHash
      })
    });

    if (!response.ok) {
      throw new Error('文件合并失败');
    }

    const data = await response.json();
    this.onSuccess(data);
  }

  _updateProgress() {
    // 使用 Set 去重
    const uniqueChunks = new Set(this.uploadedChunks);
    // 计算进度时确保不会超过100%
    const progress = Math.min(
      Math.round((uniqueChunks.size / this.chunks.length) * 100),
      100
    );
    this.onProgress(progress);
  }
}