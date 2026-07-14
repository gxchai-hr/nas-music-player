# NAS Music Player

一个为 NAS 设计的轻量级音乐播放器 Web 应用，支持 Docker 一键部署。

## ✨ 功能特性

- 🎵 **音乐播放** — 支持 MP3、FLAC、WAV、OGG、AAC 等主流音频格式
- 📁 **目录浏览** — 自动扫描音乐目录，按文件夹/艺术家/专辑分类展示
- 🔍 **搜索功能** — 按歌名、艺术家、专辑快速搜索
- 📋 **播放列表** — 创建和管理自定义播放列表
- 🎨 **Web 界面** — 响应式设计，支持手机、平板、桌面浏览器
- 🔒 **用户认证** — 多用户支持，管理员/普通用户角色
- 📊 **元数据读取** — 自动读取音乐文件的 ID3 标签信息
- 🐳 **Docker 部署** — 一键部署，适合 NAS 环境

## 📋 系统要求

- Docker 20.10+
- Docker Compose v2+
- 约 50MB 磁盘空间（应用本身）

## 🚀 快速开始

### 1. 克隆项目

```bash
git clone <repository-url> nas-music-player
cd nas-music-player
```

### 2. 配置环境

```bash
cp .env.example .env
```

编辑 `.env` 文件，修改以下配置：

```bash
# 设置你的音乐目录路径
MUSIC_DIR=/path/to/your/music

# 修改密钥（必须修改！）
SECRET_KEY=your-actual-secret-key
```

### 3. 启动服务

```bash
docker-compose up -d
```

### 4. 访问 Web 界面

打开浏览器访问：`http://<你的NAS-IP>:8080`

默认管理员账号：`admin` / `admin123`（请尽快修改密码）

## ⚙️ 配置说明

### 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `MUSIC_DIR` | `/mnt/music` | 音乐文件所在目录 |
| `DATA_DIR` | `./data` | 应用数据存储目录 |
| `CONFIG_DIR` | `./config` | 配置文件目录 |
| `SECRET_KEY` | `change-me-in-production` | 会话密钥（必须修改） |
| `PORT` | `8080` | Web 端口映射 |

### 音乐目录挂载

Docker Compose 中默认将 `MUSIC_DIR` 以只读模式挂载到容器的 `/music` 目录。如果你的音乐文件在 NAS 上，请将 `.env` 中的 `MUSIC_DIR` 设置为绝对路径：

```bash
# 示例：群晖 NAS
MUSIC_DIR=/volume1/music

# 示例：威联通 NAS
MUSIC_DIR=/share/Music

# 示例：通用 Linux
MUSIC_DIR=/mnt/data/music
```

### 用户配置

用户信息存储在 `config/users.json` 文件中：

```json
{
  "users": [
    {
      "username": "admin",
      "password": "admin123",
      "role": "admin"
    },
    {
      "username": "guest",
      "password": "guest123",
      "role": "user"
    }
  ]
}
```

> ⚠️ **注意**：密码目前以明文存储，建议仅在内网环境使用。后续版本将支持密码哈希。

## 📂 目录结构

```
nas-music-player/
├── backend/                 # Python 后端代码
│   ├── app.py              # FastAPI 应用主入口
│   ├── scanner.py          # 音乐扫描与元数据解析
│   ├── auth.py             # 用户认证模块
│   └── requirements.txt    # Python 依赖
├── frontend/               # 前端静态文件
│   ├── index.html          # 主页面
│   ├── css/                # 样式文件
│   └── js/                 # JavaScript 文件
├── config/                 # 配置文件目录
│   └── users.json          # 用户配置
├── data/                   # 应用数据（数据库等）
├── Dockerfile              # Docker 构建文件
├── docker-compose.yml      # Docker Compose 编排
├── .env.example            # 环境变量模板
└── README.md               # 本文档
```

## 🖼️ 界面截图

> 截图将在此处展示...

- 主界面 - 音乐库浏览
- 播放器 - 播放控制与进度条
- 搜索 - 快速搜索结果
- 播放列表 - 自定义列表管理

## ❓ 常见问题 (FAQ)

### Q: 启动后无法访问 Web 界面？

**A:** 请检查以下几点：
1. 确认端口未被占用：`lsof -i :8080`
2. 检查防火墙是否放行 8080 端口
3. 查看容器日志：`docker-compose logs music-player`

### Q: 音乐文件扫描不到？

**A:** 请检查：
1. `MUSIC_DIR` 路径是否正确
2. 确认 Docker 有权访问该目录
3. 重启服务触发重新扫描：`docker-compose restart`

### Q: 如何添加新用户？

**A:** 直接编辑 `config/users.json` 文件，添加新的用户条目，然后重启服务。

### Q: 如何修改端口？

**A:** 编辑 `.env` 文件，修改 `PORT` 变量即可：

```bash
PORT=9090
```

### Q: 支持哪些音频格式？

**A:** 支持所有浏览器原生支持的格式以及 FFmpeg 可解码的格式：
- MP3, AAC, OGG Vorbis, WAV, FLAC
- M4A, WMA, Opus

### Q: 如何在群晖 Docker 中部署？

**A:** 参考以下步骤：
1. 在群晖 Container Manager 中导入 `docker-compose.yml`
2. 在环境变量中设置 `MUSIC_DIR` 为群晖音乐目录
3. 启动容器

### Q: 数据备份？

**A:** 重要数据在以下目录：
- `config/` — 用户配置
- `data/` — 播放列表、数据库

建议定期备份这两个目录。

## 🔧 开发

### 本地开发（不使用 Docker）

```bash
cd backend
pip install -r requirements.txt
uvicorn app:app --reload --port 8080
```

### 构建 Docker 镜像

```bash
docker-compose build
```

## 📄 License

MIT License

```
MIT License

Copyright (c) 2024 NAS Music Player

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
