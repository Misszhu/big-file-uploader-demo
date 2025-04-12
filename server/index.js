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

// 添加在文件开头的配置部分
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`创建目录: ${dir}`);
  }
}

// 确保临时目录和上传目录都存在
ensureDir(TEMP_DIR);
ensureDir(UPLOAD_DIR);

// 中间件
app.use(cors({
  origin: function (origin, callback) {
    callback(null, true); // 允许所有域名访问
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 存储上传状态 (生产环境应使用数据库)
const uploadStatus = {};

// 修改处理请求取消的函数
function handleRequestCancel(req) {
  // 先清理当前请求的临时文件
  if (req.file && fs.existsSync(req.file.path)) {
    try {
      fs.unlinkSync(req.file.path);
      console.log('已清理取消请求的临时文件:', req.file.path);
    } catch (error) {
      console.error('清理取消请求的临时文件失败:', error);
    }
  }

  // 清理整个上传会话的临时目录
  const { uploadId } = req.body;
  if (uploadId && uploadStatus[uploadId]) {
    const tempDir = path.join(TEMP_DIR, uploadId);
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true });
        console.log('已清理上传会话的临时目录:', tempDir);
      }
      delete uploadStatus[uploadId];
    } catch (error) {
      console.error('清理上传会话临时目录失败:', error);
    }
  }
}

// 添加定期清理函数
function cleanupOrphanedTempDirs() {
  try {
    if (fs.existsSync(TEMP_DIR)) {
      const dirs = fs.readdirSync(TEMP_DIR);
      dirs.forEach(dir => {
        const tempDir = path.join(TEMP_DIR, dir);
        if (!uploadStatus[dir]) {  // 如果目录名不在 uploadStatus 中，说明是孤立的临时目录
          try {
            fs.rmSync(tempDir, { recursive: true });
            console.log('已清理孤立的临时目录:', tempDir);
          } catch (error) {
            console.error('清理孤立临时目录失败:', tempDir, error);
          }
        }
      });
    }
  } catch (error) {
    console.error('清理临时目录失败:', error);
  }
}

// 设置定期清理任务
// setInterval(cleanupOrphanedTempDirs, 1000 * 60 * 30); // 每30分钟清理一次

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
      success: true,
      exists: true
    });
  }

  const uploadId = uuidv4();
  const tempDir = path.join(TEMP_DIR, uploadId);

  try {
    // 使用 recursive 选项确保父目录存在
    fs.mkdirSync(tempDir, { recursive: true });

    uploadStatus[uploadId] = {
      fileName,
      fileSize,
      chunkSize,
      fileHash,
      totalChunks: Math.ceil(fileSize / chunkSize),
      uploadedChunks: []
    };

    res.json({ uploadId });
  } catch (error) {
    console.error('创建临时目录失败:', error);
    res.status(500).json({
      error: '创建临时目录失败',
      message: error.message
    });
  }
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
app.post('/api/upload/chunk', upload.single('file'), (req, res) => {
  const { uploadId, chunkIndex, fileHash } = req.body;

  if (!uploadStatus[uploadId]) {
    return res.status(404).json({ error: '上传会话不存在' });
  }

  const status = uploadStatus[uploadId];
  const tempDir = path.join(TEMP_DIR, uploadId);
  const chunkPath = path.join(tempDir, `${chunkIndex}.part`);

  try {
    // 添加请求取消监听
    req.on('close', () => {
      if (!res.headersSent) { // 如果响应还没有发送，说明是被取消的请求
        handleRequestCancel(req);
      }
    });

    // 将分片移动到指定位置
    fs.renameSync(req.file.path, chunkPath);

    // 记录已上传分片
    const chunkIndexInt = parseInt(chunkIndex);
    if (!status.uploadedChunks.includes(chunkIndexInt)) {
      status.uploadedChunks.push(chunkIndexInt);
    }

    res.json({ success: true });
  } catch (error) {
    handleRequestCancel(req); // 发生错误时也清理临时文件
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

  // 确保目录存在
  ensureDir(TEMP_DIR);
  ensureDir(UPLOAD_DIR);

  const status = uploadStatus[uploadId];
  const tempDir = path.join(TEMP_DIR, uploadId);

  // 确保临时上传目录存在
  ensureDir(tempDir);

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