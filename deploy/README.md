# 后台启动部署指南

推荐使用 systemd 在服务器上后台运行后端。`tongpin-backend.service` 是可直接复制的服务模板。

## 1. 准备服务器

要求：

- Ubuntu / Debian / 其他支持 systemd 的 Linux
- Node.js >= 20
- MySQL 8
- Git
- 服务器可访问 GitHub 和 MySQL

示例路径假设代码部署在：

```text
/opt/HoldU/backend-service
```

## 2. 创建运行用户和目录

```bash
sudo useradd --system --home /opt/HoldU --shell /usr/sbin/nologin tongpin
sudo mkdir -p /opt/HoldU
sudo chown -R tongpin:tongpin /opt/HoldU
```

## 3. 克隆代码

```bash
sudo -u tongpin git clone --recurse-submodules \
  git@github.com:GleamNetwork/HoldU.git /opt/HoldU
```

如果使用 HTTPS：

```bash
sudo -u tongpin git clone --recurse-submodules \
  https://github.com/GleamNetwork/HoldU.git /opt/HoldU
```

## 4. 安装依赖并构建

```bash
cd /opt/HoldU/backend-service
sudo -u tongpin npm ci
sudo -u tongpin npm run build
```

## 5. 配置环境变量

```bash
cd /opt/HoldU/backend-service
sudo -u tongpin cp .env.example .env
sudo -u tongpin nano .env
```

至少配置：

```env
PORT=8080
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=tongpin_app
DB_PASSWORD=your-password
DB_NAME=tongpin_b2
CORS_ORIGINS=https://your-frontend-domain
```

建议生产环境：

- 数据库使用内网或本机地址
- 不使用 root 数据库账号
- 不提交 `.env`
- 不把数据库密码写入 systemd unit

## 6. 初始化数据库

首次部署执行：

```bash
cd /opt/HoldU/backend-service
sudo -u tongpin npm run db:migrate
sudo -u tongpin npm run db:seed
```

`db:seed` 仅用于演示环境。生产环境如不需要演示账号，可以不执行。

## 7. 安装 systemd 服务

```bash
sudo cp deploy/tongpin-backend.service /etc/systemd/system/tongpin-backend.service
sudo systemctl daemon-reload
sudo systemctl enable --now tongpin-backend
```

## 8. 查看状态和日志

```bash
sudo systemctl status tongpin-backend
sudo journalctl -u tongpin-backend -f
```

## 9. 常用操作

重启：

```bash
sudo systemctl restart tongpin-backend
```

停止：

```bash
sudo systemctl stop tongpin-backend
```

更新代码后重新部署：

```bash
cd /opt/HoldU
sudo -u tongpin git pull --recurse-submodules
cd backend-service
sudo -u tongpin npm ci
sudo -u tongpin npm run build
sudo -u tongpin npm run db:migrate
sudo systemctl restart tongpin-backend
```

## 10. 验证服务

```bash
curl http://127.0.0.1:8080/api/v1/health
```

预期返回 `status: ok`。

Swagger 地址：

```text
http://服务器IP:8080/api/v1/docs
```

生产环境建议只通过 Nginx / HTTPS 反向代理暴露 API，并限制 Swagger 访问。

## 11. Nginx 反向代理示例

```nginx
server {
    listen 80;
    server_name api.example.com;

    location /api/ {
        proxy_pass http://127.0.0.1:8080/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }
}
```

SSE 路径需要保留：

```nginx
location /api/v1/events {
    proxy_pass http://127.0.0.1:8080/api/v1/events;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
}
```
