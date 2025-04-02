const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();

// 配置
const PORT = 3000;
const TEMP_DIR = path.join(__dirname, 'temp');
const UPLOAD_DIR = path.join(__dirname, 'uploads');

// 确保目录存在
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 存储上传状态 (生产环境应使用数据库)
const uploadStatus = {};

// 初始化上传
app.post('/api/upload/init', (req, res) => {
  const { fileName, fileSize, chunkSize, fileHash } = req.body;

  // 检查文件是否已存在 (根据文件hash)
  const existingFile = checkFileExists(fileHash);
  if (existingFile) {
    return res.status(200).json({
      uploadId: null,
      filePath: existingFile,
      message: '文件已存在，无需重复上传',
      success: true
    });
  }

  const uploadId = uuidv4();

  uploadStatus[uploadId] = {
    fileName,
    fileSize,
    chunkSize,
    fileHash,
    totalChunks: Math.ceil(fileSize / chunkSize),
    uploadedChunks: []
  };

  // 创建临时目录
  const tempDir = path.join(TEMP_DIR, uploadId);
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

  res.json({ uploadId });
});

// 检查文件是否已存在
function checkFileExists(fileHash) {
  if (!fs.existsSync(UPLOAD_DIR)) return false;

  const files = fs.readdirSync(UPLOAD_DIR);
  for (const file of files) {
    if (file.startsWith(fileHash)) {
      return path.join(UPLOAD_DIR, file);
    }
  }
  return false;
}

// 上传分片
const upload = multer({ dest: TEMP_DIR });
app.post('/api/upload', upload.single('file'), (req, res) => {
  const { uploadId, chunkIndex, fileHash } = req.body;

  if (!uploadStatus[uploadId]) {
    return res.status(404).json({ error: '上传会话不存在' });
  }

  const status = uploadStatus[uploadId];
  const tempDir = path.join(TEMP_DIR, uploadId);
  const chunkPath = path.join(tempDir, `${chunkIndex}.part`);

  try {
    // 将分片移动到指定位置
    fs.renameSync(req.file.path, chunkPath);

    // 记录已上传分片
    const chunkIndexInt = parseInt(chunkIndex);
    if (!status.uploadedChunks.includes(chunkIndexInt)) {
      status.uploadedChunks.push(chunkIndexInt);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('上传分片失败:', error);
    res.status(500).json({ error: '上传分片失败' });
  }
});

// 合并分片
app.post('/api/upload/merge', async (req, res) => {
  const { uploadId, fileName, fileHash } = req.body;

  if (!uploadStatus[uploadId]) {
    return res.status(404).json({ error: '上传会话不存在' });
  }

  const status = uploadStatus[uploadId];
  const tempDir = path.join(TEMP_DIR, uploadId);

  // 验证临时目录
  if (!fs.existsSync(tempDir)) {
    return res.status(400).json({ error: '临时目录不存在' });
  }

  // 验证所有分片文件是否存在
  const missingFiles = [];
  for (let i = 0; i < status.totalChunks; i++) {
    const chunkPath = path.join(tempDir, `${i}.part`);
    if (!fs.existsSync(chunkPath)) {
      missingFiles.push(i);
    }
  }

  if (missingFiles.length > 0) {
    return res.status(400).json({
      error: '部分分片文件丢失',
      missingFiles
    });
  }

  // 生成最终文件名 (hash + 原始扩展名)
  const ext = path.extname(fileName);
  const finalFileName = fileHash + ext;
  const filePath = path.join(UPLOAD_DIR, finalFileName);

  // 按顺序合并分片
  try {
    console.log('开始合并分片...');
    await mergeChunks(tempDir, status.totalChunks, filePath);
    console.log('分片合并完成，准备删除临时目录:', tempDir);

    if (fs.existsSync(tempDir)) {
      console.log('临时目录存在，开始删除');
      // 清理临时文件
      fs.rmSync(tempDir, { recursive: true });
      delete uploadStatus[uploadId];
    } else {
      console.log('临时目录已不存在');
    }

    res.json({ success: true, filePath: finalFileName });
  } catch (error) {
    console.error('合并失败:', error);
    res.status(500).json({
      error: '合并文件失败',
      message: error.message
    });
  }
});

// 合并分片函数
async function mergeChunks(tempDir, totalChunks, filePath) {
  return new Promise((resolve, reject) => {
    // 验证临时目录是否存在
    if (!fs.existsSync(tempDir)) {
      return reject(new Error(`临时目录不存在: ${tempDir}`));
    }

    const writeStream = fs.createWriteStream(filePath);
    let currentChunk = 0;

    // 错误处理
    writeStream.on('error', (error) => {
      console.error('写入流错误:', error);
      writeStream.destroy();
      reject(error);
    });

    function writeNextChunk() {
      if (currentChunk >= totalChunks) {
        writeStream.end();
        resolve();
        return;
      }

      const chunkPath = path.join(tempDir, `${currentChunk}.part`);

      // 验证分片文件是否存在
      if (!fs.existsSync(chunkPath)) {
        writeStream.destroy();
        reject(new Error(`分片文件不存在: ${chunkPath}`));
        return;
      }

      const readStream = fs.createReadStream(chunkPath);

      // 处理读取流错误
      readStream.on('error', (error) => {
        console.error(`读取分片 ${currentChunk} 错误:`, error);
        writeStream.destroy();
        reject(error);
      });

      readStream.pipe(writeStream, { end: false });

      readStream.on('end', () => {
        console.log(`分片 ${currentChunk} 已完成读取`);
        currentChunk++;
        writeNextChunk();
      });
    }

    writeNextChunk();
  });
}

// 查询上传进度
app.get('/api/upload/progress', (req, res) => {
  const { uploadId } = req.query;

  if (!uploadStatus[uploadId]) {
    return res.status(404).json({ error: '上传会话不存在' });
  }

  const status = uploadStatus[uploadId];
  const uploadedChunksSet = new Set(status.uploadedChunks);
  const missingChunks = [];

  // 找出缺失的分片
  for (let i = 0; i < status.totalChunks; i++) {
    if (!uploadedChunksSet.has(i)) {
      missingChunks.push(i);
    }
  }

  const progress = Math.round(
    (status.uploadedChunks.length / status.totalChunks) * 100
  );

  res.json({
    progress,
    uploadedChunks: status.uploadedChunks,
    totalChunks: status.totalChunks,
    missingChunks, // 返回缺失的分片
  });
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
});