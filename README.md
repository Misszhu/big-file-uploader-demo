[big-file-uploader](https://github.com/Misszhu/big-file-uploader)的客户端和服务端实现示例

## 项目结构

```
.
├── frontend/          # 前端项目 (React + TypeScript + Vite)  
└── server/           # 后端项目 (Node.js + Express)
```

## 服务端
包含文件分片存储、合并、断点续传等功能。
- 技术栈：Node.js + Express

1. 进入 server 目录:
```sh
cd server
```

2. 安装依赖:
```sh
npm install
```

3. 启动服务:
```sh
node index.js
```

服务器将运行在 http://localhost:3000

### 前端应用 

1. 进入 frontend 目录:
```sh
cd frontend
```

2. 安装依赖:
```sh
pnpm install
```

3. 启动开发服务器:
```sh 
pnpm dev
```

应用将运行在 http://localhost:5173