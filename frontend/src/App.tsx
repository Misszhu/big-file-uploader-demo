import { useState, useRef, useCallback } from 'react'
import BigFileUploader from 'big-file-uploader'
import './App.css'

function App() {
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [statusClass, setStatusClass] = useState('status');
  const [isUploading, setIsUploading] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const uploaderRef = useRef<BigFileUploader | null>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    setFile(selectedFile || null);
    setProgress(0);
    setStatus('');
    setStatusClass('status');
    setIsUploading(false);
    setIsPaused(false);
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const base = 1024;
    const exponent = Math.floor(Math.log(bytes) / Math.log(base));

    return `${(bytes / Math.pow(base, exponent)).toFixed(2)} ${units[exponent]}`;
  };

  const handleUpload = useCallback(() => {
    if (!file) return;

    uploaderRef.current = new BigFileUploader({
      file,
      baseURL: 'http://localhost:3000',
      chunkSize: 5 * 1024 * 1024, // 5MB分片
      concurrent: 3,
      onProgress: (progress: number) => {
        setProgress(progress);
      },
      onSuccess: (response: { filePath: string }) => {
        setStatus(`上传成功! 文件已保存为: ${response.filePath}`);
        setStatusClass('status success');
        setIsUploading(false);
      },
      onError: (error: Error) => {
        setStatus(`上传出错: ${error.message}`);
        setStatusClass('status error');
        setIsUploading(false);
      }
    });

    uploaderRef.current.start();
    setIsUploading(true);
    setIsPaused(false);
  }, [file]);

  const handlePause = () => {
    if (uploaderRef.current) {
      uploaderRef.current.pause();
      setIsPaused(true);
      setStatus('上传已暂停');
      setStatusClass('status');
    }
  };

  const handleResume = () => {
    if (uploaderRef.current) {
      uploaderRef.current.resume();
      setIsPaused(false);
      setStatus('上传已继续...');
      setStatusClass('status');
    }
  };

  return (
    <div className="container">
      <h1>大文件上传演示</h1>
      <div className="upload-box">
        <input
          type="file"
          className="file-input"
          onChange={handleFileChange}
        />
        <div className="controls">
          <button
            className="btn"
            onClick={handleUpload}
            disabled={!file || isUploading}
          >
            开始上传
          </button>
          <button
            className="btn"
            onClick={handlePause}
            disabled={!isUploading || isPaused}
          >
            暂停
          </button>
          <button
            className="btn"
            onClick={handleResume}
            disabled={isUploading || !isPaused}
          >
            继续
          </button>
        </div>
        <div className="progress-container">
          <div
            className="progress-bar"
            style={{ width: `${progress}%` }}
          />
          <span className="progress-text">{progress}%</span>
        </div>
        {file && (
          <div className="file-info">
            <strong>文件名:</strong> {file.name}<br />
            <strong>大小:</strong> {formatFileSize(file.size)}
          </div>
        )}
        <div className={statusClass}>{status}</div>
      </div>
    </div>
  )
}

export default App
