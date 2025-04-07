import BigFileUploader from 'big-file-uploader';
// UI 交互
document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('fileInput');
  const uploadBtn = document.getElementById('uploadBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const resumeBtn = document.getElementById('resumeBtn');
  const progressBar = document.getElementById('progressBar');
  const progressText = document.getElementById('progressText');
  const fileInfo = document.getElementById('fileInfo');
  const statusDiv = document.getElementById('status');

  let uploader = null;

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      const file = fileInput.files[0];
      fileInfo.innerHTML = `
                <strong>文件名:</strong> ${file.name}<br>
                <strong>大小:</strong> ${formatFileSize(file.size)}
            `;
      uploadBtn.disabled = false;
    } else {
      fileInfo.innerHTML = '';
      uploadBtn.disabled = true;
    }

    pauseBtn.disabled = true;
    resumeBtn.disabled = true;
    progressBar.style.width = '0%';
    progressText.textContent = '0%';
    statusDiv.textContent = '';
    statusDiv.className = 'status';
  });

  uploadBtn.addEventListener('click', () => {
    if (fileInput.files.length === 0) return;

    const file = fileInput.files[0];

    uploader = new BigFileUploader({
      file,
      url: 'http://localhost:3000/api/upload',
      chunkSize: 2 * 1024 * 1024, // 2MB分片
      concurrent: 3,
      onProgress: (progress) => {
        progressBar.style.width = `${progress}%`;
        progressText.textContent = `${progress}%`;
      },
      onSuccess: (response) => {
        statusDiv.textContent = '上传成功! 文件已保存为: ' + response.filePath;
        statusDiv.className = 'status success';
        pauseBtn.disabled = true;
        resumeBtn.disabled = true;
        uploadBtn.disabled = true;
      },
      onError: (error) => {
        statusDiv.textContent = '上传出错: ' + error.message;
        statusDiv.className = 'status error';
        pauseBtn.disabled = true;
        resumeBtn.disabled = true;
      }
    });

    uploader.start();
    uploadBtn.disabled = true;
    pauseBtn.disabled = false;
  });

  pauseBtn.addEventListener('click', () => {
    if (uploader) {
      uploader.pause();
      pauseBtn.disabled = true;
      resumeBtn.disabled = false;
      statusDiv.textContent = '上传已暂停';
      statusDiv.className = 'status';
    }
  });

  resumeBtn.addEventListener('click', () => {
    if (uploader) {
      uploader.start();
      resumeBtn.disabled = true;
      pauseBtn.disabled = false;
      statusDiv.textContent = '上传已继续...';
      statusDiv.className = 'status';
    }
  });
});

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i]);
}