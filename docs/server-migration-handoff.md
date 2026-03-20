# PDD 派单系统 — 新服务器迁移交接文档

## 目标

将 PDD 派单管理系统从**旧试用服务器**迁移到**新正式服务器**，后续做 ICP 备案 + HTTPS。

---

## 服务器信息

| 项目 | 旧服务器（试用） | 新服务器（正式） |
|:--|:--|:--|
| **公网 IP** | `120.26.139.90` | `118.31.56.141` |
| **私有 IP** | — | `172.17.10.56` |
| **系统** | Ubuntu | Ubuntu 24.04 |
| **配置** | — | 2 vCPU / 2 GiB / 40 GiB ESSD |
| **到期时间** | 试用（即将过期） | 2027-03-21 |
| **SSH 用户** | `root` | `root` |
| **SSH 密码** | — | `Lhd20040729@` |

## 已完成配置

- [x] 密码重置
- [x] 防火墙规则：TCP 22 / 80 / 443 / 8200 已放行

## 待完成

- [ ] SSH 到新服务器，安装基础依赖
- [ ] 本地交叉编译 Go 后端二进制（Linux amd64）
- [ ] 上传二进制 + 前端 dist + .env + 数据库到新服务器
- [ ] 配置 systemd 服务
- [ ] 配置 Nginx 反代
- [ ] 验证服务正常运行
- [ ] 域名解析指向新 IP
- [ ] ICP 备案
- [ ] 配置 HTTPS（Let's Encrypt）
- [ ] 更新桌面客户端 `serverURL` 到新地址

---

## 项目本地路径

```
/Users/admin/Desktop/企微需求对接/
├── server/              # Go 后端（Gin + SQLite）
│   ├── .env             # 环境配置（BASE_URL、SERVER_PORT 等）
│   └── services/order.go
├── admin-web/           # React 前端 (Vite)
│   └── dist/            # 构建产物
├── desktop-client/      # Wails 桌面客户端
│   └── app.go           # serverURL 在此配置（当前默认 120.26.139.90:8200）
└── deploy/              # 部署脚本
```

## 迁移步骤

### 1. 本地交叉编译

```bash
cd /Users/admin/Desktop/企微需求对接/server
CGO_ENABLED=1 CC="zig cc -target x86_64-linux-gnu" CXX="zig c++ -target x86_64-linux-gnu" \
  GOOS=linux GOARCH=amd64 go build -o pdd-server-linux .
```

> 需要 zig（`brew install zig`），因为 SQLite 驱动依赖 CGO。

### 2. 前端打包

```bash
cd /Users/admin/Desktop/企微需求对接/admin-web
npm run build
```

### 3. 上传到新服务器

```bash
# 创建目录
ssh root@118.31.56.141 "mkdir -p /opt/pdd-server/uploads"

# 上传文件
scp server/pdd-server-linux root@118.31.56.141:/opt/pdd-server/pdd-server
scp -r admin-web/dist root@118.31.56.141:/opt/pdd-server/dist
scp server/.env root@118.31.56.141:/opt/pdd-server/.env

# 从旧服务器迁移数据（如有）
scp root@120.26.139.90:/opt/pdd-server/pdd_orders.db root@118.31.56.141:/opt/pdd-server/
scp -r root@120.26.139.90:/opt/pdd-server/uploads/ root@118.31.56.141:/opt/pdd-server/uploads/
```

### 4. 服务器端配置

```bash
ssh root@118.31.56.141

chmod +x /opt/pdd-server/pdd-server
sed -i 's|120.26.139.90|118.31.56.141|g' /opt/pdd-server/.env
```

### 5. systemd 服务

```bash
cat > /etc/systemd/system/pdd-server.service << 'EOF'
[Unit]
Description=PDD Order Management Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/pdd-server
ExecStart=/opt/pdd-server/pdd-server
Restart=always
RestartSec=5
Environment=GIN_MODE=release

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable pdd-server
systemctl start pdd-server
```

### 6. Nginx 反代

```bash
apt update && apt install -y nginx

cat > /etc/nginx/sites-available/pdd << 'EOF'
server {
    listen 80;
    server_name _;
    client_max_body_size 20M;

    location /api/ {
        proxy_pass http://127.0.0.1:8200;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location /uploads/ {
        proxy_pass http://127.0.0.1:8200;
    }

    location / {
        root /opt/pdd-server/dist;
        try_files $uri $uri/ /index.html;
    }
}
EOF

ln -sf /etc/nginx/sites-available/pdd /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx
```

### 7. 验证

```bash
curl http://118.31.56.141:8200/api/v1/admin/dashboard
curl http://118.31.56.141/api/v1/admin/dashboard  # 通过 Nginx
```

### 8. 更新桌面客户端地址

迁移完成后修改 `desktop-client/app.go` 中的 `serverURL` 为最终地址（域名或新 IP），重新编译。

---

## 关键注意事项

1. **SQLite 文件** `pdd_orders.db` 是核心数据，迁移前在旧服务器 `systemctl stop pdd-server` 避免写入不一致
2. **uploads 目录**包含 OCR 截图文件，也需要同步
3. **.env 文件**中的 `BASE_URL` 需要改为新 IP
4. 旧服务器的 `SERVER_PORT` 是 `8200`，新服务器保持一致
